import Link from "next/link";
import { Suspense } from "react";
import { productListQuerySchema, type Paginated, type ProductListQuery, type ProductSummaryDto } from "@ecom/shared";
import { cn } from "@/lib/utils";
import { ProductGrid } from "./product-card";
import { ListingControls } from "./listing-controls";

type SearchParams = Record<string, string | string[] | undefined>;

/** Parses listing params from the URL; invalid values fall back to defaults instead of erroring. */
export function parseListingParams(sp: SearchParams, pageSize: number): ProductListQuery {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const toMinor = (v: string | undefined) =>
    v && /^\d+(\.\d{1,2})?$/.test(v) ? String(Math.round(Number(v) * 100)) : undefined;
  const raw = {
    q: first(sp.q)?.trim() || undefined,
    sort: first(sp.sort),
    page: first(sp.page),
    minPrice: toMinor(first(sp.min)),
    maxPrice: toMinor(first(sp.max)),
    pageSize,
  };
  const parsed = productListQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : productListQuerySchema.parse({ pageSize });
}

export function Listing({
  result,
  format,
  basePath,
  searchParams,
}: {
  result: Paginated<ProductSummaryDto>;
  format: (minor: number) => string;
  basePath: string;
  searchParams: SearchParams;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {result.total} {result.total === 1 ? "product" : "products"}
        </p>
        <Suspense>
          <ListingControls />
        </Suspense>
      </div>
      <ProductGrid products={result.items} format={format} />
      <Pagination page={result.page} totalPages={result.totalPages} basePath={basePath} searchParams={searchParams} />
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  basePath,
  searchParams,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  searchParams: SearchParams;
}) {
  if (totalPages <= 1) return null;
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "page") qs.set(k, v);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav aria-label="Pagination" className="flex justify-center gap-1 pt-4">
      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
        <Link
          key={p}
          href={href(p)}
          aria-current={p === page ? "page" : undefined}
          className={cn(
            "flex size-9 items-center justify-center rounded-(--radius) text-sm",
            p === page ? "bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          {p}
        </Link>
      ))}
    </nav>
  );
}
