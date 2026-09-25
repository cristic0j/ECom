import Image from "next/image";
import Link from "next/link";
import type { ProductSummaryDto } from "@ecom/shared";
import { Badge } from "@/components/ui/misc";

export function ProductCard({ product, format }: { product: ProductSummaryDto; format: (minor: number) => string }) {
  const onSale = product.compareAtMinor != null && product.compareAtMinor > product.priceMinor;
  return (
    <Link href={`/p/${product.slug}`} className="group block" data-testid="product-card">
      <div className="relative aspect-square overflow-hidden rounded-(--radius) bg-muted">
        {product.image ? (
          <Image
            src={product.image.url}
            alt={product.image.alt || product.title}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No image</div>
        )}
        {onSale && (
          <Badge tone="accent" className="absolute top-2 left-2">
            Sale
          </Badge>
        )}
      </div>
      <div className="mt-3 space-y-1">
        <h3 className="text-sm font-medium group-hover:underline">{product.title}</h3>
        <p className="text-sm">
          <span className="font-semibold">{format(product.priceMinor)}</span>
          {onSale && <span className="ml-2 text-muted-foreground line-through">{format(product.compareAtMinor!)}</span>}
        </p>
      </div>
    </Link>
  );
}

export function ProductGrid({
  products,
  format,
}: {
  products: ProductSummaryDto[];
  format: (minor: number) => string;
}) {
  if (!products.length) {
    return <p className="py-16 text-center text-muted-foreground">No products found.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} format={format} />
      ))}
    </div>
  );
}
