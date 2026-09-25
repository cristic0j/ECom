import { canTransition, computeTotals, ORDER_TRANSITIONS, type OrderStatus } from "@ecom/shared";

describe("computeTotals", () => {
  const rules = { flatRateMinor: 499, freeOverMinor: 5000 };

  it("adds flat-rate shipping below the free-shipping threshold", () => {
    expect(computeTotals([{ unitPriceMinor: 1999, quantity: 2 }], rules)).toEqual({
      subtotalMinor: 3998,
      shippingMinor: 499,
      totalMinor: 4497,
    });
  });

  it("ships free at exactly the threshold", () => {
    expect(computeTotals([{ unitPriceMinor: 2500, quantity: 2 }], rules).shippingMinor).toBe(0);
  });

  it("never ships free when the threshold is null", () => {
    expect(computeTotals([{ unitPriceMinor: 100000, quantity: 1 }], { ...rules, freeOverMinor: null }).shippingMinor).toBe(499);
  });

  it("charges nothing for an empty cart", () => {
    expect(computeTotals([], rules)).toEqual({ subtotalMinor: 0, shippingMinor: 0, totalMinor: 0 });
  });
});

describe("order status transitions", () => {
  it.each<[OrderStatus, OrderStatus]>([
    ["PENDING", "PAID"],
    ["PENDING", "CANCELLED"],
    ["PAID", "FULFILLED"],
    ["PAID", "REFUNDED"],
    ["FULFILLED", "REFUNDED"],
  ])("allows %s → %s", (from, to) => expect(canTransition(from, to)).toBe(true));

  it.each<[OrderStatus, OrderStatus]>([
    ["PENDING", "FULFILLED"],
    ["CANCELLED", "PAID"],
    ["REFUNDED", "PAID"],
    ["FULFILLED", "PENDING"],
    ["PAID", "PAID"],
  ])("rejects %s → %s", (from, to) => expect(canTransition(from, to)).toBe(false));

  it("treats cancelled and refunded as final", () => {
    expect(ORDER_TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(ORDER_TRANSITIONS.REFUNDED).toHaveLength(0);
  });
});
