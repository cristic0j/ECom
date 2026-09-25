import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@ecom/db";
import { computeTotals, type CartAddInput, type CartDto, type CartItemDto } from "@ecom/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.module";

export const MAX_LINE_QUANTITY = 99;

/** Who the cart belongs to: a signed-in customer, or a guest identified by the cart cookie. */
export type CartOwner = { customerId: string } | { token: string | undefined };

export const cartInclude = {
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      variant: {
        include: {
          images: { orderBy: { position: "asc" }, take: 1 },
          product: { include: { images: { orderBy: { position: "asc" }, take: 1 } } },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
type CartLine = CartWithItems["items"][number];

export const isAvailable = (line: CartLine) => line.variant.product.status === "ACTIVE";

export const newToken = () => randomBytes(32).toString("base64url");

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** The current cart. Lines whose product was unpublished or archived are dropped. */
  async view(owner: CartOwner): Promise<CartDto> {
    const cart = await this.find(owner);
    if (cart) {
      const gone = cart.items.filter((l) => !isAvailable(l)).map((l) => l.id);
      if (gone.length) {
        await this.prisma.cartItem.deleteMany({ where: { id: { in: gone } } });
        cart.items = cart.items.filter(isAvailable);
      }
    }
    return this.toDto(cart);
  }

  /** Adds a variant (or increases its quantity). Returns a new guest token when a guest cart was created. */
  async add(owner: CartOwner, { variantId, quantity }: CartAddInput): Promise<{ cart: CartDto; token?: string }> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { product: { select: { status: true } } },
    });
    if (!variant || variant.product.status !== "ACTIVE") throw new NotFoundException("This product is not available");

    const { cartId, token } = await this.getOrCreateId(owner);
    const existing = await this.prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId } } });
    const next = Math.min(MAX_LINE_QUANTITY, (existing?.quantity ?? 0) + quantity);
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId } },
      create: { cartId, variantId, quantity: next },
      update: { quantity: next },
    });
    await this.touch(cartId);
    return { cart: await this.view(token ? { token } : owner), token };
  }

  /** Sets a line's quantity; 0 removes it. */
  async update(owner: CartOwner, itemId: string, quantity: number): Promise<CartDto> {
    const cart = await this.find(owner);
    const line = cart?.items.find((l) => l.id === itemId);
    if (!cart || !line) throw new NotFoundException("Cart item not found");
    if (quantity === 0) await this.prisma.cartItem.delete({ where: { id: itemId } });
    else await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    await this.touch(cart.id);
    return this.view(owner);
  }

  /**
   * Moves a guest cart into the customer's cart at login/registration. Quantities of the same
   * variant are added up (capped); the guest cart is then deleted.
   */
  async mergeGuestCart(token: string | undefined, customerId: string): Promise<void> {
    if (!token) return;
    await this.prisma.$transaction(async (tx) => {
      const guest = await tx.cart.findFirst({ where: { token, customerId: null }, include: { items: true } });
      if (!guest) return;
      const own = await tx.cart.findUnique({ where: { customerId }, include: { items: true } });
      if (!own) {
        // Adopt the guest cart; a fresh token means the old cookie can't reach it after logout
        await tx.cart.update({ where: { id: guest.id }, data: { customerId, token: newToken() } });
        return;
      }
      for (const item of guest.items) {
        const current = own.items.find((i) => i.variantId === item.variantId)?.quantity ?? 0;
        const quantity = Math.min(MAX_LINE_QUANTITY, current + item.quantity);
        await tx.cartItem.upsert({
          where: { cartId_variantId: { cartId: own.id, variantId: item.variantId } },
          create: { cartId: own.id, variantId: item.variantId, quantity },
          update: { quantity },
        });
      }
      await tx.cart.delete({ where: { id: guest.id } });
    });
  }

  find(owner: CartOwner, db: Prisma.TransactionClient = this.prisma): Promise<CartWithItems | null> {
    if ("customerId" in owner) return db.cart.findUnique({ where: { customerId: owner.customerId }, include: cartInclude });
    if (!owner.token) return Promise.resolve(null);
    // A guest token never opens a cart that belongs to a customer
    return db.cart.findFirst({ where: { token: owner.token, customerId: null }, include: cartInclude });
  }

  private async getOrCreateId(owner: CartOwner): Promise<{ cartId: string; token?: string }> {
    if ("customerId" in owner) {
      const cart = await this.prisma.cart.upsert({
        where: { customerId: owner.customerId },
        create: { customerId: owner.customerId, token: newToken() },
        update: {},
        select: { id: true },
      });
      return { cartId: cart.id };
    }
    const existing = owner.token
      ? await this.prisma.cart.findFirst({ where: { token: owner.token, customerId: null }, select: { id: true } })
      : null;
    if (existing) return { cartId: existing.id };
    const token = newToken();
    const cart = await this.prisma.cart.create({ data: { token }, select: { id: true } });
    return { cartId: cart.id, token };
  }

  /** Bumps updatedAt, so abandoned carts can be cleaned up by age later. */
  private touch(cartId: string) {
    return this.prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
  }

  private async toDto(cart: CartWithItems | null): Promise<CartDto> {
    const { currency, shipping } = await this.settings.commerce();
    const items = (cart?.items ?? []).map(toCartItemDto);
    return {
      items,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      ...computeTotals(items, shipping),
      currency,
      freeShippingOverMinor: shipping.freeOverMinor,
    };
  }
}

function toCartItemDto(line: CartLine): CartItemDto {
  const { variant } = line;
  const image = variant.images[0] ?? variant.product.images[0] ?? null;
  return {
    id: line.id,
    variantId: variant.id,
    quantity: line.quantity,
    productSlug: variant.product.slug,
    productTitle: variant.product.title,
    variantTitle: variant.title,
    sku: variant.sku,
    // Always the live catalog price; checkout recomputes it again on the server
    unitPriceMinor: variant.priceMinor,
    lineTotalMinor: variant.priceMinor * line.quantity,
    image: image ? { id: image.id, url: image.url, alt: image.alt, variantId: image.variantId } : null,
  };
}
