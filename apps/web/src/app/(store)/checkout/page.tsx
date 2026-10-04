import type { Metadata } from "next";
import { countryName } from "@ecom/shared";
import { getStore, requireCartFeature } from "@/lib/store";
import { CheckoutForm } from "@/components/store/checkout-form";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  await requireCartFeature();
  const { locale, paymentInstructions, features, shippingCountries } = await getStore();
  // "en-US" → "US"; a sensible first guess for the shipping country when the store delivers there
  const localeCountry = locale.split("-")[1]?.toUpperCase() ?? "";
  const countries = shippingCountries
    .map((code) => ({ code, name: countryName(code, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  return (
    <CheckoutForm
      countries={countries}
      defaultCountry={shippingCountries.includes(localeCountry) ? localeCountry : ""}
      paymentInstructions={paymentInstructions}
      cardPayments={features.payments}
    />
  );
}
