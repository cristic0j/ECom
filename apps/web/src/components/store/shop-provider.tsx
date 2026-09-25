"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatMoney, type CartDto, type CustomerDto } from "@ecom/shared";
import { ApiRequestError } from "@/lib/api-client";
import { shopApi } from "@/lib/shop-api";

interface Shop {
  /** null until the first load finishes */
  cart: CartDto | null;
  /** undefined while loading, null for guests */
  customer: CustomerDto | null | undefined;
  format: (minor: number, currency?: string) => string;
  setCart: (cart: CartDto) => void;
  refreshCart: () => Promise<void>;
  refreshCustomer: () => Promise<void>;
}

const ShopContext = createContext<Shop | null>(null);

/** Cart + signed-in customer for the storefront. Only mounted when `features.cart` is on. */
export function useShop(): Shop {
  const shop = useContext(ShopContext);
  if (!shop) throw new Error("useShop must be used inside <ShopProvider>");
  return shop;
}

/** Same as useShop, but null when the cart feature is off (for components shown either way). */
export function useOptionalShop(): Shop | null {
  return useContext(ShopContext);
}

export function ShopProvider({ currency, locale, children }: { currency: string; locale: string; children: ReactNode }) {
  const [cart, setCart] = useState<CartDto | null>(null);
  const [customer, setCustomer] = useState<CustomerDto | null | undefined>(undefined);

  const refreshCart = useCallback(() => shopApi.cart().then(setCart).catch(() => {}), []);
  const refreshCustomer = useCallback(
    () =>
      shopApi
        .me()
        .then(setCustomer)
        .catch((e) => setCustomer(e instanceof ApiRequestError && e.status === 401 ? null : undefined)),
    [],
  );

  useEffect(() => {
    refreshCart();
    refreshCustomer();
  }, [refreshCart, refreshCustomer]);

  const value = useMemo<Shop>(
    () => ({
      cart,
      customer,
      format: (minor, cur) => formatMoney(minor, cur ?? cart?.currency ?? currency, locale),
      setCart,
      refreshCart,
      refreshCustomer,
    }),
    [cart, customer, currency, locale, refreshCart, refreshCustomer],
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}
