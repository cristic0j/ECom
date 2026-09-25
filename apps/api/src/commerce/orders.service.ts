import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@ecom/db";
import {
  addressSchema,
  canTransition,
  computeTotals,
  type Address,
  type AdminOrderListQuery,
  type CheckoutInput,
  type CheckoutResultDto,
  type CustomerDto,
  type OrderDto,
  type OrderStatusUpdateInput,
  type OrderSummaryDto,
  type Paginated,
} from "@ecom/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.module";
import { CartService, isAvailable, newToken, type CartOwner } from "./cart.service";

const orderDetailInclude = {
  items: { orderBy: { id: "asc" } },
  events: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.OrderInclude;
const orderSummaryInclude = { items: { select: { quantity: true } } } satisfies Prisma.OrderInclude;

type OrderDetail = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;
type OrderSummary = Prisma.OrderGetPayload<{ include: typeof orderSummaryInclude }>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly carts: CartService,
  ) {}

  /**
   * Turns the cart into a PENDING order. Prices, availability and totals are recomputed here from the
   * catalog; nothing the browser sent about money is used.
   */
  async checkout(owner: CartOwner, input: CheckoutInput, customer?: CustomerDto): Promise<CheckoutResultDto> {
    const { currency, shipping } = await this.settings.commerce();

    return this.prisma.$transaction(async (tx) => {
      const found = await this.carts.find(owner, tx);
      if (!found) throw new BadRequestException("Your cart is empty");
      // Lock the cart so a double-submitted checkout can't turn the same cart into two orders
      await tx.$executeRaw`SELECT 1 FROM "Cart" WHERE id = ${found.id} FOR UPDATE`;
      const cart = await this.carts.find(owner, tx);
      if (!cart?.items.length) throw new BadRequestException("Your cart is empty");

      const unavailable = cart.items.filter((l) => !isAvailable(l));
      if (unavailable.length) {
        const names = unavailable.map((l) => l.variant.product.title).join(", ");
        throw new ConflictException(`No longer available: ${names}. Remove it from your cart to continue.`);
      }

      const lines = cart.items.map((l) => ({
        variantId: l.variantId,
        productTitle: l.variant.product.title,
        variantTitle: l.variant.title,
        sku: l.variant.sku,
        unitPriceMinor: l.variant.priceMinor,
        quantity: l.quantity,
        lineTotalMinor: l.variant.priceMinor * l.quantity,
      }));
      const totals = computeTotals(lines, shipping);

      const order = await tx.order.create({
        data: {
          accessToken: newToken(),
          customerId: customer?.id ?? null,
          email: input.email,
          currency,
          ...totals,
          shippingAddress: input.shippingAddress,
          note: input.note,
          items: { create: lines },
          events: { create: { toStatus: "PENDING", actor: customer ? "customer" : "guest" } },
        },
      });
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return { number: order.number, accessToken: order.accessToken };
    });
  }

  /** Guest access: the confirmation link carries the order's secret token. */
  async getWithToken(number: number, token: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { number }, include: orderDetailInclude });
    if (!order || !safeEqual(order.accessToken, token)) throw new NotFoundException("Order not found");
    return toOrderDto(order, { withEvents: false });
  }

  async listForCustomer(customerId: string): Promise<OrderSummaryDto[]> {
    const orders = await this.prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      include: orderSummaryInclude,
    });
    return orders.map(toOrderSummaryDto);
  }

  async getForCustomer(customerId: string, number: number): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({ where: { number, customerId }, include: orderDetailInclude });
    if (!order) throw new NotFoundException("Order not found");
    return toOrderDto(order, { withEvents: false });
  }

  async adminList({ q, status, page, pageSize }: AdminOrderListQuery): Promise<Paginated<OrderSummaryDto>> {
    const number = q && /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : undefined;
    const where: Prisma.OrderWhereInput = {
      ...(status && { status }),
      ...(q && { OR: [...(number ? [{ number }] : []), { email: { contains: q, mode: "insensitive" as const } }] }),
    };
    const [total, orders] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: orderSummaryInclude,
      }),
    ]);
    return { items: orders.map(toOrderSummaryDto), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async adminGet(number: number): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { number }, include: orderDetailInclude });
    if (!order) throw new NotFoundException("Order not found");
    return toOrderDto(order, { withEvents: true });
  }

  /** Moves an order along ORDER_TRANSITIONS and records who did it. */
  async setStatus(number: number, { status, note }: OrderStatusUpdateInput, actor: string): Promise<OrderDto> {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { number }, select: { id: true, status: true } });
      if (!order) throw new NotFoundException("Order not found");
      if (!canTransition(order.status, status)) {
        throw new ConflictException(`A ${order.status.toLowerCase()} order can't be marked ${status.toLowerCase()}`);
      }
      // Guarded on the old status so two admins clicking at once can't both apply a change
      const { count } = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status } });
      if (count === 0) throw new ConflictException("The order was changed by someone else. Reload and try again.");
      await tx.orderEvent.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: status, actor, note } });
    });
    return this.adminGet(number);
  }

  /** Counts per status, for the admin dashboard. */
  async countsByStatus(): Promise<Record<string, number>> {
    const rows = await this.prisma.order.groupBy({ by: ["status"], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function toOrderSummaryDto(o: OrderSummary | OrderDetail): OrderSummaryDto {
  return {
    id: o.id,
    number: o.number,
    email: o.email,
    status: o.status,
    currency: o.currency,
    totalMinor: o.totalMinor,
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    createdAt: o.createdAt.toISOString(),
  };
}

function toOrderDto(o: OrderDetail, { withEvents }: { withEvents: boolean }): OrderDto {
  const address = addressSchema.safeParse(o.shippingAddress);
  return {
    ...toOrderSummaryDto(o),
    customerId: o.customerId,
    subtotalMinor: o.subtotalMinor,
    shippingMinor: o.shippingMinor,
    shippingAddress: address.success ? address.data : (o.shippingAddress as unknown as Address),
    note: o.note,
    items: o.items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productTitle: i.productTitle,
      variantTitle: i.variantTitle,
      sku: i.sku,
      unitPriceMinor: i.unitPriceMinor,
      quantity: i.quantity,
      lineTotalMinor: i.lineTotalMinor,
    })),
    ...(withEvents && {
      events: o.events.map((e) => ({
        id: e.id,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actor: e.actor,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
    }),
  };
}
