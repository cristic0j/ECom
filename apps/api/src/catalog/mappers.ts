import type { Category, Prisma } from "@ecom/db";
import type {
  AdminProductDto,
  CategoryDto,
  ImageDto,
  ProductDto,
  ProductSummaryDto,
  SupplierProductInfo,
  VariantDto,
} from "@ecom/shared";

export const productDetailInclude = {
  variants: { orderBy: { position: "asc" } },
  images: { orderBy: { position: "asc" } },
  categories: { include: { category: true } },
} satisfies Prisma.ProductInclude;

export const productSummaryInclude = {
  variants: { orderBy: { priceMinor: "asc" }, select: { compareAtMinor: true, inStock: true } },
  images: { orderBy: { position: "asc" }, take: 1 },
} satisfies Prisma.ProductInclude;

type ProductDetail = Prisma.ProductGetPayload<{ include: typeof productDetailInclude }>;
type ProductSummary = Prisma.ProductGetPayload<{ include: typeof productSummaryInclude }>;

const asStringRecord = (v: Prisma.JsonValue): Record<string, string> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};

function toImageDto(i: ProductDetail["images"][number]): ImageDto {
  return { id: i.id, url: i.url, alt: i.alt, variantId: i.variantId };
}

function toVariantDto(v: ProductDetail["variants"][number]): VariantDto {
  return {
    id: v.id,
    sku: v.sku,
    title: v.title,
    priceMinor: v.priceMinor,
    compareAtMinor: v.compareAtMinor,
    options: asStringRecord(v.options),
    isDefault: v.isDefault,
    inStock: v.inStock,
  };
}

export function toProductDto(p: ProductDetail): ProductDto {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    status: p.status,
    attributes: asStringRecord(p.attributes),
    categories: p.categories.map(({ category: c }) => ({ id: c.id, slug: c.slug, name: c.name })),
    variants: p.variants.map(toVariantDto),
    images: p.images.map(toImageDto),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Admin-only: adds supplier costs and import details. Never use for storefront responses. */
export function toAdminProductDto(p: ProductDetail): AdminProductDto {
  const supplierData = p.supplierData as Omit<SupplierProductInfo, "supplier" | "productId"> | null;
  return {
    ...toProductDto(p),
    variants: p.variants.map((v) => ({ ...toVariantDto(v), costMinor: v.costMinor, supplierSkuId: v.supplierSkuId })),
    supplier:
      p.supplier === "aliexpress" && p.supplierProductId && supplierData
        ? { ...supplierData, supplier: "aliexpress", productId: p.supplierProductId }
        : null,
  };
}

export function toProductSummaryDto(p: ProductSummary): ProductSummaryDto {
  const cheapest = p.variants[0];
  const inStock = p.variants.filter((v) => v.inStock).length;
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    status: p.status,
    priceMinor: p.priceMinMinor,
    compareAtMinor: cheapest?.compareAtMinor ?? null,
    image: p.images[0] ? toImageDto(p.images[0]) : null,
    stock: inStock === p.variants.length ? "in" : inStock === 0 ? "out" : "partial",
  };
}

export function toCategoryDto(c: Category): CategoryDto {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    parentId: c.parentId,
    sortOrder: c.sortOrder,
  };
}

/** Builds a nested tree from a flat, pre-sorted category list. */
export function buildCategoryTree(categories: Category[]): CategoryDto[] {
  const nodes = new Map(categories.map((c) => [c.id, { ...toCategoryDto(c), children: [] as CategoryDto[] }]));
  const roots: CategoryDto[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** Returns the id of the category plus all of its descendants. */
export function collectDescendantIds(categories: Category[], rootId: string): string[] {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i++) {
    for (const c of categories) if (c.parentId === ids[i]) ids.push(c.id);
  }
  return ids;
}
