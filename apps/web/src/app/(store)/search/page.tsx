import type { Metadata } from "next";
import { api } from "@/lib/api";
import { getMoneyFormatter, getStore } from "@/lib/store";
import { Listing, parseListingParams } from "@/components/store/listing";

export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: typeof q === "string" && q ? `Search: ${q}` : "All products", robots: { index: false } };
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const [store, format] = await Promise.all([getStore(), getMoneyFormatter()]);
  const query = parseListingParams(sp, store.pageSize);
  const result = await api.products(query);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">
        {query.q ? <>Results for &ldquo;{query.q}&rdquo;</> : "All products"}
      </h1>
      <Listing result={result} format={format} basePath="/search" searchParams={sp} />
    </div>
  );
}
