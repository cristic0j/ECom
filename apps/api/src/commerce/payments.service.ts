import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { IncomingHttpHeaders } from "node:http";
import { formatMoney } from "@ecom/shared";
import type { Prisma } from "@ecom/db";
import { env } from "../config/env";
import { EmailService } from "../email/email.module";
import { PrismaService } from "../prisma/prisma.service";
import { PAYMENT_PROVIDER, type PaymentOutcome, type PaymentProvider } from "../payments/payment-provider";
import { orderDetailInclude, toOrderDto, transitionOrder } from "./order-mapping";

/** Actor recorded in the order history for changes made by the payment webhook. */
const WEBHOOK_ACTOR = "payment provider";
/** Reuse an open payment page unless it expires sooner than this. */
const MIN_REMAINING_MS = 10 * 60_000;

const siteUrl = (path: string) => `${env.SITE_URL.replace(/\/$/, "")}${path}`;

/**
 * Card payments through a PaymentProvider. An order only becomes PAID from a verified webhook,
 * never from the customer's browser coming back from the payment page.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null,
  ) {}

  /** False when `features.payments` is off: orders are paid by hand and marked paid in the admin. */
  get enabled(): boolean {
    return this.provider !== null;
  }

  /**
   * Returns the payment page URL for an unpaid order. Reuses the open page if there is one, so a
   * customer clicking "Pay now" twice can't end up paying twice.
   */
  async startCheckout(orderId: string): Promise<string> {
    const provider = this.requireProvider();
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDetailInclude });
    if (order.status !== "PENDING") throw new ConflictException("This order doesn't need a payment");

    const open = [...order.payments].reverse().find(
      (p) => p.status === "PENDING" && p.redirectUrl && (!p.expiresAt || p.expiresAt.getTime() - Date.now() > MIN_REMAINING_MS),
    );
    if (open?.redirectUrl) return open.redirectUrl;

    const orderUrl = `/order/${order.number}?token=${encodeURIComponent(order.accessToken)}`;
    const checkout = await provider
      .createCheckout({
      orderId: order.id,
      orderNumber: order.number,
      email: order.email,
      currency: order.currency,
      items: order.items.map((i) => ({
        title: i.variantTitle === "Default" ? i.productTitle : `${i.productTitle} (${i.variantTitle})`,
        unitPriceMinor: i.unitPriceMinor,
        quantity: i.quantity,
      })),
      shippingMinor: order.shippingMinor,
      totalMinor: order.totalMinor,
      successUrl: siteUrl(`${orderUrl}&paid=1`),
      cancelUrl: siteUrl(orderUrl),
      })
      .catch((err) => {
        this.logger.error(`Couldn't create a payment page for order ${order.number}: ${err instanceof Error ? err.message : err}`);
        throw new ServiceUnavailableException("We couldn't open the payment page. Please try again in a moment.");
      });
    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: provider.name,
        providerRef: checkout.providerRef,
        amountMinor: order.totalMinor,
        currency: order.currency,
        redirectUrl: checkout.redirectUrl,
        expiresAt: checkout.expiresAt,
      },
    });
    return checkout.redirectUrl;
  }

  /**
   * Closes every open payment page of an order (before cancelling it), so it can't be paid
   * afterwards. Refuses if one of them was already paid and the webhook hasn't arrived yet.
   */
  async cancelOpenCheckouts(orderId: string): Promise<void> {
    if (!this.provider) return;
    const open = await this.prisma.payment.findMany({ where: { orderId, status: "PENDING" } });
    for (const p of open) {
      try {
        await this.provider.cancelCheckout(p.providerRef);
      } catch (err) {
        this.logger.warn(`Couldn't close payment ${p.providerRef}: ${err instanceof Error ? err.message : err}`);
        throw new ConflictException("A card payment for this order may be in progress. Try again in a minute.");
      }
      await this.prisma.payment.update({ where: { id: p.id }, data: { status: "FAILED", redirectUrl: null } });
    }
  }

  /**
   * Refunds the order's card payment in full, if it has one, and returns that payment's id (the
   * caller marks it REFUNDED together with the order). Called before the order changes, so a failed
   * refund leaves the order as it was; the idempotency key makes a repeated call refund only once.
   */
  async refundCardPayment(orderId: string): Promise<string | null> {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
    });
    if (!payment) return null;
    const provider = this.requireProvider();
    if (!payment.chargeRef) throw new ConflictException("This payment can't be refunded from here; refund it in Stripe.");
    try {
      await provider.refund(payment.chargeRef, payment.amountMinor, `refund-${payment.id}`);
    } catch (err) {
      this.logger.error(`Refund of ${payment.chargeRef} failed: ${err instanceof Error ? err.message : err}`);
      throw new ServiceUnavailableException("Stripe couldn't refund this payment. Try again, or refund it in Stripe.");
    }
    return payment.id;
  }

  async handleWebhook(rawBody: Buffer | undefined, headers: IncomingHttpHeaders): Promise<void> {
    const provider = this.provider;
    if (!provider) throw new NotFoundException();
    if (!rawBody) throw new BadRequestException("Missing request body");
    let webhook;
    try {
      webhook = provider.parseWebhook(rawBody, headers);
    } catch (err) {
      this.logger.warn(`Rejected webhook: ${err instanceof Error ? err.message : err}`);
      throw new BadRequestException("Invalid webhook signature");
    }

    // The event row and its effects commit together: a provider retry of an event that was
    // already applied finds the row and stops; one that failed halfway is applied again.
    const paidOrderId = await this.prisma.$transaction(async (tx) => {
      const key = { provider_eventId: { provider: provider.name, eventId: webhook.eventId } };
      if (await tx.paymentWebhookEvent.findUnique({ where: key })) return null;
      await tx.paymentWebhookEvent.create({
        data: {
          provider: provider.name,
          eventId: webhook.eventId,
          type: webhook.type,
          payload: webhook.payload as Prisma.InputJsonValue,
        },
      });
      return this.apply(tx, provider.name, webhook.outcome);
    });

    if (paidOrderId) {
      const order = await this.prisma.order.findUniqueOrThrow({ where: { id: paidOrderId }, include: orderDetailInclude });
      this.email.orderPaidOnline(toOrderDto(order, { admin: false }), order.accessToken);
    }
  }

  /** Applies a webhook outcome. Returns the order id if the order just became PAID. */
  private async apply(tx: Prisma.TransactionClient, provider: string, outcome: PaymentOutcome): Promise<string | null> {
    if (outcome.kind === "ignored") return null;
    const payment = await tx.payment.findUnique({
      where: { provider_providerRef: { provider, providerRef: outcome.providerRef } },
      include: { order: { select: { id: true, status: true, totalMinor: true, currency: true } } },
    });
    if (!payment) {
      this.logger.warn(`Webhook for unknown payment ${outcome.providerRef}; ignored`);
      return null;
    }

    if (outcome.kind === "failed") {
      await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", redirectUrl: null } });
      return null;
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "SUCCEEDED", chargeRef: outcome.chargeRef, amountMinor: outcome.amountMinor, redirectUrl: null },
    });
    const { order } = payment;
    const received = formatMoney(outcome.amountMinor, outcome.currency || order.currency, "en-US");
    // Something the admin has to sort out by hand: record it in the order history, keep the status
    const flag = (note: string) => {
      this.logger.warn(`Order ${order.id}: ${note}`);
      return tx.orderEvent.create({
        data: { orderId: order.id, fromStatus: order.status, toStatus: order.status, actor: WEBHOOK_ACTOR, note },
      });
    };

    if (outcome.amountMinor !== order.totalMinor || outcome.currency !== order.currency) {
      await flag(`Received ${received}, which doesn't match the order total. Not marked paid; check the payment in Stripe.`);
      return null;
    }
    if (order.status !== "PENDING") {
      await flag(`A second payment of ${received} was received for this ${order.status.toLowerCase()} order. Refund it in Stripe.`);
      return null;
    }
    await transitionOrder(tx, order, "PAID", WEBHOOK_ACTOR, `Paid online (${received})`);
    return order.id;
  }

  private requireProvider(): PaymentProvider {
    if (!this.provider) throw new ServiceUnavailableException("Card payments aren't enabled");
    return this.provider;
  }
}
