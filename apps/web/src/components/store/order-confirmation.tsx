"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { OrderDto } from "@ecom/shared";
import { shopApi } from "@/lib/shop-api";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { useShop } from "./shop-provider";
import { OrderDetails } from "./order-details";

export function OrderConfirmation({
  number,
  token,
  paymentInstructions,
}: {
  number: number;
  token: string;
  paymentInstructions: string;
}) {
  const { format, customer } = useShop();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    shopApi
      .order(number, token)
      .then(setOrder)
      .catch(() => setError("We couldn't find this order. Check the link, or sign in to see your orders."));
  }, [number, token]);

  if (error) return <Alert>{error}</Alert>;
  if (!order) return <p className="text-muted-foreground">Loading your order…</p>;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-green-700 dark:text-green-400">
          <CheckCircle2 className="size-5" /> Thank you, your order is placed.
        </p>
        <h1 className="text-2xl font-bold">Order #{order.number}</h1>
        <p className="max-w-prose text-muted-foreground">We&apos;ve sent a confirmation to {order.email}.</p>
        {order.status === "PENDING" && paymentInstructions && (
          <p className="max-w-prose whitespace-pre-line rounded-(--radius) bg-muted p-3 text-sm">{paymentInstructions}</p>
        )}
        <p className="text-sm text-muted-foreground">Keep this page&apos;s link to check your order status later.</p>
      </div>
      <OrderDetails order={order} format={(m) => format(m, order.currency)} />
      <div className="flex gap-3">
        <Link href="/" className={buttonClass("secondary")}>
          Continue shopping
        </Link>
        {customer && (
          <Link href="/account" className={buttonClass("secondary")}>
            Your orders
          </Link>
        )}
      </div>
    </div>
  );
}
