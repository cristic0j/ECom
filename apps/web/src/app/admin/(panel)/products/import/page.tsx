"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { SupplierConnectionDto } from "@ecom/shared";
import { adminApi } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/misc";
import { PageHeader, useAdmin } from "@/components/admin/admin-shell";

export default function ImportProductPage() {
  const router = useRouter();
  const admin = useAdmin();
  const [status, setStatus] = useState<SupplierConnectionDto | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([adminApi.aliexpressStatus(), adminApi.aliexpressSettings()])
      .then(([s, settings]) => {
        setStatus(s);
        setCountries(settings.countries);
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

  return (
    <>
      <PageHeader title="Import from AliExpress" />
      <Card className="max-w-2xl space-y-4">
        {!status ? (
          error ? <Alert>{error}</Alert> : <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !status.connected ? (
          <Alert>
            {status.expired ? "The AliExpress connection has run out." : "AliExpress isn't connected yet."}{" "}
            <Link href="/admin/settings" className="underline">
              Connect it in Settings
            </Link>
            , then come back here.
          </Alert>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Open the product on AliExpress, copy the link from the address bar (or the Share button) and paste it here.
              The product is added as a <strong>draft</strong> with its photos, options and your cost, so you can change
              anything before customers see it.
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
              Cost and delivery time are checked for {countries.join(", ")} (
              <Link href="/admin/settings" className="underline">
                change
              </Link>
              ).
            </p>
            <Button type="submit" disabled={busy || !link.trim()}>
              {busy ? "Importing… (checking prices and copying photos)" : "Import"}
            </Button>
          </form>
        )}
      </Card>
    </>
  );
}
