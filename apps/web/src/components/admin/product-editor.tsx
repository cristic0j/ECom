"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import {
  productInputSchema,
  type AdminProductDto,
  type CategoryDto,
  type ProductInput,
  type ProductStatus,
  type SupplierProductInfo,
} from "@ecom/shared";
import { adminApi, ApiRequestError } from "@/lib/admin-api";
import { useMoney } from "@/lib/use-money";
import { minorToInput, parseMoneyToMinor, slugify } from "@/lib/utils";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/misc";
import { PageHeader, useAdmin } from "./admin-shell";
import { ImagesEditor, type ImageRow } from "./images-editor";
import {
  generateVariants,
  newRowKey,
  optionsFromVariants,
  VariantsEditor,
  type OptionDef,
  type VariantRow,
} from "./variants-editor";
import { revalidateStorefront } from "@/app/admin/actions";

type AttrRow = { key: string; value: string };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

const toRows = (p?: AdminProductDto): VariantRow[] =>
  p?.variants.map((v) => ({
    key: newRowKey(),
    id: v.id,
    sku: v.sku,
    title: v.title,
    price: minorToInput(v.priceMinor),
    compareAt: minorToInput(v.compareAtMinor),
    options: v.options,
    isDefault: v.isDefault,
    inStock: v.inStock,
    cost: minorToInput(v.costMinor),
    supplierSkuId: v.supplierSkuId,
  })) ?? [
    {
      key: newRowKey(),
      sku: "",
      title: "Default",
      price: "",
      compareAt: "",
      options: {},
      isDefault: true,
      inStock: true,
      cost: "",
    },
  ];

const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** Where an imported product comes from: the supplier link and what it costs and takes per country. */
function SupplierSection({ info }: { info: SupplierProductInfo }) {
  const { format } = useMoney();
  return (
    <Section title="AliExpress">
      <a href={info.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline">
        View on AliExpress <ExternalLink className="size-3.5" />
      </a>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">Ships to</th>
            <th className="py-1 font-medium">Cost from</th>
            <th className="py-1 font-medium">Delivery</th>
          </tr>
        </thead>
        <tbody>
          {info.countries.map((c) => (
            <tr key={c.country} className={c.available ? undefined : "text-muted-foreground"}>
              <td className="py-1" title={countryName(c.country)}>
                {c.country}
              </td>
              {c.available ? (
                <>
                  <td className="py-1">{c.costMinor !== null ? format(c.costMinor) : "—"}</td>
                  <td className="py-1">{c.deliveryDays ? `${c.deliveryDays} days` : "—"}</td>
                </>
              ) : (
                <td className="py-1" colSpan={2}>
                  Not sold there
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        Imported {new Date(info.importedAt).toLocaleDateString()}. Each option&apos;s cost is the highest of these
        countries. Only you see this.
      </p>
    </Section>
  );
}

export function ProductEditor({ product }: { product?: AdminProductDto }) {
  const router = useRouter();
  const admin = useAdmin();
  const isNew = !product;
  // Last saved version: drives the header and the View link, which must not reflect unsaved edits
  const [saved, setSaved] = useState(product);

  const [title, setTitle] = useState(product?.title ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [description, setDescription] = useState(product?.description ?? "");
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? "DRAFT");
  const [categoryIds, setCategoryIds] = useState<string[]>(product?.categories.map((c) => c.id) ?? []);
  const [attributes, setAttributes] = useState<AttrRow[]>(
    Object.entries(product?.attributes ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [images, setImages] = useState<ImageRow[]>(product?.images.map(({ url, alt }) => ({ url, alt })) ?? []);
  const [rows, setRows] = useState<VariantRow[]>(() => toRows(product));
  const [options, setOptions] = useState<OptionDef[]>(() => optionsFromVariants(toRows(product)));

  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [variantErrors, setVariantErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    adminApi.listCategories().then(setCategories).catch(() => {});
  }, []);

  const onTitle = (v: string) => {
    setTitle(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const onGenerate = () => setRows((current) => generateVariants(options, current, slug));

  const onOptionsChange = (next: OptionDef[]) => {
    setOptions(next);
    // Removing the last option collapses back to a single default variant
    if (next.length === 0) setRows((r) => [{ ...r[0], title: "Default", options: {}, isDefault: true }]);
  };

  /** Converts form state to the API shape, collecting per-field errors. */
  const buildInput = (): ProductInput | null => {
    const errs: Record<string, string> = {};
    const vErrs: Record<number, string> = {};

    const variants = rows.map((r, i) => {
      const priceMinor = parseMoneyToMinor(r.price);
      const compareAtMinor = r.compareAt.trim() ? parseMoneyToMinor(r.compareAt) : null;
      const costMinor = r.cost.trim() ? parseMoneyToMinor(r.cost) : null;
      if (!r.sku.trim()) vErrs[i] = "SKU is required";
      else if (Number.isNaN(priceMinor)) vErrs[i] = "Enter a valid price, e.g. 19.99";
      else if (compareAtMinor !== null && Number.isNaN(compareAtMinor)) vErrs[i] = "Invalid compare-at price";
      else if (costMinor !== null && Number.isNaN(costMinor)) vErrs[i] = "Enter a valid cost, e.g. 4.69";
      return {
        id: r.id,
        sku: r.sku.trim(),
        title: r.title || "Default",
        priceMinor,
        compareAtMinor,
        costMinor,
        options: r.options,
        isDefault: r.isDefault,
        inStock: r.inStock,
      };
    });

    const attrs: Record<string, string> = {};
    for (const a of attributes) if (a.key.trim()) attrs[a.key.trim()] = a.value;

    const parsed = productInputSchema.safeParse({
      slug,
      title,
      description,
      status,
      attributes: attrs,
      categoryIds,
      variants,
      images,
    });

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const [field] = issue.path;
        if (typeof field === "string" && field !== "variants" && !errs[field]) errs[field] = issue.message;
      }
    }
    setErrors(errs);
    setVariantErrors(vErrs);
    if (!parsed.success || Object.keys(vErrs).length) {
      setFormError("Please fix the highlighted fields.");
      return null;
    }
    return parsed.data;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const input = buildInput();
    if (!input) return;

    setSaving(true);
    try {
      const result = isNew ? await adminApi.createProduct(input) : await adminApi.updateProduct(product.id, input);
      await revalidateStorefront();
      if (isNew) {
        router.replace(`/admin/products/${result.id}`);
      } else {
        // Pick up server-assigned variant ids so the next save updates instead of re-creating
        setRows(toRows(result));
        setSaved(result);
        setSavedAt(new Date());
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const fe = err.fieldErrors;
        setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0]])));
      }
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!product || !confirm(`Delete "${saved?.title ?? product.title}"? This cannot be undone.`)) return;
    try {
      await adminApi.deleteProduct(product.id);
      await revalidateStorefront();
      router.replace("/admin/products");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader
        title={saved ? saved.title : "New product"}
        actions={
          <>
            {saved?.status === "ACTIVE" && (
              <Link href={`/p/${saved.slug}`} target="_blank" className={buttonClass("secondary")}>
                <ExternalLink className="size-4" /> View
              </Link>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />

      {saved?.supplier && saved.status === "DRAFT" && (
        <p className="mb-4 rounded-(--radius) border border-border bg-muted px-4 py-3 text-sm">
          Imported from AliExpress as a draft. Check the name, photos, options and prices (they start at about 2.5× your
          cost), then set the status to Active and save.
        </p>
      )}
      {formError && <Alert className="mb-4">{formError}</Alert>}
      {savedAt && !formError && (
        <p role="status" className="mb-4 text-sm text-green-700 dark:text-green-400">
          Saved at {savedAt.toLocaleTimeString()}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Section title="Details">
            <Field label="Title" htmlFor="title" error={errors.title}>
              <Input id="title" value={title} onChange={(e) => onTitle(e.target.value)} required />
            </Field>
            <Field label="URL slug" htmlFor="slug" error={errors.slug} hint={`/p/${slug || "…"}`}>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
              />
            </Field>
            <Field label="Description" htmlFor="description" error={errors.description}>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={6} />
            </Field>
          </Section>

          <Section title="Images">
            <ImagesEditor images={images} onChange={setImages} />
          </Section>

          <Section title="Variants & pricing">
            <VariantsEditor
              options={options}
              onOptionsChange={onOptionsChange}
              rows={rows}
              onRowsChange={setRows}
              onGenerate={onGenerate}
              errors={variantErrors}
              supplierName={saved?.supplier ? "AliExpress" : undefined}
            />
          </Section>

          <Section title="Attributes">
            <p className="text-sm text-muted-foreground">Custom fields shown on the product page, e.g. Material → Cotton.</p>
            {attributes.map((a, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  aria-label={`Attribute ${i + 1} name`}
                  placeholder="Name"
                  value={a.key}
                  onChange={(e) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  className="w-48"
                />
                <Input
                  aria-label={`Attribute ${i + 1} value`}
                  placeholder="Value"
                  value={a.value}
                  onChange={(e) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                />
                <Button
                  variant="ghost"
                  aria-label={`Remove attribute ${i + 1}`}
                  onClick={() => setAttributes(attributes.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setAttributes([...attributes, { key: "", value: "" }])}>
              <Plus className="size-4" /> Add attribute
            </Button>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Status">
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as ProductStatus)}>
              <option value="DRAFT">Draft (hidden)</option>
              <option value="ACTIVE">Active (visible in store)</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </Section>

          {saved?.supplier && <SupplierSection info={saved.supplier} />}

          <Section title="Categories">
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No categories yet. <Link href="/admin/categories" className="underline">Create one</Link>.
              </p>
            ) : (
              <ul className="space-y-2">
                {categories.map((c) => (
                  <li key={c.id} className={c.parentId ? "pl-5" : undefined}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={categoryIds.includes(c.id)}
                        onChange={(e) =>
                          setCategoryIds(e.target.checked ? [...categoryIds, c.id] : categoryIds.filter((id) => id !== c.id))
                        }
                      />
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {!isNew && admin.role === "ADMIN" && (
            <Section title="Danger zone">
              <Button variant="danger" onClick={onDelete} className="w-full">
                <Trash2 className="size-4" /> Delete product
              </Button>
            </Section>
          )}
        </div>
      </div>
    </form>
  );
}
