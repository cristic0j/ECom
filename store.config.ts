/**
 * Per-store configuration. This is the main file to edit when launching a new store
 * from this template. Values here can be overridden at runtime via the admin Settings page.
 */
export const storeConfig = {
  name: "Demo Store",
  tagline: "Quality products, delivered.",
  logoUrl: "", // optional; header shows the store name when empty
  currency: "EUR",
  locale: "en-US",
  theme: {
    // HSL values (without hsl()) consumed as CSS variables by Tailwind
    primary: "222 47% 11%",
    primaryForeground: "210 40% 98%",
    accent: "24 95% 53%",
    radius: "0.5rem",
  },
  features: {
    // Customer accounts, cart, checkout and orders
    cart: true,
    // Card payments with Stripe (needs STRIPE_* env vars; see README → Card payments).
    // Off = orders are paid by hand (bank transfer / cash on delivery) and marked paid in the admin.
    payments: true,
    // Future modules — flip on as they are implemented
    inventory: false,
    reviews: false,
  },
  catalog: {
    pageSize: 24,
  },
  // Prices include tax. Amounts in minor units (cents); editable later in admin → Settings.
  shipping: {
    flatRateMinor: 499 as number,
    // Orders at or above this subtotal ship free; null = never free
    freeOverMinor: 5000 as number | null,
    // Countries the store delivers to (2-letter codes). Checkout offers only these, and AliExpress
    // imports are checked for them. Editable in admin → Settings → Shipping.
    countries: ["NL", "DE", "FR", "ES", "IT", "US"] as string[],
  },
  // Shown when card payments are off and orders are paid by hand. Editable in admin → Settings.
  paymentInstructions:
    "After you place your order, we'll email you the payment details (bank transfer or cash on delivery). Your order ships once payment is received." as string,
} as const;

export type StoreConfig = typeof storeConfig;
