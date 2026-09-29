"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import type { Paginated, ProductStatus, ProductSummaryDto } from "@ecom/shared";
import { adminApi } from "@/lib/admin-api";
import { useMoney } from "@/lib/use-money";
import { cn } from "@/lib/utils";
import { Button, buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Alert, Badge } from "@/components/ui/misc";
import { PageHeader } from "@/components/admin/admin-shell";
import { revalidateStorefront } from "../../actions";

const STATUS_TONE = { ACTIVE: "success", DRAFT: "warning", ARCHIVED: "neutral" } as const;
const STATUSES: ProductStatus[] = ["ACTIVE", "DRAFT", "ARCHIVED"];

function ProductsTable() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { format } = useMoney();

  const q = params.get("q") ?? "";
  const status = (params.get("status") as ProductStatus | null) ?? undefined;
  const page = Number(params.get("page") ?? 1) || 1;

  const [data, setData] = useState<Paginated<ProductSummaryDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);

  const load = useCallback(() => {
    adminApi
      .listProducts({ q: q || undefined, status, page, pageSize: 20 })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [q, status, page]);

  useEffect(load, [load]);

  const setParam = (updates: Record<string, string | undefined>) => {
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
    setParam({ q: search.trim() || undefined });
  };

  const toggleStatus = async (p: ProductSummaryDto) => {
    try {
      await adminApi.setProductStatus(p.id, p.status === "ACTIVE" ? "DRAFT" : "ACTIVE");
      await revalidateStorefront();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <>
      <PageHeader
        title="Products"
        actions={
          <Link href="/admin/products/new" className={buttonClass()}>
            <Plus className="size-4" /> New product
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <form onSubmit={onSearch} className="flex flex-1 gap-2">
          <Input
            aria-label="Search products"
            placeholder="Search by title or exact SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Select
          aria-label="Filter by status"
          value={status ?? ""}
          onChange={(e) => setParam({ status: e.target.value || undefined })}
          className="w-40"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}

      <div className="overflow-x-auto rounded-(--radius) border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Product</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 text-right font-medium">Price</th>
              <th className="p-3 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!data && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground">
                  No products found.
                </td>
              </tr>
            )}
            {data?.items.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="p-3">
                  <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3 font-medium hover:underline">
                    <span className="relative size-10 shrink-0 overflow-hidden rounded bg-muted">
                      {p.image && <Image src={p.image.url} alt="" fill sizes="40px" className="object-cover" />}
                    </span>
                    {p.title}
                  </Link>
                </td>
                <td className="p-3">
                  <Badge tone={STATUS_TONE[p.status]}>{p.status.toLowerCase()}</Badge>
                  {p.stock !== "in" && (
                    <Badge tone="warning" className="ml-2">
                      {p.stock === "out" ? "sold out" : "partly out of stock"}
                    </Badge>
                  )}
                </td>
                <td className="p-3 text-right tabular-nums">{format(p.priceMinor)}</td>
                <td className="p-3 text-right">
                  {p.status !== "ARCHIVED" && (
                    <Button size="sm" variant="ghost" onClick={() => toggleStatus(p)}>
                      {p.status === "ACTIVE" ? "Unpublish" : "Publish"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>
            Previous
          </Button>
          <span className={cn("px-2 text-muted-foreground")}>
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= data.totalPages}
            onClick={() => setParam({ page: String(page + 1) })}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductsTable />
    </Suspense>
  );
}
