"use client";

import Link from "next/link";
import { useState } from "react";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import type { CartDto } from "@ecom/shared";
import { shopApi } from "@/lib/shop-api";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { useOptionalShop } from "./shop-provider";

const MAX_QUANTITY = 99;

/**
 * "Add to cart" until the selected variant is in the cart, then a − / + quantity stepper
 * (− at 1 removes the line). Renders nothing when the cart feature is off.
 */
export function AddToCart({ variantId, inStock }: { variantId: string | undefined; inStock: boolean }) {
  const shop = useOptionalShop();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!shop) return null;

  const line = variantId ? shop.cart?.items.find((i) => i.variantId === variantId) : undefined;

  // One request at a time, so rapid clicks can't stack up extra items
  const run = async (call: () => Promise<CartDto>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      shop.setCart(await call());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update your cart");
    } finally {
      setPending(false);
    }
  };

  if (variantId && !inStock) {
    return (
      <div className="space-y-3">
        <Button size="lg" className="w-full sm:w-auto" disabled>
          Out of stock
        </Button>
        <p className="text-sm text-muted-foreground">
          {line ? "This is in your cart, but it's out of stock right now. Remove it from your cart to check out." : "This option is out of stock right now."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {line ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center rounded-(--radius) border border-border">
            <Button
              variant="ghost"
              size="lg"
              aria-label={line.quantity <= 1 ? "Remove from cart" : "Decrease quantity"}
              disabled={pending}
              onClick={() =>
                run(() => (line.quantity <= 1 ? shopApi.removeItem(line.id) : shopApi.setQuantity(line.id, line.quantity - 1)))
              }
            >
              <Minus className="size-5" />
            </Button>
            <span className="w-10 text-center font-medium tabular-nums" data-testid="product-quantity" aria-live="polite">
              {line.quantity}
            </span>
            <Button
              variant="ghost"
              size="lg"
              aria-label="Increase quantity"
              disabled={pending || line.quantity >= MAX_QUANTITY}
              onClick={() => run(() => shopApi.setQuantity(line.id, line.quantity + 1))}
            >
              <Plus className="size-5" />
            </Button>
          </div>
          <p role="status" className="text-sm">
            In your cart ·{" "}
            <Link href="/cart" className="font-medium underline">
              View cart and check out
            </Link>
          </p>
        </div>
      ) : (
        <Button
          size="lg"
          className="w-full sm:w-auto"
          onClick={() => variantId && run(() => shopApi.addToCart(variantId))}
          disabled={!variantId || !shop.cart || pending}
        >
          <ShoppingBag className="size-5" />
          {pending ? "Adding…" : "Add to cart"}
        </Button>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
