import type { Metadata } from "next";
import { getStore, requireCartFeature } from "@/lib/store";
import { CheckoutForm } from "@/components/store/checkout-form";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  await requireCartFeature();
  const { locale, paymentInstructions } = await getStore();
  // "en-US" → "US"; a sensible first guess for the shipping country
  const defaultCountry = locale.split("-")[1]?.toUpperCase() ?? "";
  return <CheckoutForm defaultCountry={defaultCountry} paymentInstructions={paymentInstructions} />;
}
