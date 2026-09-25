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
