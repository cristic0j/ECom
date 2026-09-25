"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@ecom/shared";
import { storeConfig } from "@store-config";
import { adminApi } from "./admin-api";

/** Client-side money formatter honoring the store's currency/locale (config + admin overrides). */
export function useMoney() {
  const [fmt, setFmt] = useState({ currency: storeConfig.currency as string, locale: storeConfig.locale as string });

  useEffect(() => {
    adminApi
      .getSettings()
      .then((s) => setFmt((f) => ({ currency: s.currency ?? f.currency, locale: s.locale ?? f.locale })))
      .catch(() => {});
  }, []);

  return { ...fmt, format: (minor: number) => formatMoney(minor, fmt.currency, fmt.locale) };
}
