import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@ecom/db";
import {
  computeTotals,
  countryName,
  type AdminOrderListQuery,
  type CheckoutInput,
  type CheckoutResultDto,
  type CustomerDto,
  type OrderDto,
  type OrderStatusUpdateInput,
  type OrderTrackingInput,
  type OrderSummaryDto,
  type Paginated,
} from "@ecom/shared";
import { EmailService } from "../email/email.module";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.module";
import { CartService, isAvailable, newToken, type CartOwner } from "./cart.service";
import { assertTransition, orderDetailInclude, orderSummaryInclude, toOrderDto, toOrderSummaryDto, transitionOrder } from "./order-mapping";
import { PaymentsService } from "./payments.service";

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly carts: CartService,
    private readonly email: EmailService,
    private readonly payments: PaymentsService,
  ) {}

  private readonly logger = new Logger(OrdersService.name);

  /**
   * Turns the cart into a PENDING order. With card payments on, also opens the payment page and
   * returns its URL (null if the provider is unreachable; the order page then offers "Pay now"). Prices, availability and totals are recomputed here from the
   * catalog; nothing the browser sent about money is used.
   */
  async checkout(owner: CartOwner, input: CheckoutInput, customer?: CustomerDto): Promise<CheckoutResultDto> {
    const { currency, shipping } = await this.settings.commerce();
    const { country } = input.shippingAddress;
    if (!shipping.countries.includes(country)) {
      throw new BadRequestException(`Sorry, we don't deliver to ${countryName(country)}`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const found = await this.carts.find(owner, tx);
      if (!found) throw new BadRequestException("Your cart is empty");
      // Lock the cart so a double-submitted checkout can't turn the same cart into two orders
      await tx.$executeRaw`SELECT 1 FROM "Cart" WHERE id = ${found.id} FOR UPDATE`;
      const cart = await this.carts.find(owner, tx);
      if (!cart?.items.length) throw new BadRequestException("Your cart is empty");

      const unavailable = cart.items.filter((l) => !isAvailable(l) || !l.variant.inStock);
      if (unavailable.length) {
        const names = unavailable.map((l) => l.variant.product.title).join(", ");
        throw new ConflictException(`Out of stock or no longer available: ${names}. Remove it from your cart to continue.`);
      }
      const undeliverable = cart.items.filter((l) => l.variant.product.notDeliveredTo.includes(country));
      if (undeliverable.length) {
        const names = [...new Set(undeliverable.map((l) => l.variant.product.title))].join(", ");
        throw new ConflictException(`${names} can't be delivered to ${countryName(country)}. Remove it from your cart to continue.`);
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

    // After the commit, so an email never goes out for an order that was rolled back
    const placed = await this.prisma.order.findUniqueOrThrow({ where: { number: result.number }, include: orderDetailInclude });
    // With card payments the customer hears from us once the payment goes through (PaymentsService)
    if (!this.payments.enabled) {
      this.email.orderPlaced(toOrderDto(placed, { admin: false }), placed.accessToken);
      return { ...result, paymentUrl: null };
    }

    const paymentUrl = await this.payments.startCheckout(placed.id).catch((err) => {
      this.logger.error(`Order #${placed.number}: ${err instanceof Error ? err.message : err}`);
      return null;
    });
    return { ...result, paymentUrl };
  }

  /**
   * "Pay now" for an unpaid order. Guests prove access with the order's token; a signed-in
   * customer can pay their own orders without it.
   */
  async pay(number: number, token: string | undefined, customer?: CustomerDto): Promise<{ paymentUrl: string }> {
    if (!this.payments.enabled) throw new NotFoundException();
    const order = await this.prisma.order.findUnique({ where: { number }, select: { id: true, accessToken: true, customerId: true } });
    const allowed = order && ((token && safeEqual(order.accessToken, token)) || (customer && order.customerId === customer.id));
    if (!allowed) throw new NotFoundException("Order not found");
    return { paymentUrl: await this.payments.startCheckout(order.id) };
  }

  /** Guest access: the confirmation link carries the order's secret token. */
  async getWithToken(number: number, token: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { number }, include: orderDetailInclude });
    if (!order || !safeEqual(order.accessToken, token)) throw new NotFoundException("Order not found");
    return toOrderDto(order, { admin: false });
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
    return toOrderDto(order, { admin: false });
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
    return toOrderDto(order, { admin: true });
  }

  /**
   * Moves an order along ORDER_TRANSITIONS and records who did it. With card payments on,
   * cancelling closes the order's open payment pages first, and refunding sends the money back
   * through the provider first, so a failure there leaves the order unchanged.
   */
  async setStatus(number: number, { status, note, tracking }: OrderStatusUpdateInput, actor: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { number }, select: { id: true, status: true } });
    if (!order) throw new NotFoundException("Order not found");
    // Checked up front too, so nothing is refunded or closed for a change that isn't allowed
    assertTransition(order.status, status);

    if (status === "CANCELLED") await this.payments.cancelOpenCheckouts(order.id);
    const refundedPaymentId = status === "REFUNDED" ? await this.payments.refundCardPayment(order.id) : null;

    await this.prisma.$transaction(async (tx) => {
      await transitionOrder(tx, order, status, actor, note);
      if (status === "FULFILLED" && tracking) await tx.order.update({ where: { id: order.id }, data: tracking });
      if (refundedPaymentId) await tx.payment.update({ where: { id: refundedPaymentId }, data: { status: "REFUNDED" } });
    });
    const updated = await this.prisma.order.findUniqueOrThrow({ where: { number }, include: orderDetailInclude });
    // The admin note stays internal; the customer email only says what changed
    this.email.orderStatusChanged(toOrderDto(updated, { admin: false }), updated.accessToken);
    return toOrderDto(updated, { admin: true });
  }

  /**
   * Adds or corrects the tracking details of a shipped order (e.g. when the supplier sends the
   * number after the order was marked shipped). The customer is emailed when there's something new.
   */
  async setTracking(number: number, tracking: OrderTrackingInput, actor: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { number }, select: { id: true, status: true, trackingNumber: true, trackingUrl: true } });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "FULFILLED") throw new ConflictException("Tracking can only be added to a shipped order");
    const changed = tracking.trackingNumber !== order.trackingNumber || tracking.trackingUrl !== order.trackingUrl;
    if (changed) {
      await this.prisma.$transaction([
        this.prisma.order.update({ where: { id: order.id }, data: tracking }),
        this.prisma.orderEvent.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: order.status,
            actor,
            note: tracking.trackingNumber ? `Tracking set to ${tracking.trackingNumber}` : "Tracking removed",
          },
        }),
      ]);
    }
    const updated = await this.prisma.order.findUniqueOrThrow({ where: { number }, include: orderDetailInclude });
    if (changed && (tracking.trackingNumber || tracking.trackingUrl)) {
      this.email.trackingUpdated(toOrderDto(updated, { admin: false }), updated.accessToken);
    }
    return toOrderDto(updated, { admin: true });
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
