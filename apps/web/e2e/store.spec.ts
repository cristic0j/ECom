import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { storeConfig } from "../../../store.config";

/** The checkout tests follow whichever payment mode store.config.ts has switched on. */
const cardPayments = storeConfig.features.payments;

// 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin12345";

/** Unique per test run, so test data never clashes with the store's own products or earlier runs */
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Category = { id: string; slug: string; name: string };
type Product = { id: string; slug: string; title: string; variants: { id: string; sku: string; title: string }[] };

/**
 * An admin API session of its own (so the pages stay signed out), signed in once for the whole file:
 * the API allows only 10 sign-ins a minute.
 */
let adminApi: APIRequestContext;

test.beforeAll(async ({ playwright }, info) => {
  adminApi = await playwright.request.newContext({ baseURL: info.project.use.baseURL });
  const login = await adminApi.post("/api/auth/login", { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  expect(login.status()).toBe(200);
});

test.afterAll(async () => {
  await adminApi.dispose();
});

/** Products and categories a test creates for itself through the admin API, deleted again afterwards. */
function testData() {
  const products: string[] = [];
  const categories: string[] = [];
  return {
    async category(data: { name: string; slug: string; parentId?: string }): Promise<Category> {
      const res = await adminApi.post("/api/admin/categories", { data });
      expect(res.status()).toBe(201);
      const created = await res.json();
      categories.push(created.id);
      return created;
    },
    async product(data: Record<string, unknown>): Promise<Product> {
      const res = await adminApi.post("/api/admin/products", { data: { status: "ACTIVE", ...data } });
      expect(res.status()).toBe(201);
      const created = await res.json();
      products.push(created.id);
      return created;
    },
    /** Deletes what's left (a test may already have deleted its product); children before parents */
    async cleanUp() {
      for (const id of products) await adminApi.delete(`/api/admin/products/${id}`);
      for (const id of categories.reverse()) await adminApi.delete(`/api/admin/categories/${id}`);
    },
  };
}

/** A tee in sizes S/M/L and colours Black/White at 19.99, with SKUs like E2E-<id>-W-L */
function tee(id: string, categoryIds: string[] = []) {
  const variants = ["S", "M", "L"].flatMap((size) =>
    ["Black", "White"].map((color) => ({
      sku: `E2E-${id}-${color[0]}-${size}`.toUpperCase(),
      title: `${size} / ${color}`,
      priceMinor: 1999,
      options: { size, color },
      isDefault: size === "S" && color === "Black",
    })),
  );
  return { slug: `e2e-tee-${id}`, title: `E2E Tee ${id}`, categoryIds, variants };
}

/** Shipping and delivery countries as the store is currently set up (admin Settings over store.config.ts) */
async function shopSettings() {
  const settings = await (await adminApi.get("/api/settings")).json();
  const shipping = { ...storeConfig.shipping, ...settings.shipping };
  return {
    shippingFor: (subtotalMinor: number) =>
      shipping.freeOverMinor !== null && subtotalMinor >= shipping.freeOverMinor ? 0 : shipping.flatRateMinor,
    country: shipping.countries.includes("DE") ? "DE" : shipping.countries[0],
  };
}

const money = (minor: number) => (minor / 100).toFixed(2);

async function login(page: Page) {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
}

test("browse category → product → switch variant", async ({ page }) => {
  const data = testData();
  try {
    const id = uid();
    const parent = await data.category({ slug: `e2e-wear-${id}`, name: `E2E Wear ${id}` });
    const child = await data.category({ slug: `e2e-shirts-${id}`, name: `E2E Shirts ${id}`, parentId: parent.id });
    const product = await data.product(tee(id, [child.id]));

    await page.goto(`/c/${parent.slug}`);
    await expect(page.getByRole("heading", { name: parent.name, level: 1 })).toBeVisible();

    // Parent category includes products from child categories
    await page.getByTestId("product-card").filter({ hasText: product.title }).click();
    await expect(page.getByRole("heading", { name: product.title })).toBeVisible();
    await expect(page.getByText(`SKU: E2E-${id.toUpperCase()}-B-S`)).toBeVisible();

    await page.getByRole("button", { name: "L", exact: true }).click();
    await page.getByRole("button", { name: "White", exact: true }).click();
    await expect(page.getByText(`SKU: E2E-${id.toUpperCase()}-W-L`)).toBeVisible();
    await expect(page.getByRole("button", { name: "White", exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await data.cleanUp();
  }
});

test("search and sort", async ({ page }) => {
  const data = testData();
  try {
    const id = uid();
    const single = (title: string, priceMinor: number) => {
      const slug = `e2e-${title.toLowerCase().replace(/ /g, "-")}`;
      return data.product({ slug, title, variants: [{ sku: slug.toUpperCase(), priceMinor }] });
    };
    await single(`Sortable Dear ${id}`, 2000);
    await single(`Sortable Cheap ${id}`, 1000);

    await page.goto(`/search?q=${id}`);
    await expect(page.getByTestId("product-card")).toHaveCount(2);
    await page.getByLabel("Sort by").selectOption("price_asc");
    await expect(page).toHaveURL(/sort=price_asc/);
    await expect(page.getByTestId("product-card").first()).toContainText(`Sortable Cheap ${id}`);
    await page.getByLabel("Sort by").selectOption("price_desc");
    await expect(page).toHaveURL(/sort=price_desc/);
    await expect(page.getByTestId("product-card").first()).toContainText(`Sortable Dear ${id}`);
  } finally {
    await data.cleanUp();
  }
});

test("admin creates a product with variants + image and it appears in the store", async ({ page }) => {
  const suffix = uid();
  const title = `E2E Hoodie ${suffix}`;
  const data = testData();
  const category = await data.category({ slug: `e2e-hoodies-${suffix}`, name: `E2E Hoodies ${suffix}` });
  try {
    await login(page);
    await page.goto("/admin/products/new");

    await page.getByLabel("Title").fill(title);
    await expect(page.getByLabel("URL slug")).toHaveValue(`e2e-hoodie-${suffix}`);
    await page.getByLabel("Description").fill("Cozy.");

    await page.getByTestId("image-upload").setInputFiles({ name: "hoodie.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByLabel("Alt text for image 1")).toBeVisible();

    await page.getByRole("button", { name: "Add option" }).click();
    await page.getByLabel("Option 1 name").fill("Size");
    await page.getByLabel("Option 1 values").fill("M, L");
    await page.getByRole("button", { name: "Generate variants" }).click();
    await page.getByLabel("Price for M", { exact: true }).fill("39.00");
    await page.getByLabel("Price for L", { exact: true }).fill("42.50");

    await page.getByLabel("Status").selectOption("ACTIVE");
    await page.getByRole("checkbox", { name: category.name }).check();
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL(/\/admin\/products\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Storefront reflects it immediately (cache invalidated by the save)
    await page.goto(`/c/${category.slug}`);
    await expect(page.getByTestId("product-card").filter({ hasText: title })).toBeVisible();
    await page.getByTestId("product-card").filter({ hasText: title }).click();
    await expect(page.getByTestId("price")).toContainText("39.00");
    await page.getByRole("button", { name: "L", exact: true }).click();
    await expect(page.getByTestId("price")).toContainText("42.50");

    // Clean up so the demo catalog stays tidy
    await page.goto("/admin/products");
    await page.getByRole("link", { name: title }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete product" }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);
  } finally {
    await data.cleanUp();
  }
});

test("admin validation shows field errors", async ({ page }) => {
  await login(page);
  await page.goto("/admin/products/new");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Please fix the highlighted fields.")).toBeVisible();
  await expect(page.getByText("SKU is required")).toBeVisible();
});

test("admin routes redirect to login when signed out", async ({ page }) => {
  await page.goto("/admin/products");
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fproducts/);
});

async function fillAddress(page: Page, country: string) {
  await page.getByLabel("Full name").fill("Ada Buyer");
  await page.getByLabel("Address", { exact: true }).fill("1 Main St");
  await page.getByLabel("City").fill("Berlin");
  await page.getByLabel("Postal code").fill("10115");
  await page.getByLabel("Country").selectOption(country);
}

/**
 * Card payments: the tests don't drive Stripe's own page. They check that checkout sends the browser
 * to a real Stripe payment page (stubbed here so it isn't loaded), then send the webhook Stripe would
 * send after the payment, signed with STRIPE_WEBHOOK_SECRET exactly as Stripe signs it.
 */
async function stubStripeCheckout(page: Page) {
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Stripe payment page (stubbed in tests)</h1>" }),
  );
}

async function sendPaidWebhook(request: APIRequestContext, sessionId: string, amountMinor: number) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET must be set to run the card payment tests");
  const payload = JSON.stringify({
    id: `evt_e2e_${Date.now().toString(36)}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: `pi_e2e_${Date.now().toString(36)}`,
        amount_total: amountMinor,
        currency: storeConfig.currency.toLowerCase(),
      },
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  // Through the storefront's /api proxy, the same path Stripe uses in production
  const res = await request.post("/api/payments/webhook", {
    data: payload,
    headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` },
  });
  expect(res.status()).toBe(200);
}

/**
 * Adds 2 × a test tee (L / White) and fills in checkout. Returns the guest's email and the order total
 * the store should charge (2 × 19.99 plus the store's current shipping).
 */
async function fillGuestCheckout(page: Page, product: Product) {
  const { shippingFor, country } = await shopSettings();
  const totalMinor = 2 * 1999 + shippingFor(2 * 1999);
  await page.goto(`/p/${product.slug}`);
  await page.getByRole("button", { name: "L", exact: true }).click();
  await page.getByRole("button", { name: "White", exact: true }).click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByTestId("product-quantity")).toHaveText("1");
  await expect(page.getByTestId("cart-link")).toHaveAccessibleName("Cart, 1 item");
  // The button becomes a stepper: + adds one, − at 1 removes the line again
  await page.getByRole("button", { name: "Increase quantity" }).click();
  await expect(page.getByTestId("cart-link")).toHaveAccessibleName("Cart, 2 items");
  await page.getByRole("button", { name: "Decrease quantity" }).click();
  await expect(page.getByTestId("product-quantity")).toHaveText("1");
  await page.getByRole("button", { name: "Remove from cart" }).click();
  await expect(page.getByTestId("cart-link")).toHaveAccessibleName("Cart, 0 items");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByTestId("cart-link")).toHaveAccessibleName("Cart, 1 item");

  await page.getByRole("link", { name: "View cart and check out" }).click();
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("cart-line")).toContainText("L / White");
  await page.getByRole("button", { name: `Increase quantity of ${product.title}` }).click();
  await expect(page.getByTestId("line-quantity")).toHaveText("2");
  await expect(page.getByTestId("order-total")).toContainText(money(totalMinor));

  await page.getByRole("link", { name: "Check out" }).click();
  const submit = page.getByRole("button", { name: cardPayments ? "Continue to payment" : "Place order" });
  await submit.click();
  await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();

  const email = `guest-${Date.now().toString(36)}@example.com`;
  await page.getByLabel("Email").fill(email);
  await fillAddress(page, country);
  return { email, totalMinor };
}

test("guest buys a product and the admin marks the order paid", async ({ page }) => {
  test.skip(cardPayments, "manual payment mode only");
  const data = testData();
  try {
    const { email, totalMinor } = await fillGuestCheckout(page, await data.product(tee(uid())));
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page).toHaveURL(/\/order\/\d+\?token=/);
    const heading = page.getByRole("heading", { name: /Order #\d+/ });
    await expect(heading).toBeVisible();
    const number = (await heading.textContent())!.replace(/\D/g, "");
    await expect(page.getByTestId("order-status")).toHaveText("Awaiting payment");
    await expect(page.getByTestId("order-total")).toContainText(money(totalMinor));
    await expect(page.getByTestId("cart-link")).toHaveAccessibleName("Cart, 0 items");

    await login(page);
    await page.goto("/admin/orders");
    await page.getByLabel("Search orders").fill(email);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("link", { name: `#${number}` }).click();
    await expect(page.getByRole("heading", { name: `Order #${number}` })).toBeVisible();
    await page.getByLabel("Note (optional)").fill("Bank transfer received");
    await page.getByRole("button", { name: "Mark as paid" }).click();
    await expect(page.getByTestId("admin-order-status")).toHaveText("Paid");
    await expect(page.getByText("“Bank transfer received”")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark as shipped" })).toBeVisible();
  } finally {
    await data.cleanUp();
  }
});

test("guest pays by card and the order is marked paid by the Stripe webhook", async ({ page }) => {
  test.skip(!cardPayments, "card payment mode only");
  const data = testData();
  try {
    await stubStripeCheckout(page);
    const { email, totalMinor } = await fillGuestCheckout(page, await data.product(tee(uid())));

    // Read the checkout response on its way to the page (the page leaves for Stripe right after)
    let placed: { number: number; accessToken: string; paymentUrl: string } | undefined;
    await page.route("**/api/checkout", async (route) => {
      const response = await route.fetch();
      placed = await response.json();
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.waitForURL(/checkout\.stripe\.com/);
    const { number, accessToken, paymentUrl } = placed!;
    // A real Stripe (test mode) Checkout Session was created
    expect(paymentUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const sessionId = /cs_test_[A-Za-z0-9]+/.exec(paymentUrl)![0];

    // Stripe sends the customer back before its webhook arrives: the page waits for it
    await page.goto(`/order/${number}?token=${encodeURIComponent(accessToken)}&paid=1`);
    await expect(page.getByText("Confirming your payment…")).toBeVisible();
    await expect(page.getByTestId("order-status")).toHaveText("Awaiting payment");
    await sendPaidWebhook(page.request, sessionId, totalMinor);
    await expect(page.getByText("Thank you, your payment was received.")).toBeVisible();
    await expect(page.getByTestId("order-status")).toHaveText("Paid");
    await expect(page.getByTestId("cart-link")).toHaveAccessibleName("Cart, 0 items");

    await login(page);
    await page.goto("/admin/orders");
    await page.getByLabel("Search orders").fill(email);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("link", { name: `#${number}` }).click();
    await expect(page.getByTestId("admin-order-status")).toHaveText("Paid");
    await expect(page.getByTestId("admin-payment")).toContainText("Paid");
    await expect(page.getByText("by payment provider")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Refund .* to the customer$/ })).toBeVisible();

    // Ship it with tracking; the customer sees it on their order page
    await page.getByLabel("Tracking number (optional)").fill("JD014600003");
    await page.getByLabel("Tracking link (optional)").fill("https://track.example.com/JD014600003");
    await page.getByRole("button", { name: "Mark as shipped" }).click();
    await expect(page.getByTestId("admin-order-status")).toHaveText("Shipped");
    await page.goto(`/order/${number}?token=${encodeURIComponent(accessToken)}`);
    await expect(page.getByTestId("order-status")).toHaveText("Shipped");
    await expect(page.getByTestId("order-tracking")).toContainText("JD014600003");
    await expect(page.getByRole("link", { name: "Track your package" })).toHaveAttribute(
      "href",
      "https://track.example.com/JD014600003",
    );
  } finally {
    await data.cleanUp();
  }
});

test("out-of-stock items show as sold out and can't be added to the cart", async ({ page }) => {
  const data = testData();
  try {
    const id = uid();
    const scarf = await data.product({
      slug: `e2e-scarf-${id}`,
      title: `Sold Out Scarf ${id}`,
      variants: [{ sku: `E2E-SCARF-${id}`.toUpperCase(), priceMinor: 1500, inStock: false }],
    });
    await page.goto(`/search?q=${id}`);
    await expect(page.getByTestId("product-card").filter({ hasText: scarf.title })).toContainText("Sold out");
    await page.goto(`/p/${scarf.slug}`);
    await expect(page.getByRole("button", { name: "Out of stock" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add to cart" })).toHaveCount(0);
  } finally {
    await data.cleanUp();
  }
});

test("a shopper's guest cart carries over when they create an account", async ({ page }) => {
  const data = testData();
  try {
    const { country } = await shopSettings();
    const id = uid();
    const mug = await data.product({
      slug: `e2e-mug-${id}`,
      title: `E2E Mug ${id}`,
      variants: [{ sku: `E2E-MUG-${id}`.toUpperCase(), priceMinor: 1200 }],
    });
    await page.goto(`/p/${mug.slug}`);
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByTestId("cart-link")).toHaveAccessibleName("Cart, 1 item");

    const email = `shopper-${Date.now().toString(36)}@example.com`;
    await page.goto("/account/register?next=/checkout");
    await page.getByLabel("Name").fill("Sam Shopper");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 8 characters")).toBeVisible();
    await page.getByLabel("Password").fill("pass12345");
    await page.getByRole("button", { name: "Create account" }).click();

    // Lands on checkout with the cart intact and the account's details filled in
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByTestId("cart-link")).toHaveAccessibleName("Cart, 1 item");
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByLabel("Full name")).toHaveValue("Sam Shopper");
    await page.getByLabel("Address", { exact: true }).fill("2 Side St");
    await page.getByLabel("City").fill("Hamburg");
    await page.getByLabel("Postal code").fill("20095");
    await page.getByLabel("Country").selectOption(country);
    if (cardPayments) {
      await stubStripeCheckout(page);
      await page.getByRole("button", { name: "Continue to payment" }).click();
      await page.waitForURL(/checkout\.stripe\.com/);
      const paymentPage = page.url();
      // The shopper leaves Stripe without paying: their order waits in the account with "Pay now",
      // which reopens the same payment page rather than starting a second payment
      await page.goto("/account");
      await page.getByRole("link", { name: /#\d+/ }).click();
      await expect(page.getByText("This order isn't paid yet.")).toBeVisible();
      await page.getByRole("button", { name: "Pay now" }).click();
      await page.waitForURL(paymentPage);
      await page.goto("/account");
    } else {
      await page.getByRole("button", { name: "Place order" }).click();
      await expect(page.getByRole("heading", { name: /Order #\d+/ })).toBeVisible();
      await page.getByRole("link", { name: "Your orders" }).click();
    }
    await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole("link", { name: /#\d+/ })).toHaveCount(1);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account\/login\?next=%2Faccount/);
  } finally {
    await data.cleanUp();
  }
});
