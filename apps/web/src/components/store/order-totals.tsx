import type { ReactNode } from "react";

/** Subtotal / shipping / total block used by the cart, checkout and order pages. */
export function OrderTotals({
  subtotalMinor,
  shippingMinor,
  totalMinor,
  format,
  children,
}: {
  subtotalMinor: number;
  shippingMinor: number;
  totalMinor: number;
  format: (minor: number) => string;
  children?: ReactNode;
}) {
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="tabular-nums">{format(subtotalMinor)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Shipping</dt>
        <dd className="tabular-nums">{shippingMinor === 0 ? "Free" : format(shippingMinor)}</dd>
      </div>
      {children}
      <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
        <dt>Total</dt>
        <dd className="tabular-nums" data-testid="order-total">
          {format(totalMinor)}
        </dd>
      </div>
      <p className="text-xs text-muted-foreground">Prices include tax.</p>
    </dl>
  );
}
