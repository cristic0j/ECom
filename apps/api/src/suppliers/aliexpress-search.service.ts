import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { SupplierCategoryDto, SupplierSearchQuery, SupplierSearchResultDto } from "@ecom/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.module";
import { ALIEXPRESS_CLIENT, AliExpressApiError, type AliExpressApi } from "./aliexpress-client";
import { AliExpressService } from "./aliexpress.service";
import {
  categoryTree,
  FEED_MOST_SOLD,
  feedItems,
  feedTotalPages,
  filterHits,
  pickFeed,
  SEARCH_PAGE_SIZE,
  searchItems,
  searchParams,
  searchTotalPages,
  type DsCategoryResponse,
  type DsFeedNameResponse,
  type DsFeedResponse,
  type DsSearchResponse,
} from "./aliexpress-search";

/** AliExpress's category and feed lists hardly change; keep them for a day */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Finding products on AliExpress from the admin. */
@Injectable()
export class AliExpressSearchService {
  private readonly logger = new Logger("AliExpress");
  private categoryCache: { at: number; tree: SupplierCategoryDto[] } | null = null;
  private feedCache: { at: number; name: string } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly aliexpress: AliExpressService,
    @Inject(ALIEXPRESS_CLIENT) private readonly client: AliExpressApi | null,
  ) {}

  async categories(): Promise<SupplierCategoryDto[]> {
    if (this.categoryCache && Date.now() - this.categoryCache.at < CACHE_TTL_MS) return this.categoryCache.tree;
    const response = await this.ask<DsCategoryResponse>("aliexpress.ds.category.get", {});
    const tree = categoryTree(response);
    if (tree.length) this.categoryCache = { at: Date.now(), tree };
    return tree;
  }

  /**
   * Costs and sales as AliExpress shows them for the store's first delivery country. Words and/or a
   * subcategory use AliExpress's search. Without words, a main category (or none) uses its bestseller list,
   * because AliExpress's search returns unrelated products for a main category on its own.
   */
  async search(query: SupplierSearchQuery): Promise<SupplierSearchResultDto> {
    const { currency, shipping } = await this.settings.commerce();
    const country = shipping.countries[0];
    const browse =
      !query.q && (!query.categoryId || (await this.categories()).some((c) => c.id === query.categoryId));
    const found = browse
      ? await this.bestsellers(query.categoryId, query.page, query.sort === "orders", country, currency)
      : await this.textSearch(query, country, currency);
    const all = found.items(await this.importedIds(found.ids));
    const items = filterHits(all, query);
    return {
      items,
      page: query.page,
      totalPages: found.totalPages,
      country,
      hidden: all.length - items.length,
      source: browse ? "bestsellers" : "search",
    };
  }

  private async textSearch(query: SupplierSearchQuery, country: string, currency: string) {
    const response = await this.ask<DsSearchResponse>("aliexpress.ds.text.search", searchParams(query, country, currency));
    if (response.code !== "00") {
      this.logger.warn(`Search "${query.q}" failed: ${response.code} ${response.msg ?? ""}`);
      throw new BadRequestException("AliExpress couldn't run this search. Try other words or another category.");
    }
    return {
      ids: (response.data?.products?.selection_search_product ?? []).map((p) => String(p.itemId)),
      items: (imported: Map<string, string>) => searchItems(response, currency, imported),
      totalPages: searchTotalPages(response),
    };
  }

  /** AliExpress's bestsellers, in one main category or across all of them */
  private async bestsellers(categoryId: string | undefined, page: number, mostSold: boolean, country: string, currency: string) {
    const response = await this.ask<DsFeedResponse>("aliexpress.ds.recommend.feed.get", {
      feed_name: await this.feedName(),
      ...(categoryId && { category_id: categoryId }),
      country,
      target_currency: currency,
      target_language: "EN",
      page_size: String(SEARCH_PAGE_SIZE),
      page_no: String(page),
      ...(mostSold && { sort: FEED_MOST_SOLD }),
    });
    if (String(response.rsp_code) !== "200") {
      this.logger.warn(`Bestsellers for category ${categoryId ?? "(all)"} failed: ${response.rsp_code} ${response.rsp_msg ?? ""}`);
      throw new BadRequestException("AliExpress couldn't list this category. Try typing what you're looking for.");
    }
    return {
      ids: (response.result?.products?.traffic_product_d_t_o ?? []).map((p) => String(p.product_id)),
      items: (imported: Map<string, string>) => feedItems(response, currency, imported, { bySales: mostSold }),
      totalPages: feedTotalPages(response),
    };
  }

  private async feedName(): Promise<string> {
    if (this.feedCache && Date.now() - this.feedCache.at < CACHE_TTL_MS) return this.feedCache.name;
    const name = pickFeed(await this.ask<DsFeedNameResponse>("aliexpress.ds.feedname.get", {}));
    if (!name) throw new BadRequestException("AliExpress has no product lists to browse right now. Type what you're looking for.");
    this.feedCache = { at: Date.now(), name };
    return name;
  }

  /** AliExpress product id → the store's product id, for results already imported */
  private async importedIds(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.product.findMany({
      where: { supplier: "aliexpress", supplierProductId: { in: ids } },
      select: { id: true, supplierProductId: true },
    });
    return new Map(rows.map((p) => [p.supplierProductId!, p.id]));
  }

  private async ask<T>(method: string, params: Record<string, string>): Promise<T> {
    if (!this.client) throw new ServiceUnavailableException("AliExpress isn't set up: see Admin → Settings → AliExpress");
    const session = await this.aliexpress.accessToken();
    try {
      return await this.client.call<T>(method, params, session);
    } catch (err) {
      this.logger.warn(err instanceof Error ? err.message : String(err));
      if (err instanceof AliExpressApiError && /token|session/i.test(err.code)) {
        throw new ServiceUnavailableException("The AliExpress connection isn't working: reconnect in Admin → Settings");
      }
      throw new ServiceUnavailableException("AliExpress couldn't be reached. Try again in a minute.");
    }
  }
}
