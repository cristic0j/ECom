"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { StoreSettings } from "@ecom/shared";
import { storeConfig } from "@store-config";
import { adminApi } from "@/lib/admin-api";
import { minorToInput, parseMoneyToMinor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/misc";
import { PageHeader, useAdmin } from "@/components/admin/admin-shell";
import { AliExpressConnection } from "@/components/admin/aliexpress-connection";
import { revalidateStorefront } from "../../actions";

const defaults = {
  name: storeConfig.name,
  tagline: storeConfig.tagline,
  logoUrl: storeConfig.logoUrl,
  currency: storeConfig.currency,
  locale: storeConfig.locale,
  primary: storeConfig.theme.primary,
  primaryForeground: storeConfig.theme.primaryForeground,
  accent: storeConfig.theme.accent,
  radius: storeConfig.theme.radius,
  shippingFlat: minorToInput(storeConfig.shipping.flatRateMinor),
  shippingFreeOver: minorToInput(storeConfig.shipping.freeOverMinor),
  paymentInstructions: storeConfig.paymentInstructions,
};
type Form = Record<keyof typeof defaults, string>;

const THEME_FIELDS: [keyof Form, string, string][] = [
  ["primary", "Primary color", 'HSL, e.g. "222 47% 11%"'],
  ["primaryForeground", "Text on primary", "HSL"],
  ["accent", "Accent color", "HSL, used for sale badges"],
  ["radius", "Corner radius", 'e.g. "0.5rem"'],
];

export default function SettingsPage() {
  const admin = useAdmin();
  const [form, setForm] = useState<Form>(defaults);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const readOnly = admin.role !== "ADMIN";

  useEffect(() => {
    adminApi
      .getSettings()
      .then((s) =>
        setForm((f) => ({
          ...f,
          ...Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === "string")),
          ...s.theme,
          ...(s.shipping?.flatRateMinor !== undefined && { shippingFlat: minorToInput(s.shipping.flatRateMinor) }),
          ...(s.shipping?.freeOverMinor !== undefined && { shippingFreeOver: minorToInput(s.shipping.freeOverMinor) }),
        })),
      )
      .catch((e) => setError(e.message));
  }, []);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const flatRateMinor = parseMoneyToMinor(form.shippingFlat);
    const freeOverMinor = form.shippingFreeOver.trim() ? parseMoneyToMinor(form.shippingFreeOver) : null;
    if (Number.isNaN(flatRateMinor) || Number.isNaN(freeOverMinor)) {
      setError("Enter shipping amounts like 4.99 (leave the free-shipping threshold empty to never ship free).");
      return;
    }
    const patch: StoreSettings = {
      name: form.name,
      tagline: form.tagline,
      logoUrl: form.logoUrl,
      currency: form.currency,
      locale: form.locale,
      theme: { primary: form.primary, primaryForeground: form.primaryForeground, accent: form.accent, radius: form.radius },
      shipping: { flatRateMinor, freeOverMinor },
      paymentInstructions: form.paymentInstructions,
    };
    try {
      await adminApi.updateSettings(patch);
      await revalidateStorefront("settings");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <>
      <form onSubmit={onSubmit}>
        <PageHeader
          title="Store settings"
          actions={
            !readOnly && (
              <Button type="submit">Save</Button>
            )
          }
        />
        {readOnly && <Alert className="mb-4">Only admins can change store settings.</Alert>}
        {error && <Alert className="mb-4">{error}</Alert>}
        {saved && (
          <p role="status" className="mb-4 text-sm text-green-700 dark:text-green-400">
            Settings saved.
          </p>
        )}
        <fieldset disabled={readOnly} className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4">
            <h2 className="font-semibold">General</h2>
            <Field label="Store name" htmlFor="name">
              <Input id="name" value={form.name} onChange={set("name")} required />
            </Field>
            <Field label="Tagline" htmlFor="tagline">
              <Input id="tagline" value={form.tagline} onChange={set("tagline")} />
            </Field>
            <Field label="Logo URL" htmlFor="logoUrl">
              <Input id="logoUrl" value={form.logoUrl} onChange={set("logoUrl")} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Currency" htmlFor="currency" hint="ISO code, e.g. EUR">
                <Input id="currency" value={form.currency} onChange={set("currency")} maxLength={3} />
              </Field>
              <Field label="Locale" htmlFor="locale" hint="e.g. en-US, de-DE">
                <Input id="locale" value={form.locale} onChange={set("locale")} />
              </Field>
            </div>
          </Card>
          <Card className="space-y-4">
            <h2 className="font-semibold">Theme</h2>
            {THEME_FIELDS.map(([key, label, hint]) => (
              <Field key={key} label={label} htmlFor={key} hint={hint}>
                <div className="flex items-center gap-3">
                  {key !== "radius" && (
                    <span
                      aria-hidden
                      className="size-10 shrink-0 rounded-(--radius) border border-border"
                      style={{ background: `hsl(${form[key]})` }}
                    />
                  )}
                  <Input id={key} value={form[key]} onChange={set(key)} />
                </div>
              </Field>
            ))}
          </Card>
          <Card className="space-y-4">
            <h2 className="font-semibold">Shipping</h2>
            <p className="text-sm text-muted-foreground">Prices include tax. Shipping is added to the order total at checkout.</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Flat shipping rate" htmlFor="shippingFlat" hint="e.g. 4.99; 0 for always free">
                <Input id="shippingFlat" inputMode="decimal" value={form.shippingFlat} onChange={set("shippingFlat")} />
              </Field>
              <Field label="Free shipping from" htmlFor="shippingFreeOver" hint="Order subtotal; empty = never free">
                <Input
                  id="shippingFreeOver"
                  inputMode="decimal"
                  value={form.shippingFreeOver}
                  onChange={set("shippingFreeOver")}
                />
              </Field>
            </div>
          </Card>
          <Card className="space-y-4">
            <h2 className="font-semibold">Payment</h2>
            <Field
              label="Payment instructions"
              htmlFor="paymentInstructions"
              hint="Shown at checkout, on the order page and in the order confirmation email, e.g. your bank details."
            >
              <Textarea
                id="paymentInstructions"
                rows={4}
                maxLength={2000}
                value={form.paymentInstructions}
                onChange={set("paymentInstructions")}
              />
            </Field>
          </Card>
        </fieldset>
      </form>
      {!readOnly && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <AliExpressConnection />
        </div>
      )}
    </>
  );
}
