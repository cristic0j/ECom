import type { OrderStatus } from "@ecom/shared";

export const ADMIN_ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Pending payment",
  PAID: "Paid",
  FULFILLED: "Shipped",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export const ADMIN_ORDER_STATUS_TONE = {
  PENDING: "warning",
  PAID: "accent",
  FULFILLED: "success",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
} as const satisfies Record<OrderStatus, string>;

/** Button text for moving an order to a status. */
export const STATUS_ACTION: Record<OrderStatus, string> = {
  PENDING: "Mark pending",
  PAID: "Mark as paid",
  FULFILLED: "Mark as shipped",
  CANCELLED: "Cancel order",
  REFUNDED: "Mark as refunded",
};
