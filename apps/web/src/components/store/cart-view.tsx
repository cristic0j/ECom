"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import type { CartItemDto } from "@ecom/shared";
import { shopApi } from "@/lib/shop-api";
import { cn } from "@/lib/utils";
import { buttonClass, Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/misc";
import { useShop } from "./shop-provider";
import { OrderTotals } from "./order-totals";

const MAX_QUANTITY = 99;

export function CartView() {
  const { cart, setCart, format } = useShop();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!cart) return <p className="text-muted-foreground">Loading your cart…</p>;

  if (cart.items.length === 0) {
    return (
      <div className="space-y-4 py-12 text-center">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <Link href="/" className={buttonClass()}>
          Continue shopping
        </Link>
      </div>
    );
  }

  const change = async (item: CartItemDto, quantity: number) => {
    setBusy(item.id);
    setError(null);
    try {
      setCart(quantity === 0 ? await shopApi.removeItem(item.id) : await shopApi.setQuantity(item.id, quantity));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update your cart");
    } finally {
      setBusy(null);
    }
  };

  const toFreeShipping =
    cart.freeShippingOverMinor !== null && cart.shippingMinor > 0 ? cart.freeShippingOverMinor - cart.subtotalMinor : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Your cart</h1>
        {error && <Alert>{error}</Alert>}
        <ul className="divide-y divide-border rounded-(--radius) border border-border">
          {cart.items.map((item) => (
            <li key={item.id} className="flex gap-4 p-4" data-testid="cart-line">
              <Link href={`/p/${item.productSlug}`} className="relative size-20 shrink-0 overflow-hidden rounded-(--radius) bg-muted">
                {item.image && <Image src={item.image.url} alt={item.image.alt} fill sizes="80px" className="object-cover" />}
              </Link>
              <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link href={`/p/${item.productSlug}`} className="font-medium hover:underline">
                    {item.productTitle}
                  </Link>
                  {item.variantTitle !== "Default" && <p className="text-sm text-muted-foreground">{item.variantTitle}</p>}
                  <p className="text-sm text-muted-foreground tabular-nums">{format(item.unitPriceMinor)} each</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center rounded-(--radius) border border-border">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Decrease quantity of ${item.productTitle}`}
                      disabled={busy === item.id || item.quantity <= 1}
                      onClick={() => change(item, item.quantity - 1)}
                    >
                      <Minus className="size-4" />
                    </Button>
                    <span className="w-8 text-center text-sm tabular-nums" data-testid="line-quantity">
                      {item.quantity}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Increase quantity of ${item.productTitle}`}
                      disabled={busy === item.id || item.quantity >= MAX_QUANTITY}
                      onClick={() => change(item, item.quantity + 1)}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  <span className="w-24 text-right font-medium tabular-nums">{format(item.lineTotalMinor)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${item.productTitle}`}
                    disabled={busy === item.id}
                    onClick={() => change(item, 0)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Card className="h-fit space-y-4">
        <h2 className="font-semibold">Summary</h2>
        <OrderTotals {...cart} format={(m) => format(m)} />
        {toFreeShipping !== null && toFreeShipping > 0 && (
          <p className="text-sm text-muted-foreground">Add {format(toFreeShipping)} more for free shipping.</p>
        )}
        <Link href="/checkout" className={cn(buttonClass("primary", "lg"), "w-full")}>
          Check out
        </Link>
      </Card>
    </div>
  );
}
