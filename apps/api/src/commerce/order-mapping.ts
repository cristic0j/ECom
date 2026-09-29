import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@ecom/db";
import { addressSchema, canTransition, type Address, type OrderDto, type OrderStatus, type OrderSummaryDto } from "@ecom/shared";

/** Shared by OrdersService and PaymentsService. */
export const orderDetailInclude = {
  items: { orderBy: { id: "asc" } },
  events: { orderBy: { createdAt: "asc" } },
  payments: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.OrderInclude;
export const orderSummaryInclude = { items: { select: { quantity: true } } } satisfies Prisma.OrderInclude;

export type OrderDetail = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;
type OrderSummary = Prisma.OrderGetPayload<{ include: typeof orderSummaryInclude }>;

/**
 * Moves an order along ORDER_TRANSITIONS inside a transaction and records who did it.
 * Guarded on the old status, so two concurrent changes (two admins, or an admin and a
 * payment webhook) can't both apply.
 */
export async function transitionOrder(
  tx: Prisma.TransactionClient,
  order: { id: string; status: OrderStatus },
  status: OrderStatus,
  actor: string,
  note = "",
): Promise<void> {
  assertTransition(order.status, status);
  const { count } = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status } });
  if (count === 0) throw new ConflictException("The order was changed by someone else. Reload and try again.");
  await tx.orderEvent.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: status, actor, note } });
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(`A ${from.toLowerCase()} order can't be marked ${to.toLowerCase()}`);
  }
}

export function toOrderSummaryDto(o: OrderSummary | OrderDetail): OrderSummaryDto {
  return {
    id: o.id,
    number: o.number,
    email: o.email,
    status: o.status,
    currency: o.currency,
    totalMinor: o.totalMinor,
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    createdAt: o.createdAt.toISOString(),
  };
}

/** `admin` adds the status history and payment attempts, which customers don't see. */
export function toOrderDto(o: OrderDetail, { admin }: { admin: boolean }): OrderDto {
  const address = addressSchema.safeParse(o.shippingAddress);
  return {
    ...toOrderSummaryDto(o),
    customerId: o.customerId,
    subtotalMinor: o.subtotalMinor,
    shippingMinor: o.shippingMinor,
    shippingAddress: address.success ? address.data : (o.shippingAddress as unknown as Address),
    note: o.note,
    items: o.items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productTitle: i.productTitle,
      variantTitle: i.variantTitle,
      sku: i.sku,
      unitPriceMinor: i.unitPriceMinor,
      quantity: i.quantity,
      lineTotalMinor: i.lineTotalMinor,
    })),
    ...(admin && {
      events: o.events.map((e) => ({
        id: e.id,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actor: e.actor,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
      payments: o.payments.map((p) => ({
        id: p.id,
        provider: p.provider,
        providerRef: p.providerRef,
        chargeRef: p.chargeRef,
        amountMinor: p.amountMinor,
        currency: p.currency,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
    }),
  };
}
