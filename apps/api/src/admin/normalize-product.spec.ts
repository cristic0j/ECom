import { BadRequestException } from "@nestjs/common";
import { productInputSchema } from "@ecom/shared";
import { minPrice, normalizeProductInput } from "./normalize-product";

const base = (variants: unknown[]) =>
  productInputSchema.parse({ slug: "p", title: "P", variants, categoryIds: ["a", "a", "b"] });

describe("normalizeProductInput", () => {
  it("makes the first variant default when none is flagged", () => {
    const out = normalizeProductInput(base([{ sku: "A", priceMinor: 100 }, { sku: "B", priceMinor: 50 }]));
    expect(out.variants.map((v) => v.isDefault)).toEqual([true, false]);
  });

  it("keeps only the first flagged default", () => {
    const out = normalizeProductInput(
      base([
        { sku: "A", priceMinor: 1 },
        { sku: "B", priceMinor: 1, isDefault: true },
        { sku: "C", priceMinor: 1, isDefault: true },
      ]),
    );
    expect(out.variants.map((v) => v.isDefault)).toEqual([false, true, false]);
  });

  it("rejects duplicate SKUs (after trimming)", () => {
    expect(() => normalizeProductInput(base([{ sku: "A", priceMinor: 1 }, { sku: " A ", priceMinor: 1 }]))).toThrow(
      BadRequestException,
    );
  });

  it("dedupes category ids", () => {
    expect(normalizeProductInput(base([{ sku: "A", priceMinor: 1 }])).categoryIds).toEqual(["a", "b"]);
  });

  it("computes the minimum variant price", () => {
    expect(minPrice(base([{ sku: "A", priceMinor: 300 }, { sku: "B", priceMinor: 120 }]))).toBe(120);
  });
});
