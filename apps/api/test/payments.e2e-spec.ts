import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { hash } from "@node-rs/argon2";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { PrismaService } from "../src/prisma/prisma.service";
import { EMAIL_PROVIDER, type EmailMessage, type EmailProvider } from "../src/email/email-provider";
import { EmailService } from "../src/email/email.module";
import {
  PAYMENT_PROVIDER,
  type PaymentCheckoutRequest,
  type PaymentOutcome,
  type PaymentProvider,
} from "../src/payments/payment-provider";

/** Stands in for Stripe: records calls, and accepts webhooks carrying a fixed test signature. */
class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  created: PaymentCheckoutRequest[] = [];
  cancelled: string[] = [];
  refunds: { chargeRef: string; amountMinor: number; idempotencyKey: string }[] = [];
  /** Sessions the customer already paid: they can't be cancelled */
  paid = new Set<string>();
  failCreate = false;

  async createCheckout(req: PaymentCheckoutRequest) {
    if (this.failCreate) throw new Error("provider down");
    this.created.push(req);
    const providerRef = `cs_${this.created.length}`;
    return { providerRef, redirectUrl: `https://pay.test/${providerRef}`, expiresAt: new Date(Date.now() + 86_400_000) };
  }
  async cancelCheckout(providerRef: string) {
    if (this.paid.has(providerRef)) throw new Error("already completed");
    this.cancelled.push(providerRef);
  }
  parseWebhook(rawBody: Buffer, headers: Record<string, unknown>) {
    if (headers["x-test-signature"] !== "valid") throw new Error("bad signature");
    const event = JSON.parse(rawBody.toString()) as { id: string; outcome: PaymentOutcome };
    return { eventId: event.id, type: "test.event", payload: event, outcome: event.outcome };
  }
  async refund(chargeRef: string, amountMinor: number, idempotencyKey: string) {
    this.refunds.push({ chargeRef, amountMinor, idempotencyKey });
  }
}

describe("Card payments (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let emails: EmailService;
  let adminCookie: string[];
  let variantId: string;
  const payments = new FakePaymentProvider();
  const outbox: EmailMessage[] = [];
  const emailProvider: EmailProvider = { send: async (m) => void outbox.push(m) };
  const address = { name: "Ada Buyer", line1: "1 Main St", city: "Berlin", postalCode: "10115", country: "DE" };
  let eventSeq = 0;

  const http = () => request(app.getHttpServer());
  const sent = async () => {
    await emails.flush();
    return outbox.splice(0);
  };
  const webhook = (outcome: PaymentOutcome, id = `evt_${++eventSeq}`) =>
    http().post("/api/payments/webhook").set("x-test-signature", "valid").send({ id, outcome });
  const paidOutcome = (providerRef: string, amountMinor: number) =>
    ({ kind: "succeeded", providerRef, chargeRef: `pi_${providerRef}`, amountMinor, currency: "EUR" }) as const;

  /** A guest buys 2 × €20 (+ €5 shipping = €45.00) and gets redirected to the payment page. */
  async function placeOrder() {
    const guest = request.agent(app.getHttpServer());
    await guest.post("/api/cart/items").send({ variantId, quantity: 2 }).expect(201);
    const res = await guest.post("/api/checkout").send({ email: "ada@example.com", shippingAddress: address }).expect(201);
    return res.body as { number: number; accessToken: string; paymentUrl: string | null };
  }
  const orderOf = async (number: number) =>
    (await http().get(`/api/admin/orders/${number}`).set("Cookie", adminCookie).expect(200)).body;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes("schema=e2e")) {
      throw new Error("Refusing to run e2e tests outside the e2e schema");
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(emailProvider)
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(payments)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    emails = app.get(EmailService);

    await prisma.$executeRawUnsafe(
      `TRUNCATE "Product", "Category", "AdminUser", "StoreSetting", "Customer", "Cart", "Order", "PaymentWebhookEvent" RESTART IDENTITY CASCADE`,
    );
    await prisma.adminUser.create({ data: { email: "admin@test.dev", passwordHash: await hash("pass12345"), role: "ADMIN" } });
    adminCookie = (await http().post("/api/auth/login").send({ email: "admin@test.dev", password: "pass12345" }).expect(200)).get(
      "Set-Cookie",
    )!;
    await http()
      .put("/api/admin/settings")
      .set("Cookie", adminCookie)
      .send({ currency: "EUR", shipping: { flatRateMinor: 500, freeOverMinor: null }, paymentInstructions: "Pay to IBAN DE00." })
      .expect(200);
    const product = await http()
      .post("/api/admin/products")
      .set("Cookie", adminCookie)
      .send({ slug: "pay-tee", title: "Pay Tee", status: "ACTIVE", variants: [{ sku: "PAY-1", title: "Default", priceMinor: 2000 }] })
      .expect(201);
    variantId = product.body.variants[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("sends the customer to the payment page at checkout and reuses it for Pay now", async () => {
    await sent();
    const order = await placeOrder();
    expect(order.paymentUrl).toBe("https://pay.test/cs_1");
    expect(payments.created.at(-1)).toMatchObject({
      orderNumber: order.number,
      email: "ada@example.com",
      currency: "EUR",
      items: [{ title: "Pay Tee", unitPriceMinor: 2000, quantity: 2 }],
      shippingMinor: 500,
      totalMinor: 4500,
    });
    expect(payments.created.at(-1)!.successUrl).toContain(`/order/${order.number}?token=${order.accessToken}&paid=1`);

    // Nobody is emailed until the payment goes through
    expect(await sent()).toHaveLength(0);

    // "Pay now" returns the same open page instead of starting a second payment
    const again = await http().post(`/api/orders/${order.number}/pay`).send({ token: order.accessToken }).expect(200);
    expect(again.body).toEqual({ paymentUrl: "https://pay.test/cs_1" });
    expect(payments.created).toHaveLength(1);

    await http().post(`/api/orders/${order.number}/pay`).send({ token: "wrong" }).expect(404);
    await http().post(`/api/orders/${order.number}/pay`).send({}).expect(404);
  });

  it("marks the order paid only from a verified webhook, once", async () => {
    const order = await placeOrder();
    const ref = `cs_${payments.created.length}`;
    await sent();

    await http().post("/api/payments/webhook").send({ id: "evt_forged", outcome: paidOutcome(ref, 4500) }).expect(400);
    expect((await orderOf(order.number)).status).toBe("PENDING");

    await webhook(paidOutcome(ref, 4500), "evt_paid").expect(200);
    const paid = await orderOf(order.number);
    expect(paid.status).toBe("PAID");
    expect(paid.payments).toMatchObject([{ providerRef: ref, chargeRef: `pi_${ref}`, status: "SUCCEEDED", amountMinor: 4500 }]);
    expect(paid.events.at(-1)).toMatchObject({ fromStatus: "PENDING", toStatus: "PAID", actor: "payment provider" });
    const mails = await sent();
    // One email to the customer (the full confirmation) and the alert to the store
    expect(mails.map((m) => m.subject)).toEqual([
      `Order #${order.number} confirmed`,
      `New order #${order.number} from ada@example.com`,
    ]);
    expect(mails[0].text).toContain("Total  €45.00");
    expect(mails[0].text).not.toContain("IBAN");
    expect(mails[1].text).toContain("ready to ship");

    // Stripe retries deliveries: the same event is acknowledged but not applied twice
    await webhook(paidOutcome(ref, 4500), "evt_paid").expect(200);
    expect((await orderOf(order.number)).events).toHaveLength(2);
    expect(await sent()).toHaveLength(0);

    await http().post(`/api/orders/${order.number}/pay`).send({ token: order.accessToken }).expect(409);
  });

  it("doesn't mark a wrong amount as paid, and starts a new page after a failed one", async () => {
    const order = await placeOrder();
    const ref = `cs_${payments.created.length}`;

    await webhook(paidOutcome(ref, 100)).expect(200);
    const flagged = await orderOf(order.number);
    expect(flagged.status).toBe("PENDING");
    expect(flagged.events.at(-1).note).toContain("doesn't match the order total");

    const other = await placeOrder();
    const otherRef = `cs_${payments.created.length}`;
    await webhook({ kind: "failed", providerRef: otherRef }).expect(200);
    expect((await orderOf(other.number)).payments).toMatchObject([{ status: "FAILED" }]);
    const retry = await http().post(`/api/orders/${other.number}/pay`).send({ token: other.accessToken }).expect(200);
    expect(retry.body.paymentUrl).not.toContain(otherRef);
    expect((await orderOf(other.number)).payments).toHaveLength(2);
  });

  it("closes open payment pages when an admin cancels, unless one was already paid", async () => {
    const order = await placeOrder();
    const ref = `cs_${payments.created.length}`;
    const path = `/api/admin/orders/${order.number}/status`;

    payments.paid.add(ref);
    await http().patch(path).set("Cookie", adminCookie).send({ status: "CANCELLED" }).expect(409);
    expect((await orderOf(order.number)).status).toBe("PENDING");

    payments.paid.delete(ref);
    await http().patch(path).set("Cookie", adminCookie).send({ status: "CANCELLED" }).expect(200);
    expect(payments.cancelled).toContain(ref);
    const cancelled = await orderOf(order.number);
    expect(cancelled).toMatchObject({ status: "CANCELLED", payments: [{ status: "FAILED" }] });
  });

  it("refunds the card payment when an admin marks the order refunded", async () => {
    const order = await placeOrder();
    const ref = `cs_${payments.created.length}`;
    await webhook(paidOutcome(ref, 4500)).expect(200);

    const res = await http()
      .patch(`/api/admin/orders/${order.number}/status`)
      .set("Cookie", adminCookie)
      .send({ status: "REFUNDED" })
      .expect(200);
    expect(payments.refunds.at(-1)).toMatchObject({ chargeRef: `pi_${ref}`, amountMinor: 4500 });
    expect(res.body).toMatchObject({ status: "REFUNDED", payments: [{ status: "REFUNDED" }] });
  });

  it("still places the order when the payment provider is down", async () => {
    payments.failCreate = true;
    try {
      const order = await placeOrder();
      expect(order.paymentUrl).toBeNull();
      expect((await orderOf(order.number)).status).toBe("PENDING");
      await http().post(`/api/orders/${order.number}/pay`).send({ token: order.accessToken }).expect(503);
    } finally {
      payments.failCreate = false;
    }
  });
});
