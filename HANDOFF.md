# Project Handoff — E-commerce Template

_Last updated: 2026-09-29. Read this first when resuming work._

## Goal

A **reusable single-store e-commerce template**. Each store is a separate deployment of the same codebase, customized through `store.config.ts`, env vars and the admin Settings page, never by forking code.

The work is split into four phases:

| Phase | Scope | Status |
|---|---|---|
| 1 | Product catalog + admin panel | ✅ done (2026-09-25) |
| 2 | Customer accounts, cart, checkout, orders | ✅ done (2026-09-25) |
| 3 | Payments (Stripe, via a provider interface) | ✅ done (2026-09-29) |
| 4 | Stock management (per-variant inventory) | ⬜ not started |

Full original plan: `~/.claude/plans/i-am-planning-to-recursive-shell.md`

---

## ▶ Where we left off (session 2026-09-29)

**Done this session:**
- The store owner tested the order emails and password reset by hand in the browser, and everything worked. Committed as `4809d70`.
- **Add to cart fix:** clicking repeatedly used to keep adding items. Now `components/store/add-to-cart.tsx` shows "Add to cart" until the selected variant is in the cart, then switches to a − / quantity / + stepper (− at 1 removes the line). One request runs at a time. The Playwright guest-checkout test covers it; 7/7 pass.
- The store owner asked about the "Fulfilled" status: the admin button says "Mark as fulfilled", but the email says "has shipped". Optionally rename the admin label to "Shipped" (just the wording). The store owner didn't want a separate "Delivered" step.
- **No git remote:** the repo exists only on this Mac. Recommend a private GitHub repo (as a backup, and needed for Railway/Render deploys) before deploying.
- **Phase 3: Stripe card payments** built and switched on (`features.payments: true`). The store owner chose: Stripe's hosted page, **card only**, and unpaid orders stay open with "Pay now". The store owner did a test purchase in the browser and it worked. Details in "Phase 3: what's done" below.
- Tests: 31 unit, 28 API e2e (6 new in `test/payments.e2e-spec.ts`), and 7 Playwright passing plus 1 skipped (the manual-payment test skips while card payments are on).

**Next up (store owner to choose):** Phase 4 (stock), deploying (needs a Stripe account activated for live payments, plus a GitHub repo), or the small "Fulfilled" → "Shipped" admin rename.

**Local Stripe testing needs the relay running:** `pnpm stripe:listen` (in a second terminal). Without it, card payments succeed on Stripe but orders stay "Awaiting payment" locally. The Stripe CLI is in git-ignored `.tools/stripe` (v1.52.0, authorized for the store owner's "ECom sandbox"); on another machine, download it again (README → Card payments). The API **refuses to start** with payments on and no `STRIPE_*` keys in `.env`.

## Previous session (2026-09-27)

**Done that session:** **order emails** and customer **forgot password** (details in "Order emails: what's done" below). The store owner chose this over Stripe, stock and deploying.
- Tests: 26 unit, 22 API e2e and 7 Playwright, all green.
- Checked by hand: `POST /account/forgot-password` prints the reset email in the `pnpm dev` terminal, and the new pages load.

**Next up (store owner to choose):**
1. **Phase 3: Stripe payments** (see "Next phases"). The email layer is ready for receipts: when the webhook sets PAID, `EmailService.orderStatusChanged` already sends "Payment received".
2. Phase 4: stock management.
3. **Deploying online** (Railway/Render + managed Postgres + R2/S3). No host chosen yet. Emails also need a Resend account and a verified sender domain at that point.

**Open decisions for the store owner:** what comes next, the hosting provider, and the store's email domain (needed for Resend).

**About the store owner:** new to hosting and backend concepts. Explain in plain terms, give a recommendation, and ask before big choices. Earlier questions answered: how the 3 pieces fit together (web → API → database), what changes between local and hosted, and that migrations and the seed must be run (not automatic; a deploy should put them in the host's pre-deploy step).

**State at the end of the session:** `pnpm dev` may still be running. If ports 3000/4000 are busy, stop it: `pkill -f "turbo run dev"`.

---

## Stack & layout

- **Monorepo:** pnpm 12 workspaces + Turborepo
- **API:** NestJS 11 (`apps/api`), with zod validation using the shared schemas and Swagger at `/api/docs`
- **Web:** Next.js **16.3** App Router + Tailwind v4 (`apps/web`). The plan said 15, but `create-next-app` installed 16. Next 16 has breaking changes; read `apps/web/AGENTS.md` and `apps/web/node_modules/next/dist/docs/` before writing web code.
- **DB:** PostgreSQL 16 + Prisma 6 (`packages/db`)
- **Shared:** zod schemas, DTO types and `formatMoney` (`packages/shared`)

```
apps/api      NestJS API (port 4000, prefix /api)
apps/web      Next.js storefront + /admin (port 3000)
packages/db   Prisma schema, migrations, seed
packages/shared  zod schemas + TS types (API contract)
packages/store-config  compiles store.config.ts for the API
packages/config  tsconfig presets
store.config.ts  per-store defaults (name, currency, theme, feature flags)
docker-compose.yml  Postgres only (host port 5433)
```

## Running locally

```bash
docker-compose up -d            # Postgres on localhost:5433 (see "Machine quirks")
pnpm install
pnpm --filter @ecom/db --filter @ecom/shared build
pnpm db:migrate && pnpm db:seed # seed is idempotent
pnpm --filter @ecom/api dev     # http://localhost:4000/api  (docs: /api/docs)
pnpm --filter @ecom/web dev     # http://localhost:3000  (admin: /admin)
```

- Admin login (from the seed): `admin@example.com` / `admin12345`
- Tests:
  - `pnpm --filter @ecom/api test`: unit tests
  - `pnpm --filter @ecom/api test:e2e`: API e2e, run against an isolated `e2e` Postgres schema
  - `cd apps/web && pnpm test:e2e`: Playwright; it starts the API and web dev servers if they aren't already running

## Machine quirks (this Mac)

1. **Docker credentials:** `~/.docker/config.json` has `"credsStore": "desktop"`, but Docker Desktop isn't installed, so image pulls fail. Either delete that line (the permanent fix) or run with a clean config, as the previous session did:
   `DOCKER_CONFIG=<dir containing {}> DOCKER_HOST=unix://$HOME/.colima/default/docker.sock docker-compose up -d`
2. **Colima:** if `colima start` fails with "disk in use", run `colima stop --force` and then `colima start`.
3. **Port 5432** is taken by a Postgres running on the Mac itself, so the project's Postgres is mapped to **5433**.
4. **MinIO** Docker images can't be pulled any more (the pull fails with "access denied"), so there's no object store container. Media uses `STORAGE_DRIVER=local` (files go to `apps/api/uploads`, served at `/uploads`), and `s3` is available for production.
5. **Prisma blocks `migrate reset`** when an AI agent runs it. Don't try to bypass that; use `migrate dev` plus the idempotent seed.
6. **pnpm 12** needs dependency build scripts approved in the `allowBuilds:` map in `pnpm-workspace.yaml`. When `pnpm install` reports ERR_PNPM_IGNORED_BUILDS, add the package there.
7. If something is already on port 4000 (for example an old API left running from `apps/api/dist`), stop it with `pkill -f "node dist/main.js"` before running `pnpm dev`.

---

## Phase 1: what's done

### Committed (`git log`)
- `38e4e28`: monorepo scaffold, Prisma schema + init migration, seed, shared package
- `a8a1da9`: NestJS API, all tests passing (5 unit, 16 e2e)

### Data model (`packages/db/prisma/schema.prisma`)
- `Category`: tree via `parentId`
- `Product`: status DRAFT/ACTIVE/ARCHIVED, `attributes` JSON, and a denormalized **`priceMinMinor`** that the API keeps in sync on every write, used for sorting and filtering by price
- `ProductCategory`: join table
- `ProductVariant`: sku, `priceMinor` in cents, `compareAtMinor`, `options` JSON, `isDefault`. **Every product has at least one variant**, and a simple product is just one default variant.
- `ProductImage`: optional `variantId`
- `AdminUser`: role ADMIN or EDITOR, argon2 password hash
- `StoreSetting`: key/value, currently the single key `"store"`

### API (`apps/api/src`)
- **`auth/`:** login sets an httpOnly `ecom_admin` JWT cookie (7 days; a Bearer header is also accepted). `AdminAuthGuard` re-reads the user on each request, and `@Roles("ADMIN")` restricts routes. Login is throttled to 10 per minute.
- **`catalog/`:** public endpoints that return only ACTIVE products:
  - `GET /catalog/products`: `q`, `category` (includes child categories), `minPrice`, `maxPrice`, `sort=newest|price_asc|price_desc|title`, `page`, `pageSize`
  - `/catalog/products/:slug`, `/catalog/products/slugs`, `/catalog/categories` (tree), `/catalog/categories/:slug`
  - `ProductsService` is shared with the admin module.
- **`admin/`:**
  - `admin/products`: full CRUD plus `PATCH :id/status`. PUT is a full replace but **keeps variant ids stable** (matched by id), which matters for future orders and inventory; SKU swaps are handled. Only ADMIN can DELETE.
  - `admin/categories`: CRUD, and re-parenting a category under its own descendant is rejected.
  - `normalize-product.ts`: enforces unique SKUs and exactly one default variant.
- **`media/`:** `POST /admin/media` takes a multipart `file` (max 5 MB; png/jpeg/webp/gif/avif) and checks magic bytes. It stores through the `StorageDriver` interface (`LocalStorageDriver` or `S3StorageDriver`), and served files get a `nosniff` header.
- **`settings/`:** `GET /settings` is public; `PUT /admin/settings` is ADMIN only and validated by the strict `storeSettingsSchema` (no secrets belong in settings).
- **Cross-cutting:**
  - `AllExceptionsFilter` returns errors in the `ApiError` shape and maps Prisma errors P2002→409, P2025→404, P2003→400.
  - Env vars are validated with zod in `config/env.ts`.
  - The global throttler allows 300 requests per minute.
  - `configure-app.ts` is used by both `main.ts` and the e2e tests.

### Web (`apps/web/src`): committed, Playwright green
- `next build` and `eslint` both pass.
- **Architecture:**
  - `next.config.ts` rewrites `/api/*` to the Nest API. The browser only talks to one origin, so the admin cookie is first-party and CORS isn't needed.
  - Server-side fetches go straight to `API_INTERNAL_URL`.
  - Caching uses `fetch` with `next: { revalidate: 300, tags: ["catalog"|"settings"] }`. `cacheComponents` is not enabled.
  - Admin saves call the Server Action `app/admin/actions.ts → revalidateStorefront()`. It checks the session via `/auth/me` and then runs `updateTag(...)`, so the storefront updates immediately.
  - `src/proxy.ts` is Next 16's replacement for middleware. It redirects `/admin/*` to `/admin/login` when there's no cookie.
  - Theming: `app/layout.tsx` puts the `--primary`, `--primary-foreground`, `--accent` and `--radius` CSS variables on `<html>`, taken from `getStore()` in `lib/store.ts` (`store.config.ts` merged with the admin settings). The Tailwind tokens are in `globals.css`.
- **Storefront pages** (route group `(store)`):
  - `/`: hero, categories, new arrivals
  - `/c/[slug]`: category page with sub-category chips, price filter, sort and pagination
  - `/search?q=`
  - `/p/[slug]`: gallery, variant picker (`components/store/product-view.tsx`), attributes, JSON-LD
  - `sitemap.ts`, `robots.ts`, `not-found.tsx`
- **Admin pages** (route group `admin/(panel)`, wrapped in `AdminShell`, which exposes the current admin through `useAdmin()`):
  - `/admin/login` (the `?next=` redirect only allows `/admin` paths)
  - `/admin`: dashboard with counts
  - `/admin/products`: table with search, status filter, publish/unpublish and pagination
  - `/admin/products/new` and `/admin/products/[id]`: `components/admin/product-editor.tsx`, built from `variants-editor.tsx` (option definitions generate every combination and keep existing rows) and `images-editor.tsx` (upload, reorder, alt text)
  - `/admin/categories`: tree list plus a create/edit form
  - `/admin/settings`: store name, currency, locale and theme colors with swatches; read-only for EDITOR
- **UI primitives:** hand-written in the shadcn style in `components/ui/` (`button`, `form`, `misc`). The shadcn CLI was not used.
- **Client API:** `lib/admin-api.ts` (the `adminApi.*` calls and `ApiRequestError` with `.fieldErrors`); `lib/use-money.ts`.

---

## Phase 1: final steps (all done; kept for the record)

Phase 2 is built too; see "Phase 2: what's done" below.

1. ~~Debug the Playwright run~~ ✅ done 2026-09-25. All 5 tests pass, cold or warm, in about 8s. Causes:
   - The Playwright `webServer` commands went through `pnpm`, which doesn't forward SIGTERM, so `dotenv` → `next dev` was orphaned after each run and the next run reused a broken leftover server. `playwright.config.ts` now calls the `dotenv`/`next`/`nest` binaries directly, with `gracefulShutdown`.
   - `getByLabel("Price for M")` also matched "Compare-at price for M"; it's now `{ exact: true }`.
   - The app itself was fine: it was checked by hand in a browser (storefront, variant picker, admin login). A CSP "eval" warning in the DevTools Issues tab came from the browser (most likely an extension); the app sends no CSP.
2. ~~Commit the web app~~ ✅ done 2026-09-25. The root `.gitignore` entries `test-results` / `playwright-report` do apply under `apps/web`.
3. ~~Root `pnpm dev`~~ ✅ verified 2026-09-25, no changes needed. Turbo's `dev` task `dependsOn: ["^build"]` builds `@ecom/db` (including `prisma generate`) and `@ecom/shared` first, then runs the shared `tsc --watch`, the API (`nest --watch`) and web (`next dev`) together. Everything is up in about 7s and stops cleanly with Ctrl-C.
4. ~~README.md~~ ✅ It covers local dev, launching a new store (config, env table, deploy order) and the deploy topology.
   - **Build-order constraint:** `next build` prerenders store pages from the live API and **fails if the API is unreachable**, so deploy the API first and build the web app second. If that's a problem for a hosting platform, make the store pages render on first request instead of at build time.
5. ~~Smaller follow-ups~~ ✅
   - Pagination: now a windowed list (`pageWindow()` in `components/store/listing.tsx`, e.g. `1 … 9 10 11 … 20`) with Previous/Next links.
   - Product editor: the header and View link use the last saved product (`saved` state), not the stale prop.
   - Seed: `SEED_DEMO=false` creates only the admin user. The seed no longer prints the password.
   - `JWT_SECRET`: the API refuses to start with `NODE_ENV=production` if the secret is the placeholder or under 32 characters (`config/env.ts`).

**Still open (optional, not blocking Phase 2):**
- A CI workflow (GitHub Actions) that starts Postgres and runs the unit, API e2e and Playwright suites.
- No unit test runner for `apps/web` yet; `pageWindow()` was checked by hand.

---

## Phase 2: what's done

**Decisions (from the store owner):** guest checkout with optional accounts; **prices include tax** (no tax line); **manual payment** until Phase 3: orders start `PENDING` and an admin marks them `PAID` by hand (bank transfer or cash on delivery).

- **Config reaches the API:** `packages/store-config` compiles the root `store.config.ts` so the API can `import { storeConfig } from "@ecom/store-config"`. The web app still reads the file through its `@store-config` alias. After editing `store.config.ts`, rebuild that package (or restart `pnpm dev`) for the API to see the change.
- **`store.config.ts`:** `features.cart: true`, plus new `shipping: { flatRateMinor: 499, freeOverMinor: 5000 }`. Admin → Settings → Shipping overrides both (`storeSettingsSchema.shipping`).
- **DB** (migration `orders_customers_carts`): `Customer`, `Cart` / `CartItem`, `Order` / `OrderItem` / `OrderEvent`, enum `OrderStatus`.
  - Order numbers start at **#1001**.
  - Order items snapshot title, sku and price.
  - `Order.accessToken` is the secret behind the guest confirmation link.
  - `OrderEvent` records the status history (actor = admin email, `customer` or `guest`).
  - There's **no separate Address table**: the address is snapshotted as JSON on the order. A saved address book can come later.
- **Shared** (`packages/shared`):
  - schemas: `customerRegisterSchema`, `cartAddSchema`, `cartUpdateSchema`, `addressSchema`, `checkoutSchema`, `orderStatusUpdateSchema`, `adminOrderListQuerySchema`
  - `orders.ts`: `computeTotals()` (subtotal + shipping) and `ORDER_TRANSITIONS` / `canTransition()`
- **API** (`apps/api/src/commerce/`):
  - `customer-auth.ts`: `ecom_customer` JWT cookie (30 days, `typ: "customer"`), `ecom_cart` guest cookie, `CartFeatureGuard` (404 when `features.cart` is off), `OptionalCustomerGuard` / `CustomerAuthGuard`. Admin tokens now carry `typ: "admin"`, and the admin guard rejects customer tokens.
  - `cart.service.ts`: prices are always the live variant price. Lines for unpublished products are dropped when the cart is read. At login/registration the guest cart **merges** into the customer's cart (quantities added, capped at 99). A guest token never opens a customer's cart.
  - `orders.service.ts`: checkout runs in one transaction with `SELECT … FOR UPDATE` on the cart (so a double submit can't create two orders), recomputes everything on the server, snapshots the items, then clears the cart. The admin status update is guarded against concurrent changes.
  - Routes:
    - `account/{register,login,logout,me,orders,orders/:number}`
    - `cart`, `cart/items[/:id]`
    - `POST checkout`
    - `GET orders/:number?token=`
    - `admin/orders` (list, `counts`, `:number`, `PATCH :number/status`)
- **Web:**
  - `components/store/shop-provider.tsx` (cart and customer context, mounted only when `features.cart` is on)
  - header account and cart links, add-to-cart on product pages
  - pages: `/cart`, `/checkout`, `/order/[number]?token=`, `/account`, `/account/login|register` (`?next=` limited to same-site paths), `/account/orders/[number]`
  - admin: `/admin/orders` list and `/admin/orders/[number]` detail (allowed status buttons, note, history), dashboard tiles "Awaiting payment" / "Paid, to fulfil", and the Shipping card in Settings
  - `lib/api-client.ts` is the shared browser fetch client for `lib/admin-api.ts` and `lib/shop-api.ts`
- **Tests:**
  - 20 unit (15 new in `commerce/order-rules.spec.ts`)
  - 21 API e2e (5 new: guest cart, server-side repricing and snapshot, merge at registration and private orders, unpublished lines, admin statuses)
  - 7 Playwright (2 new: guest checkout → admin marks paid; register keeps cart → account order history)
  - With `cart: false`, every storefront commerce route and page returns 404 (checked by hand).

**Known gaps / follow-ups:**
- ~~No emails, hard-coded payment text, no password reset~~: done 2026-09-27 (see "Order emails").
- Abandoned guest carts are never deleted (`Cart.updatedAt` is indexed for a future cleanup job).
- Playwright runs leave test orders and customers in the dev DB (`guest-*@example.com`, `shopper-*@example.com`).
- The order-number sequence is set with `RESTART WITH 1001`, so `TRUNCATE … RESTART IDENTITY` (the API e2e tests) resets it to 1. Harmless.

---

## Order emails: what's done (2026-09-27)

- **`apps/api/src/email/`:**
  - `email-provider.ts`: `EmailProvider` interface, `ConsoleEmailProvider` (default; prints to the API log) and `ResendEmailProvider` (plain `fetch` to the Resend REST API, no SDK, 10 s timeout). Chosen by `EMAIL_DRIVER`. In production the console driver logs a warning at startup.
  - `templates.ts`: pure functions that render HTML and plain text from the same blocks; all catalog and customer text is HTML-escaped. There's a unit test in `templates.spec.ts`.
  - `email.module.ts`: a global `EmailService`. Sends run **in the background**, so a failing provider is only logged and never fails checkout. `flush()` waits for them (used by the e2e tests, which override `EMAIL_PROVIDER` with an in-memory outbox).
- **Emails:**
  - checkout → "Order #N received" to the customer (items, totals, address, payment instructions, and the private `/order/N?token=` link), plus a "New order" alert to `ORDER_NOTIFY_EMAIL`, or to every ADMIN user when that's empty
  - status → PAID / FULFILLED ("has shipped") / CANCELLED / REFUNDED: one customer email per change. **The admin's status note is not included** (it's internal).
  - Order emails are sent only after the checkout transaction commits.
- **Forgot password:** `POST account/forgot-password` (always 204, 5/min) and `POST account/reset-password` (sets the password and signs the customer in, merging the guest cart).
  - The token is a JWT signed with `JWT_SECRET + current passwordHash` and valid for 60 minutes. It stops working once the password changes, so each link works once. There's no token table.
  - Web pages: `/account/forgot-password`, `/account/reset-password?token=` (sends no referrer), and a "Forgot password?" link on sign in.
- **Payment instructions** are now a store setting: `storeSettingsSchema.paymentInstructions`, with the default in `store.config.ts`, edited under Admin → Settings → Payment. They're shown at checkout, on the order page (while PENDING) and in the confirmation email. Empty = show nothing.
- **New env vars** (in `.env.example` and the README): `EMAIL_DRIVER`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `ORDER_NOTIFY_EMAIL`. The API now also reads `SITE_URL`, for links in emails.
- **Follow-ups:**
  - A password reset doesn't sign out the customer's other existing sessions (the JWTs have no version claim).
  - There's no way to write a "message to customer" (e.g. a tracking number) on the shipped email.
  - No Playwright test for the reset flow; the API e2e test covers it.

---

## Phase 3: what's done (2026-09-29)

- **Provider layer** (`apps/api/src/payments/`):
  - `PaymentProvider` interface (`createCheckout`, `cancelCheckout`, `parseWebhook`, `refund`)
  - `StripeProvider` (Stripe Checkout, SDK `stripe@22`, API version `2026-08-26.dahlia`)
  - `createPaymentProvider()` returns **null when `features.payments` is off** (the manual flow), and throws at startup if it's on without keys
  - Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- **DB** (migration `payments`):
  - `Payment`: one row per Checkout Session; `providerRef` = session id, `chargeRef` = PaymentIntent id, status PENDING/SUCCEEDED/FAILED/REFUNDED, `redirectUrl`, `expiresAt`
  - `PaymentWebhookEvent`: raw log, unique `(provider, eventId)` for idempotency
- **Flow** (`commerce/payments.service.ts`, `orders.service.ts`):
  - Checkout creates the PENDING order (the cart is cleared as before), then a Checkout Session, and returns `paymentUrl`. If Stripe is down, the order is still placed and `paymentUrl` is null.
  - `POST orders/:number/pay` ("Pay now", by token or customer session) **reuses the open session** if it has more than 10 minutes left, so a double click can't cause a double charge.
  - `POST payments/webhook` (raw body; `main.ts` sets `rawBody: true`; skips the throttler):
    - The event row and its effects are written in one transaction.
    - `checkout.session.completed` (paid) or `async_payment_succeeded` → PAID, actor `payment provider`.
    - `expired` / `async_payment_failed` → the payment becomes FAILED (the order stays PENDING).
    - An amount/currency mismatch, or a payment for an order that isn't PENDING, is **not** applied; a "Needs attention" history entry is added instead.
  - Admin CANCELLED → expires open sessions first (409 if one was already paid). Admin REFUNDED → full refund through Stripe first (idempotency key `refund-<paymentId>`), outside the DB transaction.
  - `order-mapping.ts` holds `toOrderDto` / `transitionOrder` / `assertTransition`, shared by both services; the admin DTO includes `payments`.
- **Emails in card mode** (the store owner asked for fewer emails):
  - **Nothing is sent at checkout.** Once the webhook marks the order PAID, the customer gets one "Order #N confirmed" email (`orderConfirmedEmail`: full summary, address and link) and the store gets "New order… ready to fulfil".
  - Abandoned payments send nothing; the order page and account keep "Pay now".
  - Manual mode is unchanged: "Order received" (with payment instructions) and the staff alert at checkout, then "Payment received" when an admin marks it paid.
- **Web:**
  - Checkout says "Continue to payment" and redirects to Stripe. The Back button from Stripe goes to the order page (`pageshow` handler).
  - Order page: `?paid=1` shows "Confirming your payment…" (polls every 2 s, up to 30 s); unpaid orders show "Pay now" (`components/store/pay-now.tsx`, also on the account order page).
  - Admin order: a Payments card with a "View in Stripe" link, "Refund €X to the customer", and "Needs attention" history entries.
- **Tests:** `stripe-provider.spec.ts` checks signature verification and event mapping (signed with `generateTestHeaderString`); `payments.e2e-spec.ts` uses a fake provider; Playwright card test creates a real test-mode session (network + key needed), stubs Stripe's page, and sends a webhook signed with `STRIPE_WEBHOOK_SECRET` through the web `/api` proxy (this confirms the raw body survives the Next rewrite). `playwright.config.ts` now loads `../../.env`.
- **Follow-ups:**
  - Going live: activate the Stripe account, create the live webhook endpoint (README → Card payments → Production), and set up branding in Stripe.
  - A payment that arrives for a cancelled order is flagged but must be refunded in Stripe by hand (CANCELLED → REFUNDED isn't an allowed transition).
  - Partial refunds aren't supported (full refunds only).
  - Unpaid orders are never auto-cancelled (the store owner's choice); stale ones are cancelled by hand.

## Next phases (designed for, not built)

### Phase 4: stock management
- `InventoryItem` per variant: `onHand` and `reserved`, with available = onHand − reserved.
- `StockMovement`: an append-only ledger with reason codes (receive, sale, adjustment, return) and the user who made the change.
- Reserve stock when checkout starts (with a TTL), commit it on PAID, release it on cancel or expiry. Use transactions or `SELECT … FOR UPDATE` to prevent overselling.
- Admin: stock column on the products table, per-variant stock editing, a movement history, low-stock thresholds and alerts, and CSV import/export.
- Storefront: "out of stock" / "only N left" labels and a disabled purchase button. Gate everything behind `features.inventory`.
