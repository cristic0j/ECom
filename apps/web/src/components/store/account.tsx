"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { customerRegisterSchema, type OrderDto, type OrderSummaryDto } from "@ecom/shared";
import { ApiRequestError } from "@/lib/api-client";
import { shopApi } from "@/lib/shop-api";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert, Badge, Card } from "@/components/ui/misc";
import { useShop } from "./shop-provider";
import { OrderDetails, ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "./order-details";

/** Only same-site paths, so ?next= can't send people to another domain. */
export function safeNext(next: string | undefined, fallback = "/account"): string {
  // Browsers read "/\" like "//", so a backslash after the first slash would also leave the site
  return next && /^\/(?![/\\])/.test(next) ? next : fallback;
}

export function AuthForm({ mode, next }: { mode: "login" | "register"; next?: string }) {
  const router = useRouter();
  const { refreshCart, refreshCustomer } = useShop();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isRegister = mode === "register";
  const target = safeNext(next);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setErrors({});
    if (isRegister) {
      const parsed = customerRegisterSchema.safeParse({ name, email, password });
      if (!parsed.success) {
        const errs: Record<string, string> = {};
        for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
        setErrors(errs);
        return;
      }
    }
    setPending(true);
    try {
      if (isRegister) await shopApi.register({ name, email, password });
      else await shopApi.login(email, password);
      // The API merged any guest cart into the account
      await Promise.all([refreshCustomer(), refreshCart()]);
      router.replace(target);
    } catch (err) {
      setFormError(
        err instanceof ApiRequestError && err.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : err instanceof Error
            ? err.message
            : "Something went wrong",
      );
      setPending(false);
    }
  };

  const other = isRegister ? "/account/login" : "/account/register";
  const otherHref = next ? `${other}?next=${encodeURIComponent(target)}` : other;

  return (
    <Card className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">{isRegister ? "Create an account" : "Sign in"}</h1>
      {formError && <Alert>{formError}</Alert>}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {isRegister && (
          <Field label="Name" htmlFor="name" error={errors.name}>
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          error={errors.password}
          hint={isRegister ? "At least 8 characters." : undefined}
        >
          <Input
            id="password"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {isRegister ? "Already have an account? " : "New here? "}
        <Link href={otherHref} className="underline">
          {isRegister ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </Card>
  );
}

/** Sends guests to the login page; renders children once a customer is signed in. */
function useRequireCustomer(path: string) {
  const router = useRouter();
  const { customer } = useShop();
  useEffect(() => {
    if (customer === null) router.replace(`/account/login?next=${encodeURIComponent(path)}`);
  }, [customer, router, path]);
  return customer;
}

export function AccountHome() {
  const router = useRouter();
  const customer = useRequireCustomer("/account");
  const { format, refreshCart, refreshCustomer } = useShop();
  const [orders, setOrders] = useState<OrderSummaryDto[] | null>(null);

  useEffect(() => {
    if (customer) shopApi.myOrders().then(setOrders).catch(() => setOrders([]));
  }, [customer]);

  if (!customer) return <p className="text-muted-foreground">Loading…</p>;

  const logout = async () => {
    await shopApi.logout().catch(() => {});
    await Promise.all([refreshCustomer(), refreshCart()]);
    router.replace("/");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Your account</h1>
          <p className="text-muted-foreground">
            {customer.name ? `${customer.name} · ` : ""}
            {customer.email}
          </p>
        </div>
        <Button variant="secondary" onClick={logout}>
          Sign out
        </Button>
      </div>

      <Card className="space-y-4">
        <h2 className="font-semibold">Orders</h2>
        {!orders && <p className="text-sm text-muted-foreground">Loading…</p>}
        {orders?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No orders yet.{" "}
            <Link href="/" className="underline">
              Start shopping
            </Link>
          </p>
        )}
        {orders && orders.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/account/orders/${o.number}`} className="flex items-center justify-between gap-4 py-3 hover:underline">
                  <span className="font-medium">#{o.number}</span>
                  <span className="text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()}</span>
                  <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                  <span className="tabular-nums">{format(o.totalMinor, o.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function AccountOrder({ number }: { number: number }) {
  const customer = useRequireCustomer(`/account/orders/${number}`);
  const { format } = useShop();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customer) shopApi.myOrder(number).then(setOrder).catch((e) => setError(e.message));
  }, [customer, number]);

  if (error) return <Alert>{error}</Alert>;
  if (!order) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/account" className="text-sm text-muted-foreground hover:text-foreground">
          ← Your account
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Order #{order.number}</h1>
        <p className="text-muted-foreground">Placed {new Date(order.createdAt).toLocaleString()}</p>
      </div>
      <OrderDetails order={order} format={(m) => format(m, order.currency)} />
      <Link href="/" className={buttonClass("secondary")}>
        Continue shopping
      </Link>
    </div>
  );
}
