"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { checkoutSchema } from "@ecom/shared";
import { shopApi } from "@/lib/shop-api";
import { buttonClass, Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/misc";
import { useShop } from "./shop-provider";
import { OrderTotals } from "./order-totals";

const ADDRESS_FIELDS = [
  ["name", "Full name", "name"],
  ["line1", "Address", "address-line1"],
  ["line2", "Apartment, suite, etc. (optional)", "address-line2"],
  ["city", "City", "address-level2"],
  ["postalCode", "Postal code", "postal-code"],
  ["country", "Country code (e.g. DE)", "country"],
  ["phone", "Phone (optional)", "tel"],
] as const;

type AddressField = (typeof ADDRESS_FIELDS)[number][0];

export function CheckoutForm({
  defaultCountry,
  paymentInstructions,
}: {
  defaultCountry: string;
  paymentInstructions: string;
}) {
  const router = useRouter();
  const { cart, customer, format, refreshCart } = useShop();
  // null = not edited yet, so a signed-in customer's email and name show as the default
  const [emailInput, setEmailInput] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState<string | null>(null);
  const [rest, setRest] = useState<Record<Exclude<AddressField, "name">, string>>({
    line1: "",
    line2: "",
    city: "",
    postalCode: "",
    country: defaultCountry,
    phone: "",
  });
  const [note, setNote] = useState("");
  const email = emailInput ?? customer?.email ?? "";
  const address: Record<AddressField, string> = { ...rest, name: nameInput ?? customer?.name ?? "" };
  const setField = (key: AddressField, value: string) =>
    key === "name" ? setNameInput(value) : setRest((r) => ({ ...r, [key]: value }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  if (!cart) return <p className="text-muted-foreground">Loading…</p>;
  if (cart.items.length === 0 && !placing) {
    return (
      <div className="space-y-4 py-12 text-center">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <Link href="/" className={buttonClass()}>
          Continue shopping
        </Link>
      </div>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    // Same schema the API validates with, so errors show up next to the right field
    const parsed = checkoutSchema.safeParse({ email, shippingAddress: address, note });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[issue.path.at(-1) as string] ??= issue.message;
      setErrors(errs);
      setFormError("Please check the highlighted fields.");
      return;
    }
    setErrors({});
    setPlacing(true);
    try {
      const { number, accessToken } = await shopApi.checkout(parsed.data);
      router.push(`/order/${number}?token=${encodeURIComponent(accessToken)}`);
      await refreshCart();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't place your order");
      setPlacing(false);
      await refreshCart();
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Checkout</h1>
        {formError && <Alert>{formError}</Alert>}

        <Card className="space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-semibold">Contact</h2>
            {customer === null && (
              <p className="text-sm text-muted-foreground">
                Have an account?{" "}
                <Link href="/account/login?next=/checkout" className="underline">
                  Sign in
                </Link>
              </p>
            )}
          </div>
          <Field label="Email" htmlFor="email" error={errors.email} hint="We'll use this to contact you about your order.">
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmailInput(e.target.value)} />
          </Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">Shipping address</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {ADDRESS_FIELDS.map(([key, label, autoComplete]) => (
              <div key={key} className={key === "line1" || key === "line2" || key === "name" ? "sm:col-span-2" : undefined}>
                <Field label={label} htmlFor={`addr-${key}`} error={errors[key]}>
                  <Input
                    id={`addr-${key}`}
                    autoComplete={autoComplete}
                    value={address[key]}
                    maxLength={key === "country" ? 2 : undefined}
                    onChange={(e) => setField(key, e.target.value)}
                  />
                </Field>
              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-4">
          <Field label="Order note (optional)" htmlFor="note" error={errors.note}>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </Field>
        </Card>
      </div>

      <Card className="h-fit space-y-4">
        <h2 className="font-semibold">Order summary</h2>
        <ul className="space-y-2 text-sm">
          {cart.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-4">
              <span>
                {i.quantity} × {i.productTitle}
                {i.variantTitle !== "Default" && <span className="text-muted-foreground"> ({i.variantTitle})</span>}
              </span>
              <span className="tabular-nums">{format(i.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        <OrderTotals {...cart} format={(m) => format(m)} />
        {paymentInstructions && (
          <div className="whitespace-pre-line rounded-(--radius) bg-muted p-3 text-sm text-muted-foreground">
            <strong className="text-foreground">Payment:</strong> {paymentInstructions}
          </div>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={placing}>
          {placing ? "Placing order…" : "Place order"}
        </Button>
      </Card>
    </form>
  );
}
