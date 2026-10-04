import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, ProductStatus } from "@ecom/db";
import type { AdminProductDto, AdminProductListQuery, Paginated, ProductDto, ProductSummaryDto } from "@ecom/shared";
import { PrismaService } from "../prisma/prisma.service";
import {
  collectDescendantIds,
  productDetailInclude,
  productSummaryInclude,
  toAdminProductDto,
  toProductDto,
  toProductSummaryDto,
} from "./mappers";

const ORDER_BY: Record<AdminProductListQuery["sort"], Prisma.ProductOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }, { id: "asc" }],
  price_asc: [{ priceMinMinor: "asc" }, { id: "asc" }],
  price_desc: [{ priceMinMinor: "desc" }, { id: "asc" }],
  title: [{ title: "asc" }, { id: "asc" }],
};

/** Read-side product queries shared by the public catalog and the admin panel. */
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminProductListQuery): Promise<Paginated<ProductSummaryDto>> {
    const where = await this.buildWhere(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: productSummaryInclude,
        orderBy: ORDER_BY[query.sort],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(toProductSummaryDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async getBySlug(slug: string, status?: ProductStatus): Promise<ProductDto> {
    const product = await this.prisma.product.findFirst({
      where: { slug, ...(status && { status }) },
      include: productDetailInclude,
    });
    if (!product) throw new NotFoundException("Product not found");
    return toProductDto(product);
  }

  /** Admin view, with supplier costs. */
  async getAdminById(id: string): Promise<AdminProductDto> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: productDetailInclude });
    if (!product) throw new NotFoundException("Product not found");
    return toAdminProductDto(product);
  }

  /** Slugs of active products, for the sitemap. */
  async activeSlugs(): Promise<{ slug: string; updatedAt: string }[]> {
    const rows = await this.prisma.product.findMany({
      where: { status: "ACTIVE" },
      select: { slug: true, updatedAt: true },
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
  }

  private async buildWhere(query: AdminProductListQuery): Promise<Prisma.ProductWhereInput> {
    const and: Prisma.ProductWhereInput[] = [];
    if (query.status) and.push({ status: query.status });
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: "insensitive" } },
          { description: { contains: query.q, mode: "insensitive" } },
          { variants: { some: { sku: { equals: query.q, mode: "insensitive" } } } },
        ],
      });
    }
    if (query.category) {
      const all = await this.prisma.category.findMany();
      const root = all.find((c) => c.slug === query.category);
      // Unknown category → no results rather than silently ignoring the filter
      const ids = root ? collectDescendantIds(all, root.id) : [];
      and.push({ categories: { some: { categoryId: { in: ids } } } });
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      and.push({ priceMinMinor: { gte: query.minPrice, lte: query.maxPrice } });
    }
    return { AND: and };
  }
}
