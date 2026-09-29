import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStore, requireCartFeature } from "@/lib/store";
import { OrderConfirmation } from "@/components/store/order-confirmation";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default async function OrderPage({ params, searchParams }: PageProps<"/order/[number]">) {
  await requireCartFeature();
  const number = Number((await params).number);
  const { token, paid } = await searchParams;
  if (!Number.isInteger(number) || typeof token !== "string") notFound();
  const { paymentInstructions, features } = await getStore();
  return (
    <OrderConfirmation
      number={number}
      token={token}
      paymentInstructions={paymentInstructions}
      cardPayments={features.payments}
      // Set by the payment page's return link; the order may not be marked paid yet
      returnedFromPayment={paid === "1"}
    />
  );
}
