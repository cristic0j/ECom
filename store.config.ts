/**
 * Per-store configuration. This is the main file to edit when launching a new store
 * from this template. Values here can be overridden at runtime via the admin Settings page.
 */
export const storeConfig = {
  name: "Demo Store",
  tagline: "Quality products, delivered.",
  logoUrl: "/logo.svg",
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
    // Future modules — flip on as they are implemented
    cart: false,
    payments: false,
    inventory: false,
    reviews: false,
  },
  catalog: {
    pageSize: 24,
  },
} as const;

export type StoreConfig = typeof storeConfig;
