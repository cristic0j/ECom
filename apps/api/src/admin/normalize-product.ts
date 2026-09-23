import { BadRequestException } from "@nestjs/common";
import type { ProductInput } from "@ecom/shared";

/**
 * Enforces product invariants that zod can't express on its own:
 * unique SKUs within the product and exactly one default variant.
 */
export function normalizeProductInput(input: ProductInput): ProductInput {
  const skus = input.variants.map((v) => v.sku.trim());
  const dupes = skus.filter((s, i) => skus.indexOf(s) !== i);
  if (dupes.length) throw new BadRequestException(`Duplicate SKU(s): ${[...new Set(dupes)].join(", ")}`);

  let defaultIndex = input.variants.findIndex((v) => v.isDefault);
  if (defaultIndex === -1) defaultIndex = 0;

  return {
    ...input,
    categoryIds: [...new Set(input.categoryIds)],
    variants: input.variants.map((v, i) => ({ ...v, sku: skus[i], isDefault: i === defaultIndex })),
  };
}

export const minPrice = (input: ProductInput) => Math.min(...input.variants.map((v) => v.priceMinor));
