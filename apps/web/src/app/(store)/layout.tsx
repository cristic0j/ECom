import Link from "next/link";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { getStore } from "@/lib/store";
import { ShopProvider } from "@/components/store/shop-provider";
import { ShopHeaderLinks } from "@/components/store/shop-header";

export default async function StoreLayout({ children }: LayoutProps<"/">) {
  const [store, categories] = await Promise.all([getStore(), api.categories().catch(() => [])]);

  const page = (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            {store.name}
          </Link>
          <nav aria-label="Categories" className="hidden gap-5 text-sm md:flex">
            {categories.map((c) => (
              <Link key={c.id} href={`/c/${c.slug}`} className="text-muted-foreground hover:text-foreground">
                {c.name}
              </Link>
            ))}
          </nav>
          <form action="/search" className="ml-auto flex items-center" role="search">
            <label htmlFor="site-search" className="sr-only">
              Search products
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="site-search"
                name="q"
                type="search"
                placeholder="Search…"
                className="h-9 w-40 rounded-full border border-border bg-muted pr-3 pl-9 text-sm outline-none focus:border-primary sm:w-64"
              />
            </div>
          </form>
          {store.features.cart && <ShopHeaderLinks />}
        </div>
        {categories.length > 0 && (
          <nav aria-label="Categories" className="flex gap-4 overflow-x-auto px-4 pb-3 text-sm md:hidden">
            {categories.map((c) => (
              <Link key={c.id} href={`/c/${c.slug}`} className="shrink-0 text-muted-foreground">
                {c.name}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <p>
            © {new Date().getFullYear()} {store.name}
          </p>
          <p>{store.tagline}</p>
        </div>
      </footer>
    </div>
  );

  if (!store.features.cart) return page;
  return (
    <ShopProvider currency={store.currency} locale={store.locale}>
      {page}
    </ShopProvider>
  );
}
