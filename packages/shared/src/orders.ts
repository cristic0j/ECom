import type { OrderStatus } from "./schemas";

export interface ShippingRules {
  flatRateMinor: number;
  /** Subtotal at or above which shipping is free; null = never free */
  freeOverMinor: number | null;
  /** Countries the store delivers to (ISO alpha-2) */
  countries: string[];
}

export interface Totals {
  subtotalMinor: number;
  shippingMinor: number;
  totalMinor: number;
}

/** Prices include tax, so the total is subtotal + shipping. An empty cart costs nothing. */
export function computeTotals(
  lines: { unitPriceMinor: number; quantity: number }[],
  rules: Pick<ShippingRules, "flatRateMinor" | "freeOverMinor">,
): Totals {
  const subtotalMinor = lines.reduce((sum, l) => sum + l.unitPriceMinor * l.quantity, 0);
  const freeShipping = subtotalMinor === 0 || (rules.freeOverMinor !== null && subtotalMinor >= rules.freeOverMinor);
  const shippingMinor = freeShipping ? 0 : rules.flatRateMinor;
  return { subtotalMinor, shippingMinor, totalMinor: subtotalMinor + shippingMinor };
}

/**
 * Allowed status changes. PAID is set by hand for now (manual payment: bank transfer, cash on delivery);
 * from Phase 3 the payment webhook sets it.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["PAID", "CANCELLED"],
  PAID: ["FULFILLED", "REFUNDED"],
  FULFILLED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
