import Stripe from "stripe";
import { checkoutSessionParams, StripeProvider } from "./stripe-provider";
import type { PaymentCheckoutRequest } from "./payment-provider";

const WEBHOOK_SECRET = "whsec_test_secret";
const provider = new StripeProvider("sk_test_dummy", WEBHOOK_SECRET);
const stripe = new Stripe("sk_test_dummy");

const request: PaymentCheckoutRequest = {
  orderId: "ord_1",
  orderNumber: 1001,
  email: "ada@example.com",
  currency: "EUR",
  items: [
    { title: "Tee (M)", unitPriceMinor: 2500, quantity: 2 },
    { title: "Mug", unitPriceMinor: 1200, quantity: 1 },
  ],
  shippingMinor: 499,
  totalMinor: 6699,
  successUrl: "https://shop.test/order/1001?token=t&paid=1",
  cancelUrl: "https://shop.test/order/1001?token=t",
};

/** A signed webhook request, as Stripe would send it. */
function signed(event: object, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { body: Buffer.from(payload), headers: { "stripe-signature": header } };
}

const sessionEvent = (type: string, session: Record<string, unknown>) => ({
  id: "evt_1",
  object: "event",
  type,
  data: { object: { id: "cs_test_1", object: "checkout.session", ...session } },
});

describe("StripeProvider", () => {
  it("builds a Checkout Session whose total matches the order", () => {
    const params = checkoutSessionParams(request);
    const items = params.line_items!.reduce((sum, l) => sum + l.price_data!.unit_amount! * l.quantity!, 0);
    const shipping = params.shipping_options![0].shipping_rate_data!.fixed_amount!.amount;
    expect(items + shipping).toBe(request.totalMinor);
    expect(params.line_items![0].price_data!.currency).toBe("eur");
    expect(params).toMatchObject({ mode: "payment", customer_email: "ada@example.com", client_reference_id: "ord_1" });
    expect(checkoutSessionParams({ ...request, shippingMinor: 0 }).shipping_options).toBeUndefined();
  });

  it("marks a paid Checkout Session as succeeded", () => {
    const { body, headers } = signed(
      sessionEvent("checkout.session.completed", {
        payment_status: "paid",
        payment_intent: "pi_1",
        amount_total: 6699,
        currency: "eur",
      }),
    );
    expect(provider.parseWebhook(body, headers)).toMatchObject({
      eventId: "evt_1",
      type: "checkout.session.completed",
      outcome: { kind: "succeeded", providerRef: "cs_test_1", chargeRef: "pi_1", amountMinor: 6699, currency: "EUR" },
    });
  });

  it("waits for delayed payment methods and treats expiry as failure", () => {
    const unpaid = signed(sessionEvent("checkout.session.completed", { payment_status: "unpaid" }));
    expect(provider.parseWebhook(unpaid.body, unpaid.headers).outcome).toEqual({ kind: "ignored" });
    const expired = signed(sessionEvent("checkout.session.expired", {}));
    expect(provider.parseWebhook(expired.body, expired.headers).outcome).toEqual({ kind: "failed", providerRef: "cs_test_1" });
  });

  it("rejects webhooks with a missing or forged signature", () => {
    const event = sessionEvent("checkout.session.completed", { payment_status: "paid" });
    expect(() => provider.parseWebhook(Buffer.from(JSON.stringify(event)), {})).toThrow();
    const forged = signed(event, "whsec_attacker");
    expect(() => provider.parseWebhook(forged.body, forged.headers)).toThrow();
  });
});
