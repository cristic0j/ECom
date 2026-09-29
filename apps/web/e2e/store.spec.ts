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

async function login(page: Page) {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
}

test("browse category → product → switch variant", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Categories" }).first().getByRole("link", { name: "Apparel" }).click();
  await expect(page.getByRole("heading", { name: "Apparel", level: 1 })).toBeVisible();

  // Parent category includes products from child categories (T-Shirts)
  await page.getByTestId("product-card").filter({ hasText: "Classic Tee" }).click();
  await expect(page.getByRole("heading", { name: "Classic Tee" })).toBeVisible();
  await expect(page.getByText("SKU: TEE-B-S")).toBeVisible();

  await page.getByRole("button", { name: "L", exact: true }).click();
  await page.getByRole("button", { name: "White", exact: true }).click();
  await expect(page.getByText("SKU: TEE-W-L")).toBeVisible();
  await expect(page.getByRole("button", { name: "White", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("search and sort", async ({ page }) => {
  await page.goto("/search?q=mug");
  await expect(page.getByTestId("product-card")).toHaveCount(1);

  await page.goto("/search");
  await page.getByLabel("Sort by").selectOption("price_asc");
  await expect(page).toHaveURL(/sort=price_asc/);
  await expect(page.getByTestId("product-card").first()).toContainText("Ceramic Mug");
});

test("admin creates a product with variants + image and it appears in the store", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const title = `E2E Hoodie ${suffix}`;

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
  await page.getByRole("checkbox", { name: "Apparel" }).check();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/\/admin\/products\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // Storefront reflects it immediately (cache invalidated by the save)
  await page.goto("/c/apparel");
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

async function fillAddress(page: Page) {
  await page.getByLabel("Full name").fill("Ada Buyer");
  await page.getByLabel("Address", { exact: true }).fill("1 Main St");
  await page.getByLabel("City").fill("Berlin");
  await page.getByLabel("Postal code").fill("10115");
  await page.getByLabel("Country code (e.g. DE)").fill("DE");
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

/** Adds 2 × Classic Tee (L / White) and fills in checkout. Returns the guest's email. */
async function fillGuestCheckout(page: Page): Promise<string> {
  await page.goto("/p/classic-tee");
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
  await page.getByRole("button", { name: "Increase quantity of Classic Tee" }).click();
  await expect(page.getByTestId("line-quantity")).toHaveText("2");
  // 2 × 19.99 + 4.99 flat shipping (store.config.ts defaults)
  await expect(page.getByTestId("order-total")).toContainText("44.97");

  await page.getByRole("link", { name: "Check out" }).click();
  const submit = page.getByRole("button", { name: cardPayments ? "Continue to payment" : "Place order" });
  await submit.click();
  await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();

  const email = `guest-${Date.now().toString(36)}@example.com`;
  await page.getByLabel("Email").fill(email);
  await fillAddress(page);
  return email;
}

test("guest buys a product and the admin marks the order paid", async ({ page }) => {
  test.skip(cardPayments, "manual payment mode only");
  const email = await fillGuestCheckout(page);
  await page.getByRole("button", { name: "Place order" }).click();

  await expect(page).toHaveURL(/\/order\/\d+\?token=/);
  const heading = page.getByRole("heading", { name: /Order #\d+/ });
  await expect(heading).toBeVisible();
  const number = (await heading.textContent())!.replace(/\D/g, "");
  await expect(page.getByTestId("order-status")).toHaveText("Awaiting payment");
  await expect(page.getByTestId("order-total")).toContainText("44.97");
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
});

test("guest pays by card and the order is marked paid by the Stripe webhook", async ({ page }) => {
  test.skip(!cardPayments, "card payment mode only");
  await stubStripeCheckout(page);
  const email = await fillGuestCheckout(page);

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
  // 2 × 19.99 + 4.99 flat shipping (store.config.ts defaults)
  await sendPaidWebhook(page.request, sessionId, 4497);
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
});

test("out-of-stock items show as sold out and can't be added to the cart", async ({ page }) => {
  await login(page);
  const slug = `e2e-sold-out-${Date.now().toString(36)}`;
  const created = await page.request.post("/api/admin/products", {
    data: {
      slug,
      title: "Sold Out Scarf",
      status: "ACTIVE",
      variants: [{ sku: slug.toUpperCase(), title: "Default", priceMinor: 1500, inStock: false }],
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  try {
    await page.goto(`/search?q=${encodeURIComponent("Sold Out Scarf")}`);
    await expect(page.getByTestId("product-card").filter({ hasText: "Sold Out Scarf" })).toContainText("Sold out");
    await page.goto(`/p/${slug}`);
    await expect(page.getByRole("button", { name: "Out of stock" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add to cart" })).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/admin/products/${id}`);
  }
});

test("a shopper's guest cart carries over when they create an account", async ({ page }) => {
  await page.goto("/p/ceramic-mug");
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
  await page.getByLabel("Country code (e.g. DE)").fill("DE");
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
});
