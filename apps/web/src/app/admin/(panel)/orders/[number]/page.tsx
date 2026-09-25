"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatMoney, ORDER_TRANSITIONS, type OrderDto, type OrderStatus } from "@ecom/shared";
import { adminApi } from "@/lib/admin-api";
import { useMoney } from "@/lib/use-money";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert, Badge, Card } from "@/components/ui/misc";
import { PageHeader } from "@/components/admin/admin-shell";
import { ADMIN_ORDER_STATUS_LABEL, ADMIN_ORDER_STATUS_TONE, STATUS_ACTION } from "@/components/admin/order-status";
import { OrderTotals } from "@/components/store/order-totals";

const DESTRUCTIVE: OrderStatus[] = ["CANCELLED", "REFUNDED"];

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

  const move = async (status: OrderStatus) => {
    if (DESTRUCTIVE.includes(status) && !confirm(`${STATUS_ACTION[status]} #${order.number}? This can't be undone.`)) return;
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
                    {e.fromStatus ? (
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
                      {pending === s ? "Saving…" : STATUS_ACTION[s]}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </Card>

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
