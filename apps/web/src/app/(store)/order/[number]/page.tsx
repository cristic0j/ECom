import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCartFeature } from "@/lib/store";
import { OrderConfirmation } from "@/components/store/order-confirmation";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default async function OrderPage({ params, searchParams }: PageProps<"/order/[number]">) {
  await requireCartFeature();
  const number = Number((await params).number);
  const { token } = await searchParams;
  if (!Number.isInteger(number) || typeof token !== "string") notFound();
  return <OrderConfirmation number={number} token={token} />;
}
