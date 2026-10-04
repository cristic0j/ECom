import { z } from "zod";

/** ISO 3166-1 alpha-2, e.g. "DE" */
const countryCode = z.string().trim().length(2, "Use a 2-letter country code, e.g. NL").toUpperCase();
const countryList = z.array(countryCode).transform((c) => [...new Set(c)]);

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
  inStock: z.boolean().default(true),
  /** What the store pays the supplier; admin-only, used to show profit */
  costMinor: z.number().int().nonnegative().nullable().optional(),
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
  /** Countries this product can't be delivered to (checkout blocks them) */
  notDeliveredTo: countryList.default([]),
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
    shipping: z
      .object({
        flatRateMinor: z.number().int().nonnegative(),
        /** Subtotal at or above which shipping is free; null = never free */
        freeOverMinor: z.number().int().nonnegative().nullable(),
        /** Countries the store delivers to; checkout offers only these, and imports are checked for them */
        countries: countryList.pipe(z.array(z.string()).min(1, "Add at least one country").max(30, "Use at most 30 countries")),
      })
      .partial(),
    /** Shown at checkout, on the order page and in the order email while an order awaits payment */
    paymentInstructions: z.string().trim().max(2000),
  })
  .partial()
  .strict();
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

// ---- Customers, cart, checkout, orders ----

const email = z.string().trim().toLowerCase().email().max(254);

export const customerRegisterSchema = z.object({
  email,
  password: z.string().min(8, "Use at least 8 characters").max(200),
  name: z.string().trim().max(120).default(""),
});
export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(2000),
  password: customerRegisterSchema.shape.password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const cartAddSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
});
export type CartAddInput = z.infer<typeof cartAddSchema>;

/** Quantity 0 removes the line. */
export const cartUpdateSchema = z.object({
  quantity: z.number().int().min(0).max(99),
});
export type CartUpdateInput = z.infer<typeof cartUpdateSchema>;

export const addressSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  line1: z.string().trim().min(1, "Address is required").max(200),
  line2: z.string().trim().max(200).default(""),
  city: z.string().trim().min(1, "City is required").max(120),
  postalCode: z.string().trim().min(1, "Postal code is required").max(20),
  country: countryCode,
  phone: z.string().trim().max(40).default(""),
});
export type Address = z.infer<typeof addressSchema>;

export const checkoutSchema = z.object({
  email,
  shippingAddress: addressSchema,
  note: z.string().trim().max(1000).default(""),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const orderStatusSchema = z.enum(["PENDING", "PAID", "FULFILLED", "CANCELLED", "REFUNDED"]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** Shipment tracking. The link goes into emails, so only http(s) URLs are accepted. */
export const orderTrackingSchema = z.object({
  trackingNumber: z.string().trim().max(100).default(""),
  trackingUrl: z
    .string()
    .trim()
    .max(500)
    .refine((u) => u === "" || /^https?:\/\/[^\s]+$/i.test(u), "Use a full link starting with https://")
    .default(""),
});
export type OrderTrackingInput = z.infer<typeof orderTrackingSchema>;

export const orderStatusUpdateSchema = z.object({
  status: orderStatusSchema,
  note: z.string().trim().max(1000).default(""),
  /** Only used when marking an order shipped (FULFILLED) */
  tracking: orderTrackingSchema.optional(),
});
export type OrderStatusUpdateInput = z.infer<typeof orderStatusUpdateSchema>;

/** "Pay now" on an unpaid order: guests prove access with the order's token, customers with their session. */
export const payOrderSchema = z.object({ token: z.string().max(200).optional() });
export type PayOrderInput = z.infer<typeof payOrderSchema>;

export const paymentStatusSchema = z.enum(["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const adminOrderListQuerySchema = z.object({
  /** Order number, or part of the customer email */
  q: z.string().trim().max(200).optional(),
  status: orderStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;

/** Finishing a supplier connection: the address the supplier sent the browser to, or just its `code` value. */
export const supplierConnectSchema = z.object({ code: z.string().trim().min(1).max(4000) });
export type SupplierConnectInput = z.infer<typeof supplierConnectSchema>;

/** An AliExpress product link (any form AliExpress shares), or just its product id. */
export const supplierImportSchema = z.object({ url: z.string().trim().min(1, "Paste a product link").max(2000) });
export type SupplierImportInput = z.infer<typeof supplierImportSchema>;

/**
 * Searching AliExpress from the admin: words, a category, both, or neither (bestsellers across all categories).
 * AliExpress's search can't filter by price,
 * sales or reviews for a dropshipping app, so minCost/maxCost (minor units), minSold and reviews only drop
 * results from the page it returns.
 */
export const supplierSearchQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    categoryId: z
      .string()
      .regex(/^\d{1,12}$/)
      .optional(),
    sort: z.enum(["best", "orders", "reviews"]).default("orders"),
    page: z.coerce.number().int().min(1).max(50).default(1),
    minCost: z.coerce.number().int().nonnegative().optional(),
    maxCost: z.coerce.number().int().nonnegative().optional(),
    minSold: z.coerce.number().int().nonnegative().optional(),
    /** good: ★4+ or 90%+ positive; excellent: ★4.5+ or 95%+ positive */
    reviews: z.enum(["good", "excellent"]).optional(),
  })
  .refine((q) => q.minCost === undefined || q.maxCost === undefined || q.minCost <= q.maxCost, {
    message: "The lowest price must be below the highest",
    path: ["maxCost"],
  });
export type SupplierSearchQuery = z.infer<typeof supplierSearchQuerySchema>;

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;