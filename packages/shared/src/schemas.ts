import { z } from "zod";

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers and dashes");

export const productStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const variantInputSchema = z.object({
  id: z.string().optional(),
  sku: z.string().min(1).max(64),
  title: z.string().min(1).max(120).default("Default"),
  priceMinor: z.number().int().nonnegative(),
  compareAtMinor: z.number().int().nonnegative().nullable().optional(),
  options: z.record(z.string()).default({}),
  isDefault: z.boolean().default(false),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

export const imageInputSchema = z.object({
  url: z.string().url(),
  alt: z.string().max(200).default(""),
});

export const productInputSchema = z.object({
  slug,
  title: z.string().min(1).max(200),
  description: z.string().max(20000).default(""),
  status: productStatusSchema.default("DRAFT"),
  attributes: z.record(z.string()).default({}),
  categoryIds: z.array(z.string()).default([]),
  variants: z.array(variantInputSchema).min(1, "At least one variant is required"),
  images: z.array(imageInputSchema).default([]),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const categoryInputSchema = z.object({
  slug,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().default(0),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const productListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "title"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const adminProductListQuerySchema = productListQuerySchema.extend({
  status: productStatusSchema.optional(),
});
export type AdminProductListQuery = z.infer<typeof adminProductListQuerySchema>;

const hslTriplet = z.string().regex(/^\d{1,3}(\.\d+)? \d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/, 'Use "H S% L%" format');

/**
 * Runtime-editable store settings (admin → Settings). These override store.config.ts defaults.
 * Everything here is PUBLIC (served to the storefront) — never put secrets in settings.
 */
export const storeSettingsSchema = z
  .object({
    name: z.string().min(1).max(80),
    tagline: z.string().max(200),
    logoUrl: z.string().max(500),
    currency: z.string().length(3).toUpperCase(),
    locale: z.string().min(2).max(20),
    theme: z
      .object({
        primary: hslTriplet,
        primaryForeground: hslTriplet,
        accent: hslTriplet,
        radius: z.string().regex(/^\d+(\.\d+)?(rem|px)$/),
      })
      .partial(),
  })
  .partial()
  .strict();
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;