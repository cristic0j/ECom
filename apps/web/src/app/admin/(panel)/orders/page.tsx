"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { formatMoney, orderStatusSchema, type OrderStatus, type OrderSummaryDto, type Paginated } from "@ecom/shared";
import { adminApi } from "@/lib/admin-api";
import { useMoney } from "@/lib/use-money";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Alert, Badge } from "@/components/ui/misc";
import { PageHeader } from "@/components/admin/admin-shell";
import { ADMIN_ORDER_STATUS_LABEL, ADMIN_ORDER_STATUS_TONE } from "@/components/admin/order-status";

function OrdersTable() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { locale } = useMoney();

  const q = params.get("q") ?? "";
  const status = (params.get("status") as OrderStatus | null) ?? undefined;
  const page = Number(params.get("page") ?? 1) || 1;

  const [data, setData] = useState<Paginated<OrderSummaryDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);

  useEffect(() => {
    adminApi
      .listOrders({ q: q || undefined, status, page, pageSize: 25 })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [q, status, page]);

  const setParam = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in updates)) next.delete("page");
    router.push(`${pathname}?${next}`);
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setParam({ q: search.trim() || undefined });
  };

  return (
    <>
      <PageHeader title="Orders" />

      <div className="mb-4 flex flex-wrap gap-3">
        <form onSubmit={onSearch} className="flex flex-1 gap-2">
          <Input
            aria-label="Search orders"
            placeholder="Order number or customer email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Select
          aria-label="Filter by status"
          value={status ?? ""}
          onChange={(e) => setParam({ status: e.target.value || undefined })}
          className="w-44"
        >
          <option value="">All statuses</option>
          {orderStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {ADMIN_ORDER_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}

      <div className="overflow-x-auto rounded-(--radius) border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Order</th>
              <th className="p-3 font-medium">Date</th>
              <th className="p-3 font-medium">Customer</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 text-right font-medium">Items</th>
              <th className="p-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {!data && !error && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No orders found.
                </td>
              </tr>
            )}
            {data?.items.map((o) => (
              <tr key={o.id} className="border-b border-border last:border-0">
                <td className="p-3">
                  <Link href={`/admin/orders/${o.number}`} className="font-medium hover:underline">
                    #{o.number}
                  </Link>
                </td>
                <td className="p-3 text-muted-foreground">{new Date(o.createdAt).toLocaleString(locale)}</td>
                <td className="p-3">{o.email}</td>
                <td className="p-3">
                  <Badge tone={ADMIN_ORDER_STATUS_TONE[o.status]}>{ADMIN_ORDER_STATUS_LABEL[o.status]}</Badge>
                </td>
                <td className="p-3 text-right tabular-nums">{o.itemCount}</td>
                <td className="p-3 text-right tabular-nums">{formatMoney(o.totalMinor, o.currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>
            Previous
          </Button>
          <span className="px-2 text-muted-foreground">
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= data.totalPages}
            onClick={() => setParam({ page: String(page + 1) })}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersTable />
    </Suspense>
  );
}
