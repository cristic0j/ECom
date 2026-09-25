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
  const item = "flex h-9 min-w-9 items-center justify-center rounded-(--radius) px-2 text-sm";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap justify-center gap-1 pt-4">
      {page > 1 && (
        <Link href={href(page - 1)} rel="prev" className={cn(item, "hover:bg-muted")}>
          Previous
        </Link>
      )}
      {pageWindow(page, totalPages).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} aria-hidden className={cn(item, "text-muted-foreground")}>
            …
          </span>
        ) : (
          <Link
            key={p}
            href={href(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(item, p === page ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {p}
          </Link>
        ),
      )}
      {page < totalPages && (
        <Link href={href(page + 1)} rel="next" className={cn(item, "hover:bg-muted")}>
          Next
        </Link>
      )}
    </nav>
  );
}

/** First, last and the pages around the current one; `null` marks a gap, e.g. 1 … 4 5 6 … 20. */
export function pageWindow(page: number, totalPages: number, radius = 1): (number | null)[] {
  const pages: (number | null)[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= radius) pages.push(p);
    // A gap of a single page is shown as that page rather than "…"
    else if (Math.abs(p - page) === radius + 1 && (p === 2 || p === totalPages - 1)) pages.push(p);
    else if (pages.at(-1) !== null) pages.push(null);
  }
  return pages;
}
