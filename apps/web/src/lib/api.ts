import "server-only";
import type {
  CategoryDto,
  Paginated,
  ProductDto,
  ProductListQuery,
  ProductSummaryDto,
  StoreSettings,
} from "@ecom/shared";

const API_URL = `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/api`;

/** Cache tags; admin saves invalidate these (see app/admin/actions.ts). */
export const TAGS = { catalog: "catalog", settings: "settings" } as const;

// Background refresh interval as a safety net; admin edits invalidate immediately via tags.
const REVALIDATE_SECONDS = 300;

export class NotFoundError extends Error {}

async function get<T>(path: string, tag: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { next: { revalidate: REVALIDATE_SECONDS, tags: [tag] } });
  if (res.status === 404) throw new NotFoundError(path);
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

function toQuery(params: Partial<ProductListQuery>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const api = {
  products: (q: Partial<ProductListQuery> = {}) =>
    get<Paginated<ProductSummaryDto>>(`/catalog/products${toQuery(q)}`, TAGS.catalog),
  product: (slug: string) => get<ProductDto>(`/catalog/products/${encodeURIComponent(slug)}`, TAGS.catalog),
  productSlugs: () => get<{ slug: string; updatedAt: string }[]>("/catalog/products/slugs", TAGS.catalog),
  categories: () => get<CategoryDto[]>("/catalog/categories", TAGS.catalog),
  category: (slug: string) => get<CategoryDto>(`/catalog/categories/${encodeURIComponent(slug)}`, TAGS.catalog),
  settings: () => get<StoreSettings>("/settings", TAGS.settings),
};
