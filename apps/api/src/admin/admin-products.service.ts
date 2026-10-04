import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ProductStatus } from "@ecom/db";
import type { AdminProductDto, ProductInput } from "@ecom/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ProductsService } from "../catalog/products.service";
import { minPrice, normalizeProductInput } from "./normalize-product";
import { supplierBlocked, withSupplierBlocks } from "../suppliers/aliexpress-product";

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  async create(raw: ProductInput): Promise<AdminProductDto> {
    const input = normalizeProductInput(raw);
    const product = await this.prisma.product.create({
      data: {
        slug: input.slug,
        title: input.title,
        description: input.description,
        status: input.status,
        attributes: input.attributes,
        notDeliveredTo: input.notDeliveredTo,
        priceMinMinor: minPrice(input),
        categories: { create: input.categoryIds.map((categoryId) => ({ categoryId })) },
        variants: {
          create: input.variants.map(({ id: _id, ...v }, position) => ({ ...v, position })),
        },
        images: { create: input.images.map((img, position) => ({ ...img, position })) },
      },
    });
    return this.products.getAdminById(product.id);
  }

  /**
   * Full replace of the product. Variants are matched by id so existing variant ids stay
   * stable (future orders/inventory will reference them); unmatched ones are deleted.
   */
  async update(id: string, raw: ProductInput): Promise<AdminProductDto> {
    const input = normalizeProductInput(raw);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id }, include: { variants: { select: { id: true } } } });
      if (!existing) throw new NotFoundException("Product not found");
      const notDeliveredTo = withSupplierBlocks(input.notDeliveredTo, supplierBlocked(existing.supplierData));

      const ownIds = new Set(existing.variants.map((v) => v.id));
      const foreign = input.variants.filter((v) => v.id && !ownIds.has(v.id));
      if (foreign.length) throw new BadRequestException("Variant id does not belong to this product");

      const keepIds = input.variants.flatMap((v) => (v.id ? [v.id] : []));
      await tx.productVariant.deleteMany({ where: { productId: id, id: { notIn: keepIds } } });

      // Temporarily rename kept SKUs so swapping SKUs between variants doesn't trip the unique index
      for (const vid of keepIds) {
        await tx.productVariant.update({ where: { id: vid }, data: { sku: `__tmp__${vid}` } });
      }
      for (const [position, { id: vid, ...v }] of input.variants.entries()) {
        const data = { ...v, compareAtMinor: v.compareAtMinor ?? null, position };
        if (vid) await tx.productVariant.update({ where: { id: vid }, data });
        else await tx.productVariant.create({ data: { ...data, productId: id } });
      }

      await tx.productCategory.deleteMany({ where: { productId: id } });
      await tx.productImage.deleteMany({ where: { productId: id } });

      await tx.product.update({
        where: { id },
        data: {
          slug: input.slug,
          title: input.title,
          description: input.description,
          status: input.status,
          attributes: input.attributes,
          notDeliveredTo,
          priceMinMinor: minPrice(input),
          categories: { create: input.categoryIds.map((categoryId) => ({ categoryId })) },
          images: { create: input.images.map((img, position) => ({ ...img, position })) },
        },
      });
    });

    return this.products.getAdminById(id);
  }

  async setStatus(id: string, status: ProductStatus): Promise<AdminProductDto> {
    await this.prisma.product.update({ where: { id }, data: { status } });
    return this.products.getAdminById(id);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.product.delete({ where: { id } });
  }
}
