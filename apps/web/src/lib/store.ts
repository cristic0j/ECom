import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { formatMoney } from "@ecom/shared";
import { storeConfig } from "@store-config";
import { api } from "./api";

export type Store = {
  name: string;
  tagline: string;
  logoUrl: string;
  currency: string;
  locale: string;
  theme: { primary: string; primaryForeground: string; accent: string; radius: string };
  features: typeof storeConfig.features;
  pageSize: number;
  /** How to pay while card payments aren't set up; empty = say nothing */
  paymentInstructions: string;
  /** Countries the store delivers to (ISO alpha-2), in the owner's order */
  shippingCountries: string[];
};

/** store.config.ts defaults with admin Settings overrides applied. Deduped per request. */
export const getStore = cache(async (): Promise<Store> => {
  const overrides = await api.settings().catch(() => ({}) as Awaited<ReturnType<typeof api.settings>>);
  return {
    name: overrides.name ?? storeConfig.name,
    tagline: overrides.tagline ?? storeConfig.tagline,
    logoUrl: overrides.logoUrl ?? storeConfig.logoUrl,
    currency: overrides.currency ?? storeConfig.currency,
    locale: overrides.locale ?? storeConfig.locale,
    theme: { ...storeConfig.theme, ...overrides.theme },
    features: storeConfig.features,
    pageSize: storeConfig.catalog.pageSize,
    paymentInstructions: overrides.paymentInstructions ?? storeConfig.paymentInstructions,
    shippingCountries: overrides.shipping?.countries ?? storeConfig.shipping.countries,
  };
});

export async function getMoneyFormatter() {
  const { currency, locale } = await getStore();
  return (minor: number) => formatMoney(minor, currency, locale);
}

/** Commerce pages (cart, checkout, account) 404 when `features.cart` is off. */
export async function requireCartFeature(): Promise<void> {
  if (!(await getStore()).features.cart) notFound();
}
