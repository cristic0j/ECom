"use client";

import Link from "next/link";
import { ShoppingBag, User } from "lucide-react";
import { useShop } from "./shop-provider";

export function ShopHeaderLinks() {
  const { cart, customer } = useShop();
  const count = cart?.itemCount ?? 0;

  return (
    <div className="flex items-center gap-1">
      <Link
        href={customer ? "/account" : "/account/login"}
        className="flex size-9 items-center justify-center rounded-full hover:bg-muted"
        aria-label={customer ? "Your account" : "Sign in"}
      >
        <User className="size-5" />
      </Link>
      <Link
        href="/cart"
        className="relative flex size-9 items-center justify-center rounded-full hover:bg-muted"
        aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}
        data-testid="cart-link"
      >
        <ShoppingBag className="size-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white tabular-nums">
            {count}
          </span>
        )}
      </Link>
    </div>
  );
}
