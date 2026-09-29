"use client";

import type { OrderDto, OrderStatus } from "@ecom/shared";
import { Badge, Card } from "@/components/ui/misc";
import { OrderTotals } from "./order-totals";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Awaiting payment",
  PAID: "Paid",
  FULFILLED: "Shipped",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export const ORDER_STATUS_TONE = {
  PENDING: "warning",
  PAID: "accent",
  FULFILLED: "success",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
} as const;

/** Line items, totals and address of an order (customer-facing). */
export function OrderDetails({ order, format }: { order: OrderDto; format: (minor: number) => string }) {
  const a = order.shippingAddress;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Items</h2>
          <Badge tone={ORDER_STATUS_TONE[order.status]} data-testid="order-status">
            {ORDER_STATUS_LABEL[order.status]}
          </Badge>
        </div>
        <ul className="divide-y divide-border text-sm">
          {order.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-4 py-2">
              <span>
                {i.quantity} × {i.productTitle}
                {i.variantTitle !== "Default" && <span className="text-muted-foreground"> ({i.variantTitle})</span>}
                <span className="block text-xs text-muted-foreground">SKU {i.sku}</span>
              </span>
              <span className="tabular-nums">{format(i.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        <OrderTotals {...order} format={format} />
      </Card>
      <div className="space-y-6">
        {(order.trackingNumber || order.trackingUrl) && (
          <Card className="space-y-2 text-sm" data-testid="order-tracking">
            <h2 className="font-semibold">Tracking</h2>
            {order.trackingNumber && <p className="tabular-nums">{order.trackingNumber}</p>}
            {order.trackingUrl && (
              <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                Track your package
              </a>
            )}
          </Card>
        )}
        <Card className="h-fit space-y-2 text-sm">
          <h2 className="font-semibold">Shipping to</h2>
          <address className="not-italic text-muted-foreground">
            {a.name}
            <br />
            {a.line1}
            {a.line2 && (
              <>
                <br />
                {a.line2}
              </>
            )}
            <br />
            {a.postalCode} {a.city}
            <br />
            {a.country}
            {a.phone && (
              <>
                <br />
                {a.phone}
              </>
            )}
          </address>
          <p className="pt-2 text-muted-foreground">Contact: {order.email}</p>
        </Card>
      </div>
    </div>
  );
}
