"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, Search, Star, Truck } from "lucide-react";
import {
  countryName,
  type SupplierCategoryDto,
  type SupplierCountryInfo,
  type SupplierSearchItemDto,
  type SupplierSearchQuery,
  type SupplierSearchResultDto,
} from "@ecom/shared";
import { adminApi } from "@/lib/admin-api";
import { useMoney } from "@/lib/use-money";
import { minorToInput, parseMoneyToMinor } from "@/lib/utils";
import { Button, buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/misc";

const SORTS: [SupplierSearchQuery["sort"], string][] = [
  ["orders", "Most sold"],
  ["best", "Best match"],
  ["reviews", "Most reviewed"],
];

const SOLD: [string, string][] = [
  ["", "Any sales"],
  ["100", "100+ sold"],
  ["1000", "1,000+ sold"],
  ["10000", "10,000+ sold"],
];

const REVIEWS: [string, string][] = [
  ["", "Any reviews"],
  ["good", "Good: ★4+ / 90%+"],
  ["excellent", "Excellent: ★4.5+ / 95%+"],
];

type Delivery = SupplierCountryInfo[] | "loading" | { error: string };

/**
 * Search AliExpress and import results. The search lives in the address (q, cat, sub, sort, page, min, max,
 * sold, reviews), so Back works.
 */
export function AliExpressSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { format } = useMoney();

  const q = params.get("q") ?? "";
  const cat = params.get("cat") ?? "";
  const sub = params.get("sub") ?? "";
  const sort = (params.get("sort") as SupplierSearchQuery["sort"] | null) ?? "orders";
  const page = Number(params.get("page") ?? 1) || 1;
  // Price range in minor units; anything unparsable in the address is ignored
  const cost = (key: string) => {
    const minor = parseMoneyToMinor(params.get(key) ?? "");
    return Number.isNaN(minor) || !params.get(key) ? undefined : minor;
  };
  const minCost = cost("min");
  const maxCost = cost("max");
  const minSold = Number(params.get("sold")) || undefined;
  const reviews = (["good", "excellent"] as const).find((r) => r === params.get("reviews"));

  // Without words, a main category (or none: all categories) lists AliExpress's bestsellers: most sold or
  // AliExpress's order, no reviews sort
  const browsing = !q && !sub;
  const sorts = browsing
    ? SORTS.filter(([value]) => value !== "reviews").map(([value, label]) =>
        [value, value === "best" ? "AliExpress order" : label] as const,
      )
    : SORTS;

  const [keywords, setKeywords] = useState(q);
  const [minInput, setMinInput] = useState(minorToInput(minCost ?? null));
  const [maxInput, setMaxInput] = useState(minorToInput(maxCost ?? null));
  const [categories, setCategories] = useState<SupplierCategoryDto[]>([]);
  const [result, setResult] = useState<SupplierSearchResultDto | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Record<string, Delivery>>({});

  useEffect(() => {
    adminApi.aliexpressCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    let current = true;
    const run = async () => {
      setSearching(true);
      setError(null);
      try {
        const categoryId = sub || cat || undefined;
        const filters = { minCost, maxCost, minSold, reviews };
        const found = await adminApi.aliexpressSearch({ q, categoryId, sort, page, ...filters });
        if (current) setResult(found);
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (current) setSearching(false);
      }
    };
    run();
    return () => {
      current = false;
    };
  }, [q, cat, sub, sort, page, minCost, maxCost, minSold, reviews]);

  const go = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in updates)) next.delete("page");
    router.push(`${pathname}?${next}`);
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const [min, max] = [minInput.trim(), maxInput.trim()];
    if ([min, max].some((v) => v && Number.isNaN(parseMoneyToMinor(v)))) {
      setError("Enter prices like 4.99");
      return;
    }
    if (min && max && parseMoneyToMinor(min) > parseMoneyToMinor(max)) {
      setError("The lowest price must be below the highest");
      return;
    }
    setError(null);
    go({ q: keywords.trim() || undefined, min: min || undefined, max: max || undefined });
  };

  const importProduct = async (item: SupplierSearchItemDto) => {
    setImporting(item.productId);
    setError(null);
    try {
      const product = await adminApi.aliexpressImport(item.productId);
      router.push(`/admin/products/${product.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setImporting(null);
    }
  };

  const checkDelivery = async (productId: string) => {
    setDelivery((d) => ({ ...d, [productId]: "loading" }));
    try {
      const countries = await adminApi.aliexpressLookup(productId);
      setDelivery((d) => ({ ...d, [productId]: countries }));
    } catch (e) {
      setDelivery((d) => ({ ...d, [productId]: { error: e instanceof Error ? e.message : "Check failed" } }));
    }
  };

  const subcategories = categories.find((c) => c.id === cat)?.children ?? [];

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <h2 className="font-semibold">Search AliExpress</h2>
        <form onSubmit={onSearch} className="flex flex-wrap gap-2">
          <Input
            aria-label="What are you looking for?"
            placeholder="What are you looking for? (optional)"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className="min-w-0 flex-1 basis-64"
          />
          <div className="flex items-center gap-2">
            <Input
              aria-label="Lowest price"
              placeholder="Min €"
              inputMode="decimal"
              value={minInput}
              onChange={(e) => setMinInput(e.target.value)}
              className="w-24"
            />
            <span className="text-muted-foreground" aria-hidden>
              –
            </span>
            <Input
              aria-label="Highest price"
              placeholder="Max €"
              inputMode="decimal"
              value={maxInput}
              onChange={(e) => setMaxInput(e.target.value)}
              className="w-24"
            />
          </div>
          <Button type="submit">
            <Search className="size-4" /> Search
          </Button>
        </form>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            aria-label="Category"
            value={cat}
            onChange={(e) => go({ cat: e.target.value || undefined, sub: undefined })}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Subcategory"
            value={sub}
            onChange={(e) => go({ sub: e.target.value || undefined })}
            disabled={!subcategories.length}
          >
            <option value="">{cat ? "All subcategories" : "Subcategory"}</option>
            {subcategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Sort by"
            value={browsing && sort === "reviews" ? "best" : sort}
            onChange={(e) => go({ sort: e.target.value })}
          >
            {sorts.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Sales"
            value={minSold ? String(minSold) : ""}
            onChange={(e) => go({ sold: e.target.value })}
          >
            {SOLD.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select aria-label="Reviews" value={reviews ?? ""} onChange={(e) => go({ reviews: e.target.value })}>
            {REVIEWS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        {browsing && (
          <p className="text-xs text-muted-foreground">
            Without words, you see AliExpress&apos;s bestseller list
            {cat ? " for this category" : ""}: a selection of popular products, not all of AliExpress, in a rough
            most-sold order. To find a specific product or the true top sellers, type words.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Costs are what AliExpress charges for {result ? countryName(result.country) : "your first delivery country"}.
          AliExpress can&apos;t search by price, sales or reviews for your app, so those filters hide results on each
          page of AliExpress&apos;s results (some pages show fewer products). Use &ldquo;Check delivery&rdquo; on a
          product to see every country.
        </p>
      </Card>

      {error && <Alert>{error}</Alert>}
      {searching && !result && <p className="text-sm text-muted-foreground">Searching…</p>}
      {result && result.items.length === 0 && result.hidden === 0 && !searching && (
        <p className="text-sm text-muted-foreground">Nothing found. Try other words or another category.</p>
      )}
      {result && result.hidden > 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          {result.items.length === 0
            ? `None of the ${result.hidden} results on this page match your filters. ` +
              "Try the next page or wider filters."
            : `${result.hidden} of the results on this page ${result.hidden === 1 ? "doesn't" : "don't"} ` +
              "match your filters."}
        </p>
      )}

      {result && (result.items.length > 0 || result.hidden > 0) && (
        <>
          <ul
            className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${searching ? "opacity-60" : ""}`}
            aria-busy={searching}
          >
            {result.items.map((item) => {
              const checked = delivery[item.productId];
              return (
                <li key={item.productId} data-testid="ae-result">
                  <Card className="flex h-full flex-col gap-3 p-4">
                    <div className="relative aspect-square overflow-hidden rounded-(--radius) bg-muted">
                      {item.image && (
                        // Straight from AliExpress's image servers (not through Next's optimizer)
                        <Image
                          src={item.image}
                          alt=""
                          fill
                          unoptimized
                          referrerPolicy="no-referrer"
                          className="object-cover"
                        />
                      )}
                    </div>
                    <h3 className="line-clamp-2 text-sm font-medium" title={item.title}>
                      {item.title}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-semibold">{item.costMinor !== null ? format(item.costMinor) : "—"}</span>
                      {item.sold && <span className="text-muted-foreground">{item.sold} sold</span>}
                      {item.rating ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Star className="size-3.5" aria-hidden /> {item.rating.toFixed(1)}
                        </span>
                      ) : (
                        item.positiveRate && (
                          <span className="text-muted-foreground">{Math.round(item.positiveRate)}% positive</span>
                        )
                      )}
                    </div>

                    {checked === "loading" && <p className="text-xs text-muted-foreground">Checking delivery…</p>}
                    {checked && typeof checked === "object" && "error" in checked && (
                      <p className="text-xs text-red-600">{checked.error}</p>
                    )}
                    {Array.isArray(checked) && (
                      <table className="w-full text-xs">
                        <tbody>
                          {checked.map((c) => (
                            <tr key={c.country} className={c.available ? undefined : "text-muted-foreground"}>
                              <td className="py-0.5" title={countryName(c.country)}>
                                {c.country}
                              </td>
                              {c.available ? (
                                <>
                                  <td className="py-0.5">{c.costMinor !== null ? format(c.costMinor) : "—"}</td>
                                  <td className="py-0.5">{c.deliveryDays ? `${c.deliveryDays} days` : "—"}</td>
                                </>
                              ) : (
                                <td className="py-0.5" colSpan={2}>
                                  Not sold there
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div className="mt-auto flex flex-wrap gap-2 pt-1">
                      {item.importedProductId ? (
                        <Link
                          href={`/admin/products/${item.importedProductId}`}
                          className={buttonClass("secondary", "sm")}
                        >
                          In your store
                        </Link>
                      ) : (
                        <Button size="sm" onClick={() => importProduct(item)} disabled={importing !== null}>
                          {importing === item.productId ? "Importing…" : "Import"}
                        </Button>
                      )}
                      {!Array.isArray(checked) && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => checkDelivery(item.productId)}
                          disabled={checked === "loading"}
                        >
                          <Truck className="size-4" /> Check delivery
                        </Button>
                      )}
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonClass("ghost", "sm")}
                        aria-label={`View ${item.title} on AliExpress`}
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>

          <nav aria-label="Pages" className="flex items-center justify-center gap-3 text-sm">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1 || searching}
              onClick={() => go({ page: String(page - 1) })}
            >
              Previous
            </Button>
            <span className="text-muted-foreground">
              Page {page}
              {result.totalPages ? ` of ${result.totalPages}` : ""}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={searching || (result.totalPages !== null && page >= result.totalPages)}
              onClick={() => go({ page: String(page + 1) })}
            >
              Next
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
