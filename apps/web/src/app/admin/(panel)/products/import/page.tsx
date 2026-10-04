"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import type { SupplierConnectionDto } from "@ecom/shared";
import { storeConfig } from "@store-config";
import { adminApi } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/misc";
import { PageHeader, useAdmin } from "@/components/admin/admin-shell";
import { AliExpressSearch } from "@/components/admin/aliexpress-search";

export default function ImportProductPage() {
  const router = useRouter();
  const admin = useAdmin();
  const [status, setStatus] = useState<SupplierConnectionDto | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([adminApi.aliexpressStatus(), adminApi.getSettings()])
      .then(([s, settings]) => {
        setStatus(s);
        setCountries(settings.shipping?.countries ?? storeConfig.shipping.countries);
      })
      .catch((e) => setError(e.message));
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const product = await adminApi.aliexpressImport(link.trim());
      router.push(`/admin/products/${product.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setBusy(false);
    }
  };

  if (admin.role !== "ADMIN") return <Alert>Only admins can import products.</Alert>;

  if (!status || !status.connected) {
    return (
      <>
        <PageHeader title="Import from AliExpress" />
        <Card className="max-w-2xl">
          {!status ? (
            error ? <Alert>{error}</Alert> : <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Alert>
              {status.expired ? "The AliExpress connection has run out." : "AliExpress isn't connected yet."}{" "}
              <Link href="/admin/settings" className="underline">
                Connect it in Settings
              </Link>
              , then come back here.
            </Alert>
          )}
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Import from AliExpress" />
      <div className="space-y-6">
        <Suspense>
          <AliExpressSearch />
        </Suspense>
        <Card className="space-y-4">
          <h2 className="font-semibold">Or paste a product link</h2>
          <form onSubmit={onSubmit} className="max-w-2xl space-y-4">
            <p className="text-sm text-muted-foreground">
              Found something on the AliExpress website? Copy the link from the address bar (or the Share button) and
              paste it here. Either way, the product is added as a <strong>draft</strong> with its photos, options and
              your cost, so you can change anything before customers see it.
            </p>
            {error && <Alert>{error}</Alert>}
            <Field label="AliExpress product link" htmlFor="link">
              <Input
                id="link"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://www.aliexpress.com/item/…"
                autoComplete="off"
                required
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Cost and delivery time are checked for the countries you deliver to: {countries.join(", ")} (
              <Link href="/admin/settings" className="underline">
                change
              </Link>
              ).
            </p>
            <Button type="submit" disabled={busy || !link.trim()}>
              {busy ? "Importing… (checking prices and copying photos)" : "Import"}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
