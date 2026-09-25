"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ShoppingBag } from "lucide-react";
import { shopApi } from "@/lib/shop-api";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { useOptionalShop } from "./shop-provider";

/** Renders nothing when the cart feature is off. */
export function AddToCart({ variantId }: { variantId: string | undefined }) {
  const shop = useOptionalShop();
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!shop) return null;

  const add = async () => {
    if (!variantId) return;
    setPending(true);
    setError(null);
    try {
      shop.setCart(await shopApi.addToCart(variantId));
      setAdded(variantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add to cart");
    } finally {
      setPending(false);
    }
  };

  const justAdded = added !== null && added === variantId;

  return (
    <div className="space-y-3">
      <Button size="lg" className="w-full sm:w-auto" onClick={add} disabled={!variantId || pending}>
        {justAdded ? <Check className="size-5" /> : <ShoppingBag className="size-5" />}
        {pending ? "Adding…" : justAdded ? "Added to cart" : "Add to cart"}
      </Button>
      {justAdded && (
        <p role="status" className="text-sm">
          <Link href="/cart" className="font-medium underline">
            View cart and check out
          </Link>
        </p>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
