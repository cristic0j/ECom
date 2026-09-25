"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { formatMoney, type ProductDto, type VariantDto } from "@ecom/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/misc";

/** Option names in first-seen order with their distinct values, e.g. { size: ["S","M"], color: [...] }. */
function collectOptions(variants: VariantDto[]): [string, string[]][] {
  const map = new Map<string, string[]>();
  for (const v of variants) {
    for (const [name, value] of Object.entries(v.options)) {
      const values = map.get(name) ?? [];
      if (!values.includes(value)) values.push(value);
      map.set(name, values);
    }
  }
  return [...map.entries()];
}

const matches = (v: VariantDto, selected: Record<string, string>) =>
  Object.entries(selected).every(([k, val]) => v.options[k] === val);

export function ProductView({ product, currency, locale }: { product: ProductDto; currency: string; locale: string }) {
  const options = useMemo(() => collectOptions(product.variants), [product.variants]);
  const initial = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const [selected, setSelected] = useState<Record<string, string>>(initial?.options ?? {});
  const [activeImage, setActiveImage] = useState(0);

  const variant = product.variants.find((v) => matches(v, selected));
  const format = (minor: number) => formatMoney(minor, currency, locale);

  const choose = (name: string, value: string) => {
    const next = { ...selected, [name]: value };
    // If the exact combination doesn't exist, jump to the first variant that has the clicked value
    const exact = product.variants.find((v) => matches(v, next));
    const fallback = product.variants.find((v) => v.options[name] === value);
    const target = exact ?? fallback;
    if (!target) return;
    setSelected(target.options);
    const imgIndex = product.images.findIndex((i) => i.variantId === target.id);
    if (imgIndex >= 0) setActiveImage(imgIndex);
  };

  const isAvailable = (name: string, value: string) =>
    product.variants.some((v) => matches(v, { ...selected, [name]: value }));

  const image = product.images[activeImage] ?? product.images[0];
  const onSale = variant?.compareAtMinor != null && variant.compareAtMinor > variant.priceMinor;

  return (
    <div className="grid gap-10 md:grid-cols-2">
      <div className="space-y-3">
        <div className="relative aspect-square overflow-hidden rounded-(--radius) bg-muted">
          {image ? (
            <Image
              src={image.url}
              alt={image.alt || product.title}
              fill
              priority
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">No image</div>
          )}
        </div>
        {product.images.length > 1 && (
          <div className="grid grid-cols-5 gap-2">
            {product.images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setActiveImage(i)}
                aria-label={`Show image ${i + 1}`}
                aria-pressed={i === activeImage}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-(--radius) border-2",
                  i === activeImage ? "border-primary" : "border-transparent",
                )}
              >
                <Image src={img.url} alt="" fill sizes="10vw" className="object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{product.title}</h1>
          {variant ? (
            <p className="flex items-center gap-3 text-2xl" data-testid="price">
              <span className="font-semibold">{format(variant.priceMinor)}</span>
              {onSale && (
                <>
                  <span className="text-lg text-muted-foreground line-through">{format(variant.compareAtMinor!)}</span>
                  <Badge tone="accent">Sale</Badge>
                </>
              )}
            </p>
          ) : (
            <p className="text-muted-foreground">This combination is unavailable.</p>
          )}
        </div>

        {options.map(([name, values]) => (
          <fieldset key={name} className="space-y-2">
            <legend className="text-sm font-medium capitalize">
              {name}: <span className="text-muted-foreground">{selected[name]}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {values.map((value) => {
                const active = selected[name] === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => choose(name, value)}
                    aria-pressed={active}
                    className={cn(
                      "min-w-12 rounded-(--radius) border px-4 py-2 text-sm transition",
                      active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary",
                      !isAvailable(name, value) && !active && "opacity-40",
                    )}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        {variant && <p className="text-xs text-muted-foreground">SKU: {variant.sku}</p>}

        {product.description && (
          <div className="border-t border-border pt-6">
            <h2 className="mb-2 font-semibold">Description</h2>
            <p className="whitespace-pre-line text-muted-foreground">{product.description}</p>
          </div>
        )}

        {Object.keys(product.attributes).length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
            {Object.entries(product.attributes).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-medium capitalize">{k}</dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
