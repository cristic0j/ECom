import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma } from "@ecom/db";
import { MAX_UPLOAD_BYTES, supplierSettingsSchema, type AdminProductDto, type SupplierSettings } from "@ecom/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ProductsService } from "../catalog/products.service";
import { SettingsService } from "../settings/settings.module";
import { STORAGE_DRIVER, type StorageDriver } from "../media/storage";
import { productImageKey, sniffImageType } from "../media/image-types";
import { ALIEXPRESS_CLIENT, AliExpressApiError, type AliExpressApi } from "./aliexpress-client";
import { AliExpressService } from "./aliexpress.service";
import {
  buildImport,
  ImportError,
  isAliExpressHost,
  isAliExpressImageHost,
  parseProductId,
  productUrl,
  type DsProductResponse,
} from "./aliexpress-product";

const SUPPLIER = "aliexpress";
/** Admin-only settings row; the public "store" settings never include it */
const SETTINGS_KEY = "aliexpress";
export const DEFAULT_COUNTRIES = ["NL", "DE", "FR", "ES", "IT", "US"];
/** rsp_code for a product id AliExpress doesn't know */
const NOT_FOUND = "605";

/** URL slug from a title, cut at a whole word (AliExpress titles are long) */
function slugify(title: string): string {
  const full = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (full.length <= 60) return full || "product";
  const cut = full.slice(0, 61);
  const lastDash = cut.lastIndexOf("-");
  return cut.slice(0, lastDash > 20 ? lastDash : 60);
}

@Injectable()
export class AliExpressImportService {
  private readonly logger = new Logger("AliExpress");

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly settings: SettingsService,
    private readonly aliexpress: AliExpressService,
    @Inject(ALIEXPRESS_CLIENT) private readonly client: AliExpressApi | null,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async getSettings(): Promise<SupplierSettings> {
    const row = await this.prisma.storeSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const parsed = supplierSettingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : { countries: DEFAULT_COUNTRIES };
  }

  async saveSettings(settings: SupplierSettings): Promise<SupplierSettings> {
    const value = settings as Prisma.InputJsonValue;
    await this.prisma.storeSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value },
      update: { value },
    });
    return settings;
  }

  /** Creates a draft product from an AliExpress link, with its photos copied into the store's storage. */
  async import(link: string): Promise<AdminProductDto> {
    const client = this.client;
    if (!client) throw new ServiceUnavailableException("AliExpress isn't set up: see Admin → Settings → AliExpress");

    const productId = parseProductId(link) ?? (await this.followShortLink(link));
    if (!productId) {
      throw new BadRequestException("That doesn't look like an AliExpress product link. Copy the link from the product page.");
    }
    await this.assertNotImported(productId);

    const [{ countries }, { currency }, session] = await Promise.all([
      this.getSettings(),
      this.settings.commerce(),
      this.aliexpress.accessToken(),
    ]);

    let draft;
    try {
      const answers = await Promise.all(
        countries.map(async (country) => ({ country, response: await this.fetchProduct(client, session, productId, country, currency) })),
      );
      if (answers.every((a) => !a.response.sold)) {
        const refusal = answers.find((a) => a.response.code !== NOT_FOUND);
        throw new ImportError(
          refusal
            ? `AliExpress won't sell this product to any of your countries (${refusal.response.message}).`
            : "AliExpress couldn't find this product. Check the link, or the product may no longer be sold.",
        );
      }
      draft = buildImport(
        productId,
        answers.map(({ country, response }) => ({ country, response: response.sold ? response.body : null })),
        currency,
      );
    } catch (err) {
      throw this.asHttpError(err);
    }

    const images = await this.copyImages(client, [...draft.images, ...draft.variants.flatMap((v) => (v.image ? [v.image] : []))]);
    const slug = await this.freeSlug(slugify(draft.title));
    const imported = { url: productUrl(productId), importedAt: new Date().toISOString(), countries: draft.countries };

    const id = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          slug,
          title: draft.title,
          description: draft.description,
          status: "DRAFT",
          attributes: draft.attributes,
          priceMinMinor: Math.min(...draft.variants.map((v) => v.priceMinor)),
          supplier: SUPPLIER,
          supplierProductId: productId,
          supplierData: imported as unknown as Prisma.InputJsonValue,
          variants: {
            create: draft.variants.map(({ image: _image, ...v }, position) => ({ ...v, position })),
          },
        },
        include: { variants: { select: { id: true, supplierSkuId: true } } },
      });

      // Gallery photos first, then each option's own photo (linked, so picking the option shows it)
      const variantIdBySku = new Map(product.variants.map((v) => [v.supplierSkuId, v.id]));
      const variantByImage = new Map(draft.variants.flatMap((v) => (v.image ? [[v.image, v] as const] : [])));
      const rows: Prisma.ProductImageCreateManyInput[] = [];
      for (const source of new Set([...draft.images, ...variantByImage.keys()])) {
        const stored = images.get(source);
        if (!stored) continue;
        const variant = variantByImage.get(source);
        rows.push({
          productId: product.id,
          variantId: variant ? variantIdBySku.get(variant.supplierSkuId) : undefined,
          url: stored,
          alt: (variant ? `${draft.title} – ${variant.title}` : draft.title).slice(0, 200),
          position: rows.length,
        });
      }
      if (rows.length) await tx.productImage.createMany({ data: rows });
      return product.id;
    });

    this.logger.log(`Imported AliExpress product ${productId} as a draft (${draft.variants.length} options)`);
    return this.products.getAdminById(id);
  }

  private async fetchProduct(client: AliExpressApi, session: string, productId: string, country: string, currency: string) {
    const response = await client.call<DsProductResponse>(
      "aliexpress.ds.product.get",
      { product_id: productId, ship_to_country: country, target_currency: currency, target_language: "en" },
      session,
    );
    // Any rsp_code but 200 (not found, SHIP_TO_COUNTRY_PROHIBITED…) means "not sold to this country"
    const code = String(response.rsp_code ?? "");
    return { sold: code === "200", code, message: response.rsp_msg ?? code, body: response };
  }

  /** Share links (a.aliexpress.com/_xyz, s.click…) redirect to the product page; only AliExpress hosts are followed. */
  private async followShortLink(link: string): Promise<string | null> {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`);
    } catch {
      return null;
    }
    for (let hop = 0; hop < 5; hop++) {
      if (url.protocol !== "https:" || !isAliExpressHost(url.hostname)) return null;
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) }).catch(() => null);
      const location = res?.headers.get("location");
      if (!location) return null;
      url = new URL(location, url);
      const id = parseProductId(url.toString());
      if (id) return id;
    }
    return null;
  }

  private async assertNotImported(productId: string) {
    const existing = await this.prisma.product.findUnique({
      where: { supplier_supplierProductId: { supplier: SUPPLIER, supplierProductId: productId } },
      select: { title: true },
    });
    if (existing) throw new ConflictException(`This product is already in your store as "${existing.title}"`);
  }

  /** Downloads each photo once; photos that fail or aren't images are skipped rather than failing the import. */
  private async copyImages(client: AliExpressApi, urls: string[]): Promise<Map<string, string>> {
    const stored = new Map<string, string>();
    await Promise.all(
      [...new Set(urls)].map(async (source) => {
        try {
          const url = new URL(source.startsWith("//") ? `https:${source}` : source);
          if (url.protocol !== "https:" || !isAliExpressImageHost(url.hostname)) return;
          const body = await client.fetchImage(url.toString());
          const type = body.length <= MAX_UPLOAD_BYTES ? sniffImageType(body) : null;
          if (!type) return;
          stored.set(source, await this.storage.put(productImageKey(type), body, type));
        } catch (err) {
          this.logger.warn(`Skipped image ${source}: ${err instanceof Error ? err.message : err}`);
        }
      }),
    );
    return stored;
  }

  private async freeSlug(base: string): Promise<string> {
    const taken = new Set(
      (await this.prisma.product.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((p) => p.slug),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  /** Our own explanations and AliExpress refusals → 400; network trouble or outages → 503 */
  private asHttpError(err: unknown) {
    if (err instanceof ImportError) return new BadRequestException(err.message);
    if (err instanceof AliExpressApiError) {
      this.logger.warn(err.message);
      if (/^\d+$/.test(err.code) && Number(err.code) >= 500) {
        return new ServiceUnavailableException("AliExpress couldn't be reached. Try again in a minute.");
      }
      if (/token|session/i.test(err.code)) {
        return new ServiceUnavailableException("The AliExpress connection isn't working: reconnect in Admin → Settings");
      }
      return new BadRequestException(`AliExpress refused the request: ${err.message.replace(/^AliExpress: /, "")}`);
    }
    if (err instanceof Error && /fetch failed|aborted|timeout/i.test(err.message)) {
      return new ServiceUnavailableException("AliExpress couldn't be reached. Try again in a minute.");
    }
    return err;
  }
}
