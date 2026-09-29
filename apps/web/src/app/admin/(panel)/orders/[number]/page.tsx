"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatMoney, ORDER_TRANSITIONS, type OrderDto, type OrderStatus, type PaymentDto } from "@ecom/shared";
import { adminApi } from "@/lib/admin-api";
import { useMoney } from "@/lib/use-money";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert, Badge, Card } from "@/components/ui/misc";
import { PageHeader } from "@/components/admin/admin-shell";
import { ADMIN_ORDER_STATUS_LABEL, ADMIN_ORDER_STATUS_TONE, STATUS_ACTION } from "@/components/admin/order-status";
import { OrderTotals } from "@/components/store/order-totals";

const DESTRUCTIVE: OrderStatus[] = ["CANCELLED", "REFUNDED"];

const PAYMENT_LABEL: Record<PaymentDto["status"], string> = {
  PENDING: "Not paid yet",
  SUCCEEDED: "Paid",
  FAILED: "Expired / failed",
  REFUNDED: "Refunded",
};
const PAYMENT_TONE = { PENDING: "warning", SUCCEEDED: "success", FAILED: "neutral", REFUNDED: "neutral" } as const;

/** Stripe dashboard link for a payment (test-mode payments live under /test). */
function stripeUrl(p: PaymentDto): string | null {
  if (p.provider !== "stripe" || !p.chargeRef) return null;
  return `https://dashboard.stripe.com/${p.providerRef.startsWith("cs_test_") ? "test/" : ""}payments/${p.chargeRef}`;
}

export default function AdminOrderPage() {
  const { number } = useParams<{ number: string }>();
  const { locale } = useMoney();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<OrderStatus | null>(null);

  useEffect(() => {
    adminApi
      .getOrder(Number(number))
      .then(setOrder)
      .catch((e) => setError(e.message));
  }, [number]);

  if (!order) return error ? <Alert>{error}</Alert> : <p className="text-muted-foreground">Loading…</p>;

  const format = (minor: number) => formatMoney(minor, order.currency, locale);
  const next = ORDER_TRANSITIONS[order.status];
  const a = order.shippingAddress;
  // With a card payment on file, "refunded" sends the money back through Stripe
  const cardPayment = order.payments?.find((p) => p.status === "SUCCEEDED");
  const actionLabel = (s: OrderStatus) =>
    s === "REFUNDED" && cardPayment ? `Refund ${format(cardPayment.amountMinor)} to the customer` : STATUS_ACTION[s];

  const move = async (status: OrderStatus) => {
    const warning =
      status === "REFUNDED" && cardPayment
        ? `Refund ${format(cardPayment.amountMinor)} to the customer's card for #${order.number}? This can't be undone.`
        : `${STATUS_ACTION[status]} #${order.number}? This can't be undone.`;
    if (DESTRUCTIVE.includes(status) && !confirm(warning)) return;
    setPending(status);
    setError(null);
    try {
      setOrder(await adminApi.setOrderStatus(order.number, status, note));
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <PageHeader title={`Order #${order.number}`} />
      <p className="-mt-4 mb-6 flex items-center gap-3 text-sm text-muted-foreground">
        <Badge tone={ADMIN_ORDER_STATUS_TONE[order.status]} data-testid="admin-order-status">
          {ADMIN_ORDER_STATUS_LABEL[order.status]}
        </Badge>
        Placed {new Date(order.createdAt).toLocaleString(locale)}
      </p>
      {error && <Alert className="mb-4">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="space-y-4">
            <h2 className="font-semibold">Items</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium">SKU</th>
                  <th className="pb-2 text-right font-medium">Price</th>
                  <th className="pb-2 text-right font-medium">Qty</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="py-2">
                      {i.productTitle}
                      {i.variantTitle !== "Default" && <span className="text-muted-foreground"> ({i.variantTitle})</span>}
                    </td>
                    <td className="py-2 text-muted-foreground">{i.sku}</td>
                    <td className="py-2 text-right tabular-nums">{format(i.unitPriceMinor)}</td>
                    <td className="py-2 text-right tabular-nums">{i.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{format(i.lineTotalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ml-auto max-w-xs">
              <OrderTotals {...order} format={format} />
            </div>
          </Card>

          {order.note && (
            <Card className="space-y-2">
              <h2 className="font-semibold">Customer note</h2>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{order.note}</p>
            </Card>
          )}

          <Card className="space-y-3">
            <h2 className="font-semibold">History</h2>
            <ol className="space-y-2 text-sm">
              {order.events?.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-3">
                  <span className="text-muted-foreground tabular-nums">{new Date(e.createdAt).toLocaleString(locale)}</span>
                  <span>
                    {e.fromStatus === e.toStatus ? (
                      <strong>Needs attention</strong>
                    ) : e.fromStatus ? (
                      <>
                        {ADMIN_ORDER_STATUS_LABEL[e.fromStatus]} → <strong>{ADMIN_ORDER_STATUS_LABEL[e.toStatus]}</strong>
                      </>
                    ) : (
                      <>Order placed</>
                    )}{" "}
                    <span className="text-muted-foreground">by {e.actor}</span>
                  </span>
                  {e.note && <span className="w-full text-muted-foreground italic">“{e.note}”</span>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-4">
            <h2 className="font-semibold">Update status</h2>
            {next.length === 0 ? (
              <p className="text-sm text-muted-foreground">This order is closed; no further changes.</p>
            ) : (
              <>
                <Field label="Note (optional)" htmlFor="status-note" hint="e.g. payment reference or tracking number">
                  <Input id="status-note" value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <div className="flex flex-col gap-2">
                  {next.map((s) => (
                    <Button
                      key={s}
                      variant={DESTRUCTIVE.includes(s) ? "secondary" : "primary"}
                      disabled={pending !== null}
                      onClick={() => move(s)}
                    >
                      {pending === s ? "Saving…" : actionLabel(s)}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </Card>

          {order.payments && order.payments.length > 0 && (
            <Card className="space-y-3 text-sm">
              <h2 className="font-semibold">Payments</h2>
              <ul className="space-y-2">
                {order.payments.map((p) => {
                  const url = stripeUrl(p);
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="admin-payment">
                      <span className="tabular-nums">
                        {formatMoney(p.amountMinor, p.currency, locale)}
                        <span className="block text-xs text-muted-foreground">
                          {new Date(p.createdAt).toLocaleString(locale)}
                          {url && (
                            <>
                              {" · "}
                              <a href={url} target="_blank" rel="noreferrer" className="underline">
                                View in Stripe
                              </a>
                            </>
                          )}
                        </span>
                      </span>
                      <Badge tone={PAYMENT_TONE[p.status]}>{PAYMENT_LABEL[p.status]}</Badge>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card className="space-y-2 text-sm">
            <h2 className="font-semibold">Customer</h2>
            <p>
              <a href={`mailto:${order.email}`} className="underline">
                {order.email}
              </a>
            </p>
            <p className="text-muted-foreground">{order.customerId ? "Has an account" : "Guest checkout"}</p>
          </Card>

          <Card className="space-y-2 text-sm">
            <h2 className="font-semibold">Shipping address</h2>
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
          </Card>

          <Link href="/admin/orders" className="block text-sm text-muted-foreground hover:text-foreground">
            ← All orders
          </Link>
        </div>
      </div>
    </>
  );
}
