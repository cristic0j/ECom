import type { IncomingHttpHeaders } from "node:http";
import Stripe from "stripe";
import type {
  PaymentCheckout,
  PaymentCheckoutRequest,
  PaymentOutcome,
  PaymentProvider,
  PaymentWebhook,
} from "./payment-provider";

/**
 * Stripe Checkout (Stripe's hosted payment page). Payment methods (cards, Apple Pay, Google Pay,
 * local methods) are chosen in the Stripe dashboard, not here.
 */
export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, { timeout: 15_000, maxNetworkRetries: 2 });
  }

  async createCheckout(req: PaymentCheckoutRequest): Promise<PaymentCheckout> {
    // The SDK adds an idempotency key to its own network retries, so a retry never creates a second session
    const session = await this.stripe.checkout.sessions.create(checkoutSessionParams(req));
    if (!session.url) throw new Error("Stripe did not return a payment page URL");
    return {
      providerRef: session.id,
      redirectUrl: session.url,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
    };
  }

  async cancelCheckout(providerRef: string): Promise<void> {
    const session = await this.stripe.checkout.sessions.retrieve(providerRef);
    if (session.status === "expired") return;
    if (session.status === "complete") throw new Error("This payment was already completed");
    await this.stripe.checkout.sessions.expire(providerRef);
  }

  parseWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): PaymentWebhook {
    const signature = headers["stripe-signature"];
    if (typeof signature !== "string") throw new Error("Missing Stripe-Signature header");
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    return { eventId: event.id, type: event.type, payload: event, outcome: outcomeOf(event) };
  }

  async refund(chargeRef: string, amountMinor: number, idempotencyKey: string): Promise<void> {
    await this.stripe.refunds.create({ payment_intent: chargeRef, amount: amountMinor }, { idempotencyKey });
  }
}

/** The Checkout Session for an order. Exported for tests. */
export function checkoutSessionParams(req: PaymentCheckoutRequest): Stripe.Checkout.SessionCreateParams {
  const currency = req.currency.toLowerCase();
  return {
    mode: "payment",
    customer_email: req.email,
    client_reference_id: req.orderId,
    metadata: { orderId: req.orderId, orderNumber: String(req.orderNumber) },
    payment_intent_data: { metadata: { orderId: req.orderId, orderNumber: String(req.orderNumber) } },
    line_items: req.items.map((i) => ({
      quantity: i.quantity,
      price_data: { currency, unit_amount: i.unitPriceMinor, product_data: { name: i.title } },
    })),
    ...(req.shippingMinor > 0 && {
      shipping_options: [
        {
          shipping_rate_data: {
            display_name: "Shipping",
            type: "fixed_amount",
            fixed_amount: { amount: req.shippingMinor, currency },
          },
        },
      ],
    }),
    locale: "auto",
    success_url: req.successUrl,
    cancel_url: req.cancelUrl,
  };
}

/** Exported for tests. */
export function outcomeOf(event: Stripe.Event): PaymentOutcome {
  switch (event.type) {
    case "checkout.session.completed":
      // Card payments arrive as "paid". Delayed methods (e.g. SEPA debit) complete as "unpaid"
      // and are settled later by async_payment_succeeded / async_payment_failed.
      return event.data.object.payment_status === "paid" ? succeeded(event.data.object) : { kind: "ignored" };
    case "checkout.session.async_payment_succeeded":
      return succeeded(event.data.object);
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return { kind: "failed", providerRef: event.data.object.id };
    default:
      return { kind: "ignored" };
  }
}

function succeeded(session: Stripe.Checkout.Session): PaymentOutcome {
  const pi = session.payment_intent;
  return {
    kind: "succeeded",
    providerRef: session.id,
    chargeRef: typeof pi === "string" ? pi : (pi?.id ?? null),
    amountMinor: session.amount_total ?? 0,
    currency: (session.currency ?? "").toUpperCase(),
  };
}
