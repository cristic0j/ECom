import { expect, test, type Page } from "@playwright/test";

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

test("guest buys a product and the admin marks the order paid", async ({ page }) => {
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
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();

  const email = `guest-${Date.now().toString(36)}@example.com`;
  await page.getByLabel("Email").fill(email);
  await fillAddress(page);
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
  await expect(page.getByRole("button", { name: "Mark as fulfilled" })).toBeVisible();
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
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("heading", { name: /Order #\d+/ })).toBeVisible();

  await page.getByRole("link", { name: "Your orders" }).click();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("link", { name: /#\d+/ })).toHaveCount(1);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account\/login\?next=%2Faccount/);
});
