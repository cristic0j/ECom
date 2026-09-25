import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, NotFoundError } from "@/lib/api";
import { getMoneyFormatter, getStore } from "@/lib/store";
import { Listing, parseListingParams } from "@/components/store/listing";

async function loadCategory(slug: string) {
  try {
    return await api.category(slug);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const category = await loadCategory((await params).slug);
  return { title: category.name, description: category.description ?? undefined };
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const [category, store, format] = await Promise.all([loadCategory(slug), getStore(), getMoneyFormatter()]);
  const query = parseListingParams(sp, store.pageSize);
  const result = await api.products({ ...query, category: slug });

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
        {category.description && <p className="text-muted-foreground">{category.description}</p>}
        {category.children && category.children.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-2">
            {category.children.map((c) => (
              <li key={c.id}>
                <Link href={`/c/${c.slug}`} className="rounded-full border border-border px-3 py-1 text-sm hover:border-primary">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </header>
      <Listing result={result} format={format} basePath={`/c/${slug}`} searchParams={sp} />
    </div>
  );
}
