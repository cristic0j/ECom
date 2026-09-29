import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { hash } from "@node-rs/argon2";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { PrismaService } from "../src/prisma/prisma.service";
import { EMAIL_PROVIDER, type EmailMessage, type EmailProvider } from "../src/email/email-provider";
import { EmailService } from "../src/email/email.module";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

describe("API (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminCookie: string[];
  let editorCookie: string[];
  let emails: EmailService;

  /** Emails the API sent, captured instead of delivered. */
  const outbox: EmailMessage[] = [];
  const provider: EmailProvider = { send: async (m) => void outbox.push(m) };
  /** Waits for background sends, then returns and clears what was sent. */
  const sent = async () => {
    await emails.flush();
    return outbox.splice(0);
  };

  const http = () => request(app.getHttpServer());

  const login = async (email: string) => {
    const res = await http().post("/api/auth/login").send({ email, password: "pass12345" }).expect(200);
    return res.get("Set-Cookie")!;
  };

  const productBody = (overrides: Record<string, unknown> = {}) => ({
    slug: "e2e-tee",
    title: "E2E Tee",
    status: "ACTIVE",
    variants: [
      { sku: "E2E-S", title: "S", priceMinor: 2000, options: { size: "S" } },
      { sku: "E2E-M", title: "M", priceMinor: 1500, options: { size: "M" } },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes("schema=e2e")) {
      throw new Error("Refusing to run e2e tests outside the e2e schema");
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(provider)
      // Manual payment (card payments have their own suite in payments.e2e-spec.ts)
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(null)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    emails = app.get(EmailService);

    await prisma.$executeRawUnsafe(
      `TRUNCATE "Product", "Category", "AdminUser", "StoreSetting", "Customer", "Cart", "Order" RESTART IDENTITY CASCADE`,
    );
    const passwordHash = await hash("pass12345");
    await prisma.adminUser.createMany({
      data: [
        { email: "admin@test.dev", passwordHash, role: "ADMIN" },
        { email: "editor@test.dev", passwordHash, role: "EDITOR" },
      ],
    });
    adminCookie = await login("admin@test.dev");
    editorCookie = await login("editor@test.dev");
  });

  afterAll(async () => {
    await app.close();
  });

  describe("auth", () => {
    it("rejects bad credentials with a uniform error", async () => {
      const res = await http().post("/api/auth/login").send({ email: "admin@test.dev", password: "nope" }).expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, message: "Invalid email or password" });
    });

    it("sets an httpOnly cookie and returns the user on /me", async () => {
      expect(adminCookie.join(";")).toMatch(/ecom_admin=.*HttpOnly/i);
      const res = await http().get("/api/auth/me").set("Cookie", adminCookie).expect(200);
      expect(res.body).toMatchObject({ email: "admin@test.dev", role: "ADMIN" });
      expect(res.body.passwordHash).toBeUndefined();
    });

    it("blocks admin routes without a session", async () => {
      await http().get("/api/admin/products").expect(401);
    });
  });

  describe("products + catalog", () => {
    let categoryId: string;
    let productId: string;

    it("creates a category tree", async () => {
      const parent = await http()
        .post("/api/admin/categories")
        .set("Cookie", adminCookie)
        .send({ slug: "clothing", name: "Clothing" })
        .expect(201);
      const child = await http()
        .post("/api/admin/categories")
        .set("Cookie", adminCookie)
        .send({ slug: "shirts", name: "Shirts", parentId: parent.body.id })
        .expect(201);
      categoryId = child.body.id;

      // Moving the parent under its own child must fail
      await http()
        .put(`/api/admin/categories/${parent.body.id}`)
        .set("Cookie", adminCookie)
        .send({ slug: "clothing", name: "Clothing", parentId: child.body.id })
        .expect(400);

      const tree = await http().get("/api/catalog/categories").expect(200);
      expect(tree.body[0]).toMatchObject({ slug: "clothing", children: [{ slug: "shirts" }] });
    });

    it("validates product input", async () => {
      const res = await http()
        .post("/api/admin/products")
        .set("Cookie", adminCookie)
        .send({ slug: "Bad Slug", title: "", variants: [] })
        .expect(400);
      expect(res.body.message).toBe("Validation failed");
    });

    it("creates a product with variants and a default", async () => {
      const res = await http()
        .post("/api/admin/products")
        .set("Cookie", editorCookie)
        .send(productBody({ categoryIds: [categoryId] }))
        .expect(201);
      productId = res.body.id;
      expect(res.body.variants).toHaveLength(2);
      expect(res.body.variants[0].isDefault).toBe(true);
    });

    it("returns 409 on duplicate slug", async () => {
      await http()
        .post("/api/admin/products")
        .set("Cookie", adminCookie)
        .send(productBody({ variants: [{ sku: "OTHER", priceMinor: 1 }] }))
        .expect(409);
    });

    it("lists active products with min price, filtered by parent category", async () => {
      const res = await http().get("/api/catalog/products?category=clothing").expect(200);
      expect(res.body).toMatchObject({ total: 1, page: 1 });
      expect(res.body.items[0]).toMatchObject({ slug: "e2e-tee", priceMinor: 1500 });
    });

    it("searches by title and SKU", async () => {
      expect((await http().get("/api/catalog/products?q=tee").expect(200)).body.total).toBe(1);
      expect((await http().get("/api/catalog/products?q=e2e-m").expect(200)).body.total).toBe(1);
      expect((await http().get("/api/catalog/products?q=zzz").expect(200)).body.total).toBe(0);
    });

    it("updates variants while keeping existing ids stable", async () => {
      const before = await http().get(`/api/admin/products/${productId}`).set("Cookie", adminCookie).expect(200);
      const [s, m] = before.body.variants;
      const res = await http()
        .put(`/api/admin/products/${productId}`)
        .set("Cookie", adminCookie)
        // swap SKUs between the two kept variants, drop none, add one
        .send(
          productBody({
            variants: [
              { ...s, sku: "E2E-M" },
              { ...m, sku: "E2E-S", priceMinor: 900 },
              { sku: "E2E-L", title: "L", priceMinor: 2500, options: { size: "L" } },
            ],
          }),
        )
        .expect(200);
      expect(res.body.variants.map((v: { id: string }) => v.id).slice(0, 2)).toEqual([s.id, m.id]);
      expect(res.body.variants.map((v: { sku: string }) => v.sku)).toEqual(["E2E-M", "E2E-S", "E2E-L"]);

      const list = await http().get("/api/catalog/products?sort=price_asc").expect(200);
      expect(list.body.items[0].priceMinor).toBe(900);
    });

    it("hides drafts from the public catalog but not from admin", async () => {
      await http()
        .patch(`/api/admin/products/${productId}/status`)
        .set("Cookie", adminCookie)
        .send({ status: "DRAFT" })
        .expect(200);
      await http().get("/api/catalog/products/e2e-tee").expect(404);
      expect((await http().get("/api/catalog/products").expect(200)).body.total).toBe(0);
      await http().get(`/api/admin/products/${productId}`).set("Cookie", adminCookie).expect(200);
    });

    it("only lets ADMIN delete", async () => {
      await http().delete(`/api/admin/products/${productId}`).set("Cookie", editorCookie).expect(403);
      await http().delete(`/api/admin/products/${productId}`).set("Cookie", adminCookie).expect(204);
      await http().get(`/api/admin/products/${productId}`).set("Cookie", adminCookie).expect(404);
    });
  });

  describe("media", () => {
    it("accepts a real PNG and serves it", async () => {
      const res = await http()
        .post("/api/admin/media")
        .set("Cookie", adminCookie)
        .attach("file", PNG, { filename: "x.png", contentType: "image/png" })
        .expect(201);
      const path = new URL(res.body.url).pathname;
      const file = await http().get(path).expect(200);
      expect(file.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("rejects a non-image disguised as PNG", async () => {
      await http()
        .post("/api/admin/media")
        .set("Cookie", adminCookie)
        .attach("file", Buffer.from("<script>alert(1)</script>"), { filename: "x.png", contentType: "image/png" })
        .expect(400);
    });
  });

  describe("settings", () => {
    it("lets ADMIN update settings and exposes them publicly", async () => {
      await http()
        .put("/api/admin/settings")
        .set("Cookie", editorCookie)
        .send({ name: "Nope" })
        .expect(403);
      await http()
        .put("/api/admin/settings")
        .set("Cookie", adminCookie)
        .send({ name: "Test Shop", theme: { accent: "10 80% 50%" } })
        .expect(200);
      const res = await http().get("/api/settings").expect(200);
      expect(res.body).toMatchObject({ name: "Test Shop", theme: { accent: "10 80% 50%" } });
    });

    it("rejects unknown keys", async () => {
      await http().put("/api/admin/settings").set("Cookie", adminCookie).send({ secretKey: "x" }).expect(400);
    });
  });

  describe("cart, checkout, orders", () => {
    const address = { name: "Ada Buyer", line1: "1 Main St", city: "Berlin", postalCode: "10115", country: "de" };
    let product: { id: string; variants: { id: string; sku: string }[] };
    let guestOrder: { number: number; accessToken: string };

    const shopBody = (priceA: number, status = "ACTIVE") =>
      productBody({
        slug: "e2e-shop",
        title: "Shop Tee",
        status,
        variants: [
          { ...(product && { id: product.variants[0].id }), sku: "SHOP-A", title: "A", priceMinor: priceA },
          { ...(product && { id: product.variants[1].id }), sku: "SHOP-B", title: "B", priceMinor: 1500 },
        ],
      });

    beforeAll(async () => {
      await http()
        .put("/api/admin/settings")
        .set("Cookie", adminCookie)
        .send({
          currency: "EUR",
          shipping: { flatRateMinor: 500, freeOverMinor: 10000 },
          paymentInstructions: "Pay to IBAN DE00 1234 within 7 days.",
        })
        .expect(200);
      product = (await http().post("/api/admin/products").set("Cookie", adminCookie).send(shopBody(2000)).expect(201)).body;
    });

    it("keeps a guest cart in a cookie and totals it on the server", async () => {
      const guest = request.agent(app.getHttpServer());
      expect((await guest.get("/api/cart").expect(200)).body).toMatchObject({ items: [], totalMinor: 0 });
      await guest.post("/api/cart/items").send({ variantId: "nope" }).expect(404);

      const added = await guest.post("/api/cart/items").send({ variantId: product.variants[0].id, quantity: 2 }).expect(201);
      expect(added.get("Set-Cookie")?.join(";")).toMatch(/ecom_cart=.*HttpOnly/i);
      await guest.post("/api/cart/items").send({ variantId: product.variants[0].id }).expect(201);

      const cart = (await guest.get("/api/cart").expect(200)).body;
      expect(cart).toMatchObject({ itemCount: 3, subtotalMinor: 6000, shippingMinor: 500, totalMinor: 6500, currency: "EUR" });

      // Another visitor doesn't see it
      expect((await http().get("/api/cart").expect(200)).body.items).toHaveLength(0);

      await guest.patch(`/api/cart/items/${cart.items[0].id}`).send({ quantity: 1 }).expect(200);
      expect((await guest.get("/api/cart").expect(200)).body.itemCount).toBe(1);
    });

    it("checks out a guest at the current catalog price and snapshots it", async () => {
      const guest = request.agent(app.getHttpServer());
      await guest.post("/api/checkout").send({ email: "a@b.dev", shippingAddress: address }).expect(400); // empty cart
      await guest.post("/api/cart/items").send({ variantId: product.variants[0].id, quantity: 2 }).expect(201);
      await guest.post("/api/checkout").send({ email: "not-an-email", shippingAddress: address }).expect(400);

      // Price changes while the item sits in the cart; checkout must use the new price
      await http().put(`/api/admin/products/${product.id}`).set("Cookie", adminCookie).send(shopBody(2500)).expect(200);

      await sent();
      guestOrder = (await guest.post("/api/checkout").send({ email: "Guest@B.dev", shippingAddress: address }).expect(201)).body;
      expect(guestOrder.number).toEqual(expect.any(Number));

      // Confirmation to the customer (with the private order link) and an alert to ADMIN users only
      const [confirmation, alert, ...rest] = await sent();
      expect(rest).toHaveLength(0);
      expect(confirmation).toMatchObject({ to: ["guest@b.dev"], subject: `Order #${guestOrder.number} received` });
      expect(confirmation.text).toContain(`/order/${guestOrder.number}?token=${guestOrder.accessToken}`);
      expect(confirmation.text).toContain("Pay to IBAN DE00 1234");
      expect(confirmation.text).toContain("Total  €55.00");
      expect(alert).toMatchObject({ to: ["admin@test.dev"], subject: `New order #${guestOrder.number} from guest@b.dev` });
      expect((await guest.get("/api/cart").expect(200)).body.items).toHaveLength(0);

      const order = (await http().get(`/api/orders/${guestOrder.number}?token=${guestOrder.accessToken}`).expect(200)).body;
      expect(order).toMatchObject({
        status: "PENDING",
        email: "guest@b.dev",
        subtotalMinor: 5000,
        shippingMinor: 500,
        totalMinor: 5500,
        shippingAddress: { country: "DE" },
        items: [{ sku: "SHOP-A", unitPriceMinor: 2500, quantity: 2 }],
      });
      expect(order.events).toBeUndefined();

      await http().get(`/api/orders/${guestOrder.number}?token=wrong`).expect(404);
      await http().get(`/api/orders/${guestOrder.number}`).expect(404);

      // Later catalog edits don't rewrite the order
      await http().put(`/api/admin/products/${product.id}`).set("Cookie", adminCookie).send(shopBody(9900)).expect(200);
      const again = (await http().get(`/api/orders/${guestOrder.number}?token=${guestOrder.accessToken}`).expect(200)).body;
      expect(again.items[0].unitPriceMinor).toBe(2500);
    });

    it("merges the guest cart at registration and keeps customer orders private", async () => {
      const shopper = request.agent(app.getHttpServer());
      await shopper.post("/api/cart/items").send({ variantId: product.variants[1].id, quantity: 4 }).expect(201);

      await shopper.post("/api/account/register").send({ email: "Shopper@Test.dev", password: "short" }).expect(400);
      const reg = await shopper
        .post("/api/account/register")
        .send({ email: "Shopper@Test.dev", password: "pass12345", name: "Sam" })
        .expect(201);
      expect(reg.body).toEqual({ id: expect.any(String), email: "shopper@test.dev", name: "Sam" });
      expect(reg.get("Set-Cookie")?.join(";")).toMatch(/ecom_customer=.*HttpOnly/i);
      await http().post("/api/account/register").send({ email: "shopper@test.dev", password: "pass12345" }).expect(409);

      const cart = (await shopper.get("/api/cart").expect(200)).body;
      expect(cart).toMatchObject({ itemCount: 4, subtotalMinor: 6000 });

      // A customer session is not an admin session
      await shopper.get("/api/admin/orders").expect(401);

      const placed = (await shopper.post("/api/checkout").send({ email: "shopper@test.dev", shippingAddress: address }).expect(201)).body;
      const mine = (await shopper.get("/api/account/orders").expect(200)).body;
      expect(mine.map((o: { number: number }) => o.number)).toEqual([placed.number]);
      await shopper.get(`/api/account/orders/${guestOrder.number}`).expect(404);

      await shopper.post("/api/account/logout").expect(204);
      await shopper.get("/api/account/me").expect(401);
      expect((await shopper.get("/api/cart").expect(200)).body.items).toHaveLength(0);

      const back = request.agent(app.getHttpServer());
      await back.post("/api/account/login").send({ email: "shopper@test.dev", password: "wrong" }).expect(401);
      await back.post("/api/account/login").send({ email: "SHOPPER@test.dev", password: "pass12345" }).expect(200);
      expect((await back.get("/api/account/orders").expect(200)).body).toHaveLength(1);
    });

    it("drops lines whose product is unpublished", async () => {
      const guest = request.agent(app.getHttpServer());
      await guest.post("/api/cart/items").send({ variantId: product.variants[1].id }).expect(201);
      await http().put(`/api/admin/products/${product.id}`).set("Cookie", adminCookie).send(shopBody(2500, "DRAFT")).expect(200);
      expect((await guest.get("/api/cart").expect(200)).body.items).toHaveLength(0);
      await guest.post("/api/cart/items").send({ variantId: product.variants[1].id }).expect(404);
      await http().put(`/api/admin/products/${product.id}`).set("Cookie", adminCookie).send(shopBody(2500)).expect(200);
    });

    it("lets admins find orders and move them through allowed statuses", async () => {
      await http().get("/api/admin/orders").expect(401);
      const list = (await http().get("/api/admin/orders").set("Cookie", editorCookie).expect(200)).body;
      expect(list.total).toBe(2);
      const byNumber = (await http().get(`/api/admin/orders?q=%23${guestOrder.number}`).set("Cookie", adminCookie).expect(200)).body;
      expect(byNumber.items.map((o: { number: number }) => o.number)).toEqual([guestOrder.number]);
      expect((await http().get("/api/admin/orders?q=shopper").set("Cookie", adminCookie).expect(200)).body.total).toBe(1);

      const path = `/api/admin/orders/${guestOrder.number}/status`;
      await sent();
      await http().patch(path).set("Cookie", adminCookie).send({ status: "FULFILLED" }).expect(409);
      expect(await sent()).toHaveLength(0);
      await http().patch(path).set("Cookie", adminCookie).send({ status: "PAID", note: "Bank transfer" }).expect(200);
      const [paid] = await sent();
      expect(paid).toMatchObject({ to: ["guest@b.dev"], subject: `Payment received for order #${guestOrder.number}` });
      // The admin's note is internal and isn't sent to the customer
      expect(paid.text).not.toContain("Bank transfer");
      const tracking = { trackingNumber: "JD014600003", trackingUrl: "https://track.test/JD014600003" };
      await http().patch(`/api/admin/orders/${guestOrder.number}/tracking`).set("Cookie", adminCookie).send(tracking).expect(409); // not shipped yet
      const order = (
        await http().patch(path).set("Cookie", editorCookie).send({ status: "FULFILLED", tracking }).expect(200)
      ).body;
      const [shipped, ...more] = await sent();
      expect(more).toHaveLength(0);
      expect(shipped.subject).toBe(`Order #${guestOrder.number} has shipped`);
      expect(shipped.text).toContain("Tracking number: JD014600003");
      expect(shipped.text).toContain("Track your package: https://track.test/JD014600003");
      expect(order).toMatchObject({ status: "FULFILLED", ...tracking });
      expect(order.events).toMatchObject([
        { toStatus: "PENDING", actor: "guest" },
        { fromStatus: "PENDING", toStatus: "PAID", actor: "admin@test.dev", note: "Bank transfer" },
        { fromStatus: "PAID", toStatus: "FULFILLED", actor: "editor@test.dev" },
      ]);

      const counts = (await http().get("/api/admin/orders/counts").set("Cookie", adminCookie).expect(200)).body;
      expect(counts).toEqual({ FULFILLED: 1, PENDING: 1 });
    });

    it("lets admins correct tracking after shipping and tells the customer", async () => {
      const path = `/api/admin/orders/${guestOrder.number}/tracking`;
      await http().patch(path).set("Cookie", adminCookie).send({ trackingUrl: "javascript:alert(1)" }).expect(400);
      await sent();

      const fixed = { trackingNumber: "JD014600099", trackingUrl: "" };
      const order = (await http().patch(path).set("Cookie", adminCookie).send(fixed).expect(200)).body;
      expect(order).toMatchObject(fixed);
      expect(order.events.at(-1)).toMatchObject({ actor: "admin@test.dev", note: "Tracking set to JD014600099" });
      const [mail] = await sent();
      expect(mail).toMatchObject({ to: ["guest@b.dev"], subject: `Tracking for order #${guestOrder.number}` });
      expect(mail.text).toContain("Tracking number: JD014600099");

      // Saving the same details again doesn't email anyone
      await http().patch(path).set("Cookie", adminCookie).send(fixed).expect(200);
      expect(await sent()).toHaveLength(0);

      // The customer sees it on their order page
      const mine = (await http().get(`/api/orders/${guestOrder.number}?token=${guestOrder.accessToken}`).expect(200)).body;
      expect(mine.trackingNumber).toBe("JD014600099");
    });

    it("keeps out-of-stock items from being bought", async () => {
      const guest = request.agent(app.getHttpServer());
      await guest.post("/api/cart/items").send({ variantId: product.variants[0].id }).expect(201);
      await guest.post("/api/cart/items").send({ variantId: product.variants[1].id }).expect(201);

      // The supplier runs out of variant A
      const body = shopBody(2500);
      const outOfStock = { ...body, variants: body.variants.map((v, i) => (i === 0 ? { ...v, inStock: false } : v)) };
      await http().put(`/api/admin/products/${product.id}`).set("Cookie", adminCookie).send(outOfStock).expect(200);

      const detail = (await http().get("/api/catalog/products/e2e-shop").expect(200)).body;
      expect(detail.variants.map((v: { sku: string; inStock: boolean }) => [v.sku, v.inStock])).toEqual([
        ["SHOP-A", false],
        ["SHOP-B", true],
      ]);
      const listed = (await http().get("/api/catalog/products?q=Shop%20Tee").expect(200)).body.items;
      expect(listed[0].stock).toBe("partial");

      await http().post("/api/cart/items").send({ variantId: product.variants[0].id }).expect(409);
      // Already in a cart: stays visible, isn't counted, and blocks checkout until removed
      const cart = (await guest.get("/api/cart").expect(200)).body;
      const lineA = cart.items.find((i: { sku: string }) => i.sku === "SHOP-A");
      expect(lineA.inStock).toBe(false);
      expect(cart.subtotalMinor).toBe(1500);
      await guest.patch(`/api/cart/items/${lineA.id}`).send({ quantity: 2 }).expect(409);
      const blocked = await guest.post("/api/checkout").send({ email: "a@b.dev", shippingAddress: address }).expect(409);
      expect(blocked.body.message).toContain("Shop Tee");
      await guest.delete(`/api/cart/items/${lineA.id}`).expect(200);
      await guest.post("/api/checkout").send({ email: "a@b.dev", shippingAddress: address }).expect(201);

      await http().put(`/api/admin/products/${product.id}`).set("Cookie", adminCookie).send(shopBody(2500)).expect(200);
      expect((await http().get("/api/catalog/products?q=Shop%20Tee").expect(200)).body.items[0].stock).toBe("in");
    });

    it("resets a customer password with a single-use emailed link", async () => {
      await sent();
      // Unknown emails get the same answer and no email
      await http().post("/api/account/forgot-password").send({ email: "nobody@test.dev" }).expect(204);
      expect(await sent()).toHaveLength(0);

      await http().post("/api/account/forgot-password").send({ email: "Shopper@Test.dev" }).expect(204);
      const [mail] = await sent();
      expect(mail).toMatchObject({ to: ["shopper@test.dev"] });
      const token = decodeURIComponent(/reset-password\?token=([^\s"&]+)/.exec(mail.text)![1]);

      await http().post("/api/account/reset-password").send({ token, password: "short" }).expect(400);
      await http().post("/api/account/reset-password").send({ token: "garbage", password: "newpass123" }).expect(400);

      const reset = await http().post("/api/account/reset-password").send({ token, password: "newpass123" }).expect(200);
      expect(reset.body).toMatchObject({ email: "shopper@test.dev" });
      expect(reset.get("Set-Cookie")?.join(";")).toMatch(/ecom_customer=.*HttpOnly/i);

      // The link is used up, and only the new password works
      await http().post("/api/account/reset-password").send({ token, password: "another123" }).expect(400);
      await http().post("/api/account/login").send({ email: "shopper@test.dev", password: "pass12345" }).expect(401);
      await http().post("/api/account/login").send({ email: "shopper@test.dev", password: "newpass123" }).expect(200);
    });
  });
});
