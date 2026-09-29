# E-commerce Template

A reusable single-store e-commerce template. Every store is its own deployment of this same codebase. You customize a store through `store.config.ts`, environment variables and the admin **Settings** page, never by forking the code.

- **Storefront:** home, category pages with filters and sorting, search, product pages with a variant picker, sitemap and JSON-LD
- **Shopping:** cart (for guests too), checkout, optional customer accounts with order history
- **Admin** (`/admin`): orders (with status changes and history), products with variants and images, categories, and store settings (name, currency, theme colors, shipping)
- **Stack:** Next.js 16 (web), NestJS 11 (API), PostgreSQL 16 + Prisma 6, pnpm workspaces + Turborepo

```
apps/api          NestJS API (port 4000, prefix /api, Swagger at /api/docs)
apps/web          Next.js storefront + /admin (port 3000)
packages/db       Prisma schema, migrations, seed
packages/shared   zod schemas + types shared by API and web
packages/store-config  compiles store.config.ts so the API can read it
store.config.ts   per-store defaults
```

## Local development

Requirements: Node 22+, pnpm 12, Docker.

```bash
cp .env.example .env
docker-compose up -d          # Postgres on localhost:5433
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev                      # API on :4000 and web on :3000
```

Open http://localhost:3000 for the store, and http://localhost:3000/admin to sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (default `admin@example.com` / `admin12345`).

Tests:

```bash
pnpm --filter @ecom/api test        # API unit tests
pnpm --filter @ecom/api test:e2e    # API e2e (uses an isolated "e2e" Postgres schema)
cd apps/web && pnpm test:e2e        # Playwright; starts the dev servers if they aren't running
```

## Launching a new store

1. **Clone** the repository into a new project for the store.

2. **Edit `store.config.ts`:**
   - `name`, `tagline`, `logoUrl`
   - `currency` (ISO code, e.g. `EUR`) and `locale` (e.g. `de-DE`)
   - `theme`: colors as HSL values, plus the corner `radius`
   - `features`: `cart` turns on accounts, cart, checkout and orders; the others are for later phases
   - `shipping`: flat rate and free-shipping threshold, in cents (prices include tax)
   - `catalog.pageSize`

   These are defaults. Name, currency, locale, theme and shipping can also be changed later from the admin Settings page without redeploying.

   **Payments:** card payments arrive in a later phase. Until then orders are placed as *pending*, you arrange payment with the customer (bank transfer or cash on delivery), and you mark the order paid in the admin.

3. **Configure the environment.** Copy `.env.example` to `.env`, or set the variables on your hosting platform:

   | Variable | Production value |
   |---|---|
   | `DATABASE_URL` | Your managed Postgres connection string |
   | `JWT_SECRET` | A long random string: `openssl rand -base64 48`. The API won't start in production with the placeholder. |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first admin account, created by the seed |
   | `SEED_DEMO` | `false`, so the seed doesn't create demo products |
   | `STORAGE_DRIVER` | `s3`, because local uploads don't survive redeploys |
   | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL` | Your bucket (AWS S3, Cloudflare R2 or any S3-compatible store). Leave `S3_ENDPOINT` empty for AWS. |
   | `IMAGE_HOSTS` | Hostname of `S3_PUBLIC_URL` (comma-separated if there's more than one), so Next.js will optimize those images |
   | `API_INTERNAL_URL` | Where the web server reaches the API, e.g. `http://api.internal:4000` |
   | `SITE_URL` | The public store URL, e.g. `https://shop.example.com` (used for the sitemap, canonical URLs and links in emails). The API needs it too. |
   | `EMAIL_DRIVER`, `RESEND_API_KEY`, `EMAIL_FROM` | `resend`, your Resend API key, and a sender such as `My Store <orders@shop.example.com>`. Verify the sender's domain in Resend first. With the default `console`, emails are only printed in the API log. |
   | `ORDER_NOTIFY_EMAIL`, `EMAIL_REPLY_TO` | Optional. Who gets "new order" alerts (default: every ADMIN user) and where customer replies go (default: the sender). |
   | `API_PUBLIC_URL`, `WEB_ORIGIN` | The API's public URL and the store's origin. They only matter if browsers call the API directly (see below). |

   `IMAGE_HOSTS`, `API_INTERNAL_URL` and `SITE_URL` are read when the web app is **built**, so set them for the build as well as at runtime.

4. **Migrate, seed, build and start.** Order matters: the web build prerenders store pages from live API data, so **the API must be running and reachable at `API_INTERNAL_URL` when you build the web app.**

   ```bash
   pnpm install --frozen-lockfile

   # API first
   pnpm turbo run build --filter=@ecom/api  # also builds packages/db and packages/shared
   pnpm --filter @ecom/db migrate:deploy    # applies migrations; never use db:migrate in production
   pnpm db:seed                             # idempotent; safe to run on every deploy
   pnpm --filter @ecom/api start

   # then the web app
   pnpm turbo run build --filter=@ecom/web
   pnpm --filter @ecom/web start
   ```

   On a platform that deploys services separately, deploy the API service before the web service.

5. **Replace the demo content.** If you seeded with `SEED_DEMO=true`, delete the demo products and categories in the admin. Their images come from `picsum.photos`.

## Deploy topology

The browser only ever talks to the **web** app. Next.js forwards `/api/*` to the API at `API_INTERNAL_URL`, so the admin session cookie is first-party and no CORS setup is needed.

```
browser ──► web (Next.js, public) ──/api/*──► API (NestJS, private) ──► Postgres
   └──────────── images ────────────► S3 / CDN (public)
```

- **Recommended:** keep the API on a private network, reachable only by the web app (for example as an internal service on your platform), and point `API_INTERNAL_URL` at it. Only the web app needs a public domain.
- **API on its own public host:** this also works, e.g. `api.shop.example.com`. Set `API_INTERNAL_URL` to it, and set `API_PUBLIC_URL` and `WEB_ORIGIN` accordingly.
- The admin cookie is marked `Secure` when `NODE_ENV=production`, so serve the store over HTTPS.
