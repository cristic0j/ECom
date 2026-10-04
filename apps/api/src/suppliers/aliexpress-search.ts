import type { SupplierCategoryDto, SupplierSearchItemDto, SupplierSearchQuery } from "@ecom/shared";
import { productUrl, toMinor } from "./aliexpress-product";

/** Results per page; AliExpress allows up to 50 pages of a search */
export const SEARCH_PAGE_SIZE = 20;
const MAX_PAGES = 50;

/** What our sort options are called in `aliexpress.ds.text.search` (no sortBy = AliExpress's best match) */
const SORT_BY: Record<SupplierSearchQuery["sort"], string | undefined> = {
  best: undefined,
  orders: "orders,desc",
  reviews: "comments,desc",
};

/** The parts of `aliexpress.ds.text.search` the search page reads. */
export interface DsSearchResponse {
  code?: string;
  msg?: string;
  data?: {
    totalCount?: number | string;
    products?: {
      selection_search_product?: {
        itemId?: string | number;
        title?: string;
        itemMainPic?: string;
        targetSalePrice?: string;
        targetOriginalPriceCurrency?: string;
        orders?: string;
        score?: string;
        evaluateRate?: string;
      }[];
    };
  };
}

export interface DsCategoryResponse {
  resp_result?: {
    result?: {
      categories?: { category?: { category_id: number | string; category_name: string; parent_category_id?: number | string }[] };
    };
  };
}

/** The parts of `aliexpress.ds.recommend.feed.get` the search page reads. */
export interface DsFeedResponse {
  rsp_code?: number | string;
  rsp_msg?: string;
  result?: {
    total_record_count?: number | string;
    products?: {
      traffic_product_d_t_o?: {
        product_id?: number | string;
        product_title?: string;
        product_main_image_url?: string;
        target_sale_price?: string;
        target_sale_price_currency?: string;
        lastest_volume?: number | string;
        evaluate_rate?: string;
      }[];
    };
  };
}

export interface DsFeedNameResponse {
  resp_result?: { result?: { promos?: { promo?: { promo_name: string; product_num: number | string }[] } } };
}

const rate = (value: string | undefined) => {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function searchParams(query: SupplierSearchQuery, country: string, currency: string): Record<string, string> {
  const sortBy = SORT_BY[query.sort];
  return {
    ...(query.q && { keyWord: query.q }),
    local: "en_US",
    countryCode: country,
    currency,
    pageSize: String(SEARCH_PAGE_SIZE),
    pageIndex: String(query.page),
    ...(sortBy && { sortBy }),
    ...(query.categoryId && { categoryId: query.categoryId }),
  };
}

/** Search hits in the store's shape; `imported` maps AliExpress product ids to the store's product ids. */
export function searchItems(response: DsSearchResponse, currency: string, imported: Map<string, string>): SupplierSearchItemDto[] {
  return (response.data?.products?.selection_search_product ?? []).flatMap((hit) => {
    const productId = hit.itemId ? String(hit.itemId) : "";
    if (!/^\d+$/.test(productId)) return [];
    const rating = Number(hit.score);
    const image = hit.itemMainPic?.trim() || null;
    return [
      {
        productId,
        title: hit.title?.trim() || `AliExpress product ${productId}`,
        image: image?.startsWith("//") ? `https:${image}` : image,
        costMinor: !hit.targetOriginalPriceCurrency || hit.targetOriginalPriceCurrency === currency ? toMinor(hit.targetSalePrice) : null,
        sold: hit.orders?.trim() || null,
        rating: Number.isFinite(rating) && rating > 0 ? rating : null,
        positiveRate: rate(hit.evaluateRate),
        url: productUrl(productId),
        importedProductId: imported.get(productId) ?? null,
      },
    ];
  });
}

/** "10,000+" → 10000, "6,946" → 6946; null when AliExpress didn't say */
export const soldCount = (sold: string | null) => {
  const n = Number((sold ?? "").replace(/[^\d]/g, ""));
  return sold && Number.isFinite(n) ? n : null;
};

/** Star rating where AliExpress gives one, else the share of positive reviews (bestseller lists have only that) */
const REVIEW_LEVELS = { good: { stars: 4, positive: 90 }, excellent: { stars: 4.5, positive: 95 } } as const;

export type HitFilters = Pick<SupplierSearchQuery, "minCost" | "maxCost" | "minSold" | "reviews">;

/**
 * Keeps the hits that match the filters. A hit that doesn't say (no price, no sales figure, no reviews) is left
 * out once that filter is set.
 */
export function filterHits(items: SupplierSearchItemDto[], { minCost, maxCost, minSold, reviews }: HitFilters) {
  return items.filter((i) => {
    if (minCost !== undefined || maxCost !== undefined) {
      if (i.costMinor === null || i.costMinor < (minCost ?? 0) || (maxCost !== undefined && i.costMinor > maxCost)) return false;
    }
    if (minSold !== undefined && minSold > 0 && (soldCount(i.sold) ?? -1) < minSold) return false;
    if (reviews) {
      const level = REVIEW_LEVELS[reviews];
      const ok = i.rating !== null ? i.rating >= level.stars : i.positiveRate !== null && i.positiveRate >= level.positive;
      if (!ok) return false;
    }
    return true;
  });
}

/** The bestseller list's sort for "most sold"; its pages go from most to least sold (tested on real data) */
export const FEED_MOST_SOLD = "volumeDesc";

/**
 * Bestseller-feed products in the same shape as search hits. With `bySales`, each page is also ordered by
 * the sales figure shown, since AliExpress orders the list by a sales measure of its own.
 */
export function feedItems(
  response: DsFeedResponse,
  currency: string,
  imported: Map<string, string>,
  { bySales = false } = {},
): SupplierSearchItemDto[] {
  const products = [...(response.result?.products?.traffic_product_d_t_o ?? [])];
  if (bySales) products.sort((a, b) => (Number(b.lastest_volume) || 0) - (Number(a.lastest_volume) || 0));
  return products.flatMap((p) => {
    const productId = p.product_id ? String(p.product_id) : "";
    if (!/^\d+$/.test(productId)) return [];
    const sold = Number(p.lastest_volume);
    return [
      {
        productId,
        title: p.product_title?.trim() || `AliExpress product ${productId}`,
        image: p.product_main_image_url?.trim() || null,
        costMinor: !p.target_sale_price_currency || p.target_sale_price_currency === currency ? toMinor(p.target_sale_price) : null,
        sold: Number.isFinite(sold) && sold > 0 ? sold.toLocaleString("en-US") : null,
        rating: null,
        positiveRate: rate(p.evaluate_rate),
        url: productUrl(productId),
        importedProductId: imported.get(productId) ?? null,
      },
    ];
  });
}

export function feedTotalPages(response: DsFeedResponse): number | null {
  const total = Number(response.result?.total_record_count);
  return Number.isFinite(total) && total > 0 ? Math.min(MAX_PAGES, Math.ceil(total / SEARCH_PAGE_SIZE)) : null;
}

/**
 * The feed to browse a main category with: the biggest "bestsellers" list AliExpress offers, or else its
 * biggest list. Feed names carry dates and change over time, so this is looked up rather than fixed.
 */
export function pickFeed(response: DsFeedNameResponse): string | null {
  const feeds = [...(response.resp_result?.result?.promos?.promo ?? [])].sort((a, b) => Number(b.product_num) - Number(a.product_num));
  return (feeds.find((f) => /bestseller/i.test(f.promo_name)) ?? feeds[0])?.promo_name ?? null;
}

export function searchTotalPages(response: DsSearchResponse): number | null {
  const total = Number(response.data?.totalCount);
  return Number.isFinite(total) && total > 0 ? Math.min(MAX_PAGES, Math.ceil(total / SEARCH_PAGE_SIZE)) : null;
}

/** AliExpress's two-level category list as a tree, sorted by name. */
export function categoryTree(response: DsCategoryResponse): SupplierCategoryDto[] {
  const all = response.resp_result?.result?.categories?.category ?? [];
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en");
  const top = all
    .filter((c) => !c.parent_category_id)
    .map((c) => ({ id: String(c.category_id), name: c.category_name.trim(), children: [] as { id: string; name: string }[] }));
  const byId = new Map(top.map((c) => [c.id, c]));
  for (const c of all) {
    if (c.parent_category_id) byId.get(String(c.parent_category_id))?.children.push({ id: String(c.category_id), name: c.category_name.trim() });
  }
  for (const c of top) c.children.sort(byName);
  return top.sort(byName);
}
