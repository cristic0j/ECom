import type { IncomingHttpHeaders } from "node:http";

/** What the provider needs to build a hosted payment page for an order. */
export interface PaymentCheckoutRequest {
  orderId: string;
  orderNumber: number;
  email: string;
  currency: string;
  items: { title: string; unitPriceMinor: number; quantity: number }[];
  shippingMinor: number;
  totalMinor: number;
  /** Where the provider sends the customer after paying / after giving up */
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentCheckout {
  /** The provider's id for this attempt (Stripe: Checkout Session id) */
  providerRef: string;
  redirectUrl: string;
  expiresAt: Date | null;
}

/** A webhook event, reduced to what the store acts on. */
export type PaymentOutcome =
  | { kind: "succeeded"; providerRef: string; chargeRef: string | null; amountMinor: number; currency: string }
  | { kind: "failed"; providerRef: string }
  | { kind: "ignored" };

export interface PaymentWebhook {
  eventId: string;
  type: string;
  payload: unknown;
  outcome: PaymentOutcome;
}

/**
 * A payment gateway. Stripe is the first implementation; another gateway only needs to
 * implement this interface and be returned by the factory in commerce.module.ts.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(req: PaymentCheckoutRequest): Promise<PaymentCheckout>;
  /** Closes an unpaid attempt so it can no longer be paid. Throws if it was already paid. */
  cancelCheckout(providerRef: string): Promise<void>;
  /** Verifies the signature and parses the event. Throws on an invalid signature. */
  parseWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): PaymentWebhook;
  /** Refunds a captured payment in full. `idempotencyKey` makes a retried refund safe. */
  refund(chargeRef: string, amountMinor: number, idempotencyKey: string): Promise<void>;
}

/** Injection token. The value is null when `features.payments` is off (orders are paid by hand). */
export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");
