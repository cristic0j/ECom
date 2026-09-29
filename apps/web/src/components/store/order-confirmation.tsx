"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { OrderDto } from "@ecom/shared";
import { shopApi } from "@/lib/shop-api";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { useShop } from "./shop-provider";
import { OrderDetails } from "./order-details";
import { PayNow } from "./pay-now";

/** After returning from the payment page, how long to wait for the payment webhook. */
const CONFIRM_POLL_MS = 2_000;
const CONFIRM_POLL_TRIES = 15;

export function OrderConfirmation({
  number,
  token,
  paymentInstructions,
  cardPayments,
  returnedFromPayment,
}: {
  number: number;
  token: string;
  paymentInstructions: string;
  cardPayments: boolean;
  returnedFromPayment: boolean;
}) {
  const { format, customer } = useShop();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The order only becomes PAID when the payment provider tells the API, a few seconds after the
  // customer is sent back here, so keep checking for a little while
  const [confirming, setConfirming] = useState(cardPayments && returnedFromPayment);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      shopApi
        .order(number, token)
        .then((o) => {
          if (cancelled) return;
          setOrder(o);
          if (o.status === "PENDING" && cardPayments && returnedFromPayment && ++tries < CONFIRM_POLL_TRIES) {
            timer = setTimeout(load, CONFIRM_POLL_MS);
          } else {
            setConfirming(false);
          }
        })
        .catch(() => {
          if (!cancelled) setError("We couldn't find this order. Check the link, or sign in to see your orders.");
        });
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [number, token, cardPayments, returnedFromPayment]);

  if (error) return <Alert>{error}</Alert>;
  if (!order) return <p className="text-muted-foreground">Loading your order…</p>;

  const unpaid = order.status === "PENDING";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {cardPayments && unpaid ? (
          confirming ? (
            <p role="status" className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" /> Confirming your payment…
            </p>
          ) : (
            <p className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <Clock className="size-5" /> Your order is saved, but it isn&apos;t paid yet.
            </p>
          )
        ) : (
          <p className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <CheckCircle2 className="size-5" />
            {cardPayments && order.status === "PAID" ? "Thank you, your payment was received." : "Thank you, your order is placed."}
          </p>
        )}
        <h1 className="text-2xl font-bold">Order #{order.number}</h1>
        <p className="max-w-prose text-muted-foreground">We&apos;ve sent a confirmation to {order.email}.</p>
        {unpaid && !cardPayments && paymentInstructions && (
          <p className="max-w-prose whitespace-pre-line rounded-(--radius) bg-muted p-3 text-sm">{paymentInstructions}</p>
        )}
        {unpaid && cardPayments && !confirming && (
          <div className="space-y-2 pt-2">
            {returnedFromPayment && (
              <p className="max-w-prose text-sm text-muted-foreground">
                If you completed the payment, it can take a minute to confirm. Refresh this page shortly before paying again.
              </p>
            )}
            <PayNow number={order.number} token={token} />
          </div>
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
