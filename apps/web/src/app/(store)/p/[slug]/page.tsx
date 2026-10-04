import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { countryName } from "@ecom/shared";
import { api, NotFoundError } from "@/lib/api";
import { getStore } from "@/lib/store";
import { ProductView } from "@/components/store/product-view";

async function loadProduct(slug: string) {
  try {
    return await api.product(slug);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const product = await loadProduct((await params).slug);
  const description = product.description.slice(0, 160) || undefined;
  return {
    title: product.title,
    description,
    alternates: { canonical: `/p/${product.slug}` },
    openGraph: { title: product.title, description, images: product.images.slice(0, 1).map((i) => i.url) },
  };
}

export default async function ProductPage({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const [product, store] = await Promise.all([loadProduct(slug), getStore()]);
  const primaryCategory = product.categories[0];
  const defaultVariant = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const deliversTo = store.shippingCountries.filter((c) => !product.notDeliveredTo.includes(c));
  const restricted = deliversTo.length < store.shippingCountries.length;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    image: product.images.map((i) => i.url),
    sku: defaultVariant?.sku,
    offers: product.variants.map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      price: (v.priceMinor / 100).toFixed(2),
      priceCurrency: store.currency,
      availability: v.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    })),
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>
        {primaryCategory && (
          <>
            {" / "}
            <Link href={`/c/${primaryCategory.slug}`} className="hover:text-foreground">
              {primaryCategory.name}
            </Link>
          </>
        )}
      </nav>
      <ProductView
        product={product}
        currency={store.currency}
        locale={store.locale}
        deliversTo={restricted ? deliversTo.map((c) => countryName(c, store.locale)) : null}
      />
      <script
        type="application/ld+json"
        // JSON.stringify output is safe here once "<" is escaped (prevents </script> breakout)
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </>
  );
}
