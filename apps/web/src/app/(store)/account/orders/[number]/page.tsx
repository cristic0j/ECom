import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCartFeature } from "@/lib/store";
import { AccountOrder } from "@/components/store/account";

export const metadata: Metadata = { title: "Order", robots: { index: false } };

export default async function AccountOrderPage({ params }: PageProps<"/account/orders/[number]">) {
  await requireCartFeature();
  const number = Number((await params).number);
  if (!Number.isInteger(number)) notFound();
  return <AccountOrder number={number} />;
}
