import type { Metadata } from "next";
import { requireCartFeature } from "@/lib/store";
import { CartView } from "@/components/store/cart-view";

export const metadata: Metadata = { title: "Cart", robots: { index: false } };

export default async function CartPage() {
  await requireCartFeature();
  return <CartView />;
}
