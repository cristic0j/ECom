import type { SupplierCountryInfo } from "@ecom/shared";

/** The parts of `aliexpress.ds.product.get` the import reads. */
export interface DsProductResponse {
  rsp_code?: number | string;
  rsp_msg?: string;
  result?: {
    ae_item_base_info_dto?: { product_id?: string | number; subject?: string; detail?: string };
    ae_multimedia_info_dto?: { image_urls?: string };
    ae_item_sku_info_dtos?: { ae_item_sku_info_d_t_o?: DsSku[] };
    ae_item_properties?: { ae_item_property?: { attr_name?: string; attr_value?: string }[] };
    logistics_info_dto?: { delivery_time?: number | string };
  };
}

export interface DsSku {
  sku_id: string | number;
  offer_sale_price?: string;
  sku_price?: string;
  currency_code?: string;
  sku_available_stock?: number | string;
  ae_sku_property_dtos?: {
    ae_sku_property_d_t_o?: {
      sku_property_id?: number | string;
      sku_property_name?: string;
      sku_property_value?: string;
      property_value_id?: number | string;
      property_value_definition_name?: string;
      sku_image?: string;
    }[];
  };
}

export interface ImportedVariant {
  supplierSkuId: string;
  sku: string;
  title: string;
  options: Record<string, string>;
  /** Highest cost over the countries that sell it, so profit figures stay on the safe side */
  costMinor: number;
  /** A starting point; the owner sets the real price before publishing */
  priceMinor: number;
  inStock: boolean;
  isDefault: boolean;
  image: string | null;
}

export interface ImportedProduct {
  title: string;
  description: string;
  attributes: Record<string, string>;
  variants: ImportedVariant[];
  images: string[];
  countries: SupplierCountryInfo[];
}

export class ImportError extends Error {}

const MAX_VARIANTS = 100;
const MAX_IMAGES = 10;
const MAX_ATTRIBUTES = 30;
/** Imported prices start at cost × this, rounded up to .99; the owner adjusts them */
export const DEFAULT_MARKUP = 2.5;

/**
 * The product id in an AliExpress link (www/m./aliexpress.us item pages, links with a
 * productId parameter) or a bare id; null for anything else, including short links.
 */
export function parseProductId(input: string): string | null {
  const text = input.trim();
  if (/^\d{6,20}$/.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!isAliExpressHost(url.hostname)) return null;
  const fromPath = url.pathname.match(/\/item\/(?:[^/]*\/)?(\d{6,20})(?:\.html)?/);
  if (fromPath) return fromPath[1];
  const fromQuery = url.searchParams.get("productId") ?? url.searchParams.get("product_id");
  return fromQuery && /^\d{6,20}$/.test(fromQuery) ? fromQuery : null;
}

/** aliexpress.com, aliexpress.us and their subdomains (www, m, a, s.click…) */
export const isAliExpressHost = (host: string) => /(^|\.)aliexpress\.(com|us)$/i.test(host);

/** Where AliExpress serves product images; nothing else is downloaded. */
export const isAliExpressImageHost = (host: string) => /(^|\.)(alicdn\.com|aliexpress-media\.com)$/i.test(host);

export const productUrl = (productId: string) => `https://www.aliexpress.com/item/${productId}.html`;

const toMinor = (amount: string | undefined): number | null => {
  if (!amount || !/^\d+(\.\d+)?$/.test(amount.trim())) return null;
  return Math.round(Number(amount) * 100);
};

/** Cost × markup, rounded up to the next whole amount minus 1 cent, e.g. 4.69 → 11.99 */
export const suggestedPrice = (costMinor: number) => Math.max(99, Math.ceil((costMinor * DEFAULT_MARKUP) / 100) * 100 - 1);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** AliExpress descriptions are HTML (mostly styled paragraphs and images); keeps the text only. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "Ships From" is the supplier's warehouse, not something the customer picks. */
const isShipsFrom = (name: string) => /^ships? from$/i.test(name.trim());

const skusOf = (r: DsProductResponse) => r.result?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o ?? [];
const costOf = (s: DsSku) => toMinor(s.offer_sale_price) ?? toMinor(s.sku_price);
const stockOf = (s: DsSku) => Number(s.sku_available_stock ?? 0) || 0;

/**
 * Turns `aliexpress.ds.product.get` answers (one per country, in the owner's order; null where the
 * product isn't sold) into a draft product. Option values the seller gave the same name (two
 * different "Black"s) are numbered so they stay separate.
 */
export function buildImport(
  productId: string,
  answers: { country: string; response: DsProductResponse | null }[],
  currency: string,
): ImportedProduct {
  const sold = answers.filter((a) => a.response && skusOf(a.response).length > 0);
  const base = sold[0]?.response;
  if (!base) throw new ImportError("AliExpress doesn't sell this product to any of your countries");

  const wrongCurrency = sold.flatMap((a) => skusOf(a.response!)).find((s) => s.currency_code && s.currency_code !== currency);
  if (wrongCurrency) {
    throw new ImportError(`AliExpress returned prices in ${wrongCurrency.currency_code}, not the store's ${currency}`);
  }

  const info = base.result!.ae_item_base_info_dto ?? {};
  const title = (info.subject ?? "").trim().slice(0, 200) || `AliExpress product ${productId}`;

  // Costs per sku per country, for the per-variant maximum and the country table
  const costs = new Map<string, number[]>();
  for (const a of sold) {
    for (const s of skusOf(a.response!)) {
      const cost = costOf(s);
      if (cost !== null) costs.set(String(s.sku_id), [...(costs.get(String(s.sku_id)) ?? []), cost]);
    }
  }

  // Name each option value; a second value with the same name becomes "Black (2)"
  const valueNames = new Map<string, string>();
  const usedNames = new Map<string, Set<string>>();
  const nameValue = (option: string, valueKey: string, name: string) => {
    const key = `${option}\u0000${valueKey}`;
    const known = valueNames.get(key);
    if (known) return known;
    const used = usedNames.get(option) ?? new Set<string>();
    let unique = name;
    for (let n = 2; used.has(unique.toLowerCase()); n++) unique = `${name} (${n})`;
    used.add(unique.toLowerCase());
    usedNames.set(option, used);
    valueNames.set(key, unique);
    return unique;
  };

  // One store variant per option combination; when only "Ships From" differs, keep the in-stock, cheapest one
  const byCombination = new Map<string, ImportedVariant>();
  for (const s of skusOf(base)) {
    const skuId = String(s.sku_id);
    const allCosts = costs.get(skuId);
    if (!allCosts?.length) continue;
    const options: Record<string, string> = {};
    let image: string | null = null;
    for (const p of s.ae_sku_property_dtos?.ae_sku_property_d_t_o ?? []) {
      const option = (p.sku_property_name ?? "").trim();
      if (!option || isShipsFrom(option)) continue;
      const display = (p.property_value_definition_name || p.sku_property_value || "").trim();
      if (!display) continue;
      options[option] = nameValue(option, String(p.property_value_id ?? display), display);
      image ??= p.sku_image || null;
    }
    const costMinor = Math.max(...allCosts);
    const variant: ImportedVariant = {
      supplierSkuId: skuId,
      sku: `AE-${skuId}`.slice(0, 64),
      title: Object.values(options).join(" / ") || "Default",
      options,
      costMinor,
      priceMinor: suggestedPrice(costMinor),
      inStock: stockOf(s) > 0,
      isDefault: false,
      image,
    };
    const key = JSON.stringify(Object.entries(options).sort());
    const current = byCombination.get(key);
    const better =
      !current ||
      (variant.inStock && !current.inStock) ||
      (variant.inStock === current.inStock && variant.costMinor < current.costMinor);
    if (better) byCombination.set(key, variant);
  }

  const variants = [...byCombination.values()].slice(0, MAX_VARIANTS);
  if (!variants.length) throw new ImportError("AliExpress returned no prices for this product");
  const firstInStock = variants.findIndex((v) => v.inStock);
  variants[Math.max(0, firstInStock)].isDefault = true;

  const imageUrls = (base.result!.ae_multimedia_info_dto?.image_urls ?? "")
    .split(";")
    .map((u) => u.trim())
    .filter(Boolean);

  const attributes: Record<string, string> = {};
  for (const p of base.result!.ae_item_properties?.ae_item_property ?? []) {
    const name = p.attr_name?.trim();
    const value = p.attr_value?.trim();
    if (!name || !value || Object.keys(attributes).length >= MAX_ATTRIBUTES) continue;
    attributes[name] = attributes[name] ? `${attributes[name]}, ${value}` : value;
  }

  const countries: SupplierCountryInfo[] = answers.map(({ country, response }) => {
    const prices = response ? skusOf(response).flatMap((s) => costOf(s) ?? []) : [];
    const days = Number(response?.result?.logistics_info_dto?.delivery_time);
    return {
      country,
      available: prices.length > 0,
      costMinor: prices.length ? Math.min(...prices) : null,
      deliveryDays: prices.length && Number.isFinite(days) && days > 0 ? days : null,
    };
  });

  return {
    title,
    description: htmlToText(info.detail ?? "").slice(0, 20000),
    attributes,
    variants,
    images: [...new Set(imageUrls)].slice(0, MAX_IMAGES),
    countries,
  };
}
