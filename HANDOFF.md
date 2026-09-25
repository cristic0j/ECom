# Project Handoff — E-commerce Template

_Last updated: 2026-09-25. Read this first when resuming work._

## Goal

A **reusable single-store e-commerce template**. Each store is a separate deployment of the same codebase, customized through `store.config.ts`, env vars and the admin Settings page, never by forking code.

The work is split into four phases:

| Phase | Scope | Status |
|---|---|---|
| 1 | Product catalog + admin panel | 🟡 almost done |
| 2 | Customer accounts, cart, checkout, orders | ⬜ not started |
| 3 | Payments (Stripe, via a provider interface) | ⬜ not started |
| 4 | Stock management (per-variant inventory) | ⬜ not started |

Full original plan: `~/.claude/plans/i-am-planning-to-recursive-shell.md`

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
7. The previous session left the API running from `apps/api/dist` on port 4000. Stop it with `pkill -f "node dist/main.js"`.

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

## Phase 1: what's left (do these next, in order)

1. ~~Debug the Playwright run~~ ✅ done 2026-09-25. All 5 tests pass, cold or warm, in about 8s. Causes:
   - The Playwright `webServer` commands went through `pnpm`, which doesn't forward SIGTERM, so `dotenv` → `next dev` was orphaned after each run and the next run reused a broken leftover server. `playwright.config.ts` now calls the `dotenv`/`next`/`nest` binaries directly, with `gracefulShutdown`.
   - `getByLabel("Price for M")` also matched "Compare-at price for M"; it's now `{ exact: true }`.
   - The app itself was fine: it was checked by hand in a browser (storefront, variant picker, admin login). A CSP "eval" warning in the DevTools Issues tab came from the browser (most likely an extension); the app sends no CSP.
2. ~~Commit the web app~~ ✅ done 2026-09-25. The root `.gitignore` entries `test-results` / `playwright-report` do apply under `apps/web`.
3. **Root `pnpm dev`:** check that turbo runs the API and web together. The shared package has a `dev` watch script; the db package has none, so it has to be built first.
4. **README.md:** how to launch a new store:
   1. Clone the repo.
   2. Edit `store.config.ts` (name, currency, locale, theme, features).
   3. Copy `.env.example` to `.env` and set `JWT_SECRET`, the `ADMIN_*` values, and `STORAGE_DRIVER=s3` with the `S3_*` settings plus `IMAGE_HOSTS` for production.
   4. Migrate, seed and deploy.

   Also describe the deploy topology: web and API behind one domain, or `API_INTERNAL_URL` pointing at a private API host.
5. **Smaller follow-ups found during the build:**
   - Storefront pagination renders every page number; switch to a windowed list.
   - The "View" link in the product editor uses the stale `product.status` from before a save.
   - The seed uses `picsum.photos` images. That's fine for the demo, but new stores should replace them.
   - Consider a CI workflow (GitHub Actions) that starts Postgres and runs the unit, API e2e and Playwright suites.
   - Rotate `JWT_SECRET` in production; `.env.example` ships a placeholder.

---

## Next phases (designed for, not built)

The existing design already leaves room for these:
- Feature flags `cart`, `payments`, `inventory` and `reviews` live in `store.config.ts`.
- Variant ids are stable.
- Money is stored as integer minor units.

### Phase 2: customers, cart, checkout, orders
- Prisma models:
  - `Customer`: separate from `AdminUser`, with its own auth cookie (e.g. `ecom_customer`)
  - `Address`
  - `Cart` and `CartItem`: `variantId` and qty; guest carts keyed by a cookie and merged at login
  - `Order` and `OrderItem`: **snapshot** title, sku and unit price at purchase time, then status PENDING → PAID → FULFILLED / CANCELLED / REFUNDED
- API modules: `customers`, `cart`, `checkout` (validate the cart, recompute prices on the server, create a PENDING order) and `admin/orders` (list, detail, status changes).
- Web:
  - cart drawer and page, checkout form, account pages (login/register, order history)
  - admin Orders page
  - gate everything behind `features.cart`
- Shipping and tax: start with flat-rate or free-over-X rules stored in settings, behind an interface.

### Phase 3: payments
- `PaymentProvider` interface (`createPayment`, `handleWebhook`, `refund`), with `StripeProvider` as the first implementation (Checkout Session or Payment Element).
- A webhook endpoint with signature verification and idempotency (store processed event ids). An order becomes PAID **only from the webhook**, never from the client redirect.
- A `Payment` model: provider, providerRef, amount, status, and the raw event log.
- Admin: payment status on the order, plus a refund action. Gate everything behind `features.payments`; the Stripe keys go in env vars, never in StoreSettings.

### Phase 4: stock management
- `InventoryItem` per variant: `onHand` and `reserved`, with available = onHand − reserved.
- `StockMovement`: an append-only ledger with reason codes (receive, sale, adjustment, return) and the user who made the change.
- Reserve stock when checkout starts (with a TTL), commit it on PAID, release it on cancel or expiry. Use transactions or `SELECT … FOR UPDATE` to prevent overselling.
- Admin: stock column on the products table, per-variant stock editing, a movement history, low-stock thresholds and alerts, and CSV import/export.
- Storefront: "out of stock" / "only N left" labels and a disabled purchase button. Gate everything behind `features.inventory`.
