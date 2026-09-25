import Link from "next/link";
import { api } from "@/lib/api";
import { getMoneyFormatter, getStore } from "@/lib/store";
import { ProductGrid } from "@/components/store/product-card";
import { buttonClass } from "@/components/ui/button";

export default async function HomePage() {
  const [store, format, latest, categories] = await Promise.all([
    getStore(),
    getMoneyFormatter(),
    api.products({ sort: "newest", pageSize: 8 }),
    api.categories(),
  ]);

  return (
    <div className="space-y-16">
      <section className="rounded-(--radius) bg-primary px-6 py-16 text-primary-foreground sm:px-12 sm:py-24">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">{store.name}</h1>
        <p className="mt-4 max-w-xl text-lg opacity-80">{store.tagline}</p>
        <Link href="/search" className={`${buttonClass("secondary", "lg")} mt-8 text-foreground`}>
          Shop all products
        </Link>
      </section>

      {categories.length > 0 && (
        <section aria-labelledby="categories-heading">
          <h2 id="categories-heading" className="mb-6 text-2xl font-semibold">
            Shop by category
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {categories.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/c/${c.slug}`}
                  className="block rounded-(--radius) border border-border p-6 font-medium transition hover:border-primary"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="latest-heading">
        <h2 id="latest-heading" className="mb-6 text-2xl font-semibold">
          New arrivals
        </h2>
        <ProductGrid products={latest.items} format={format} />
      </section>
    </div>
  );
}
