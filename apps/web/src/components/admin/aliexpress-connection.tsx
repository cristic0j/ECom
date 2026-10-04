"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SupplierConnectionDto } from "@ecom/shared";
import { adminApi } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert, Badge, Card } from "@/components/ui/misc";

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");

/** Admin → Settings: link the AliExpress account that orders are placed from. */
export function AliExpressConnection() {
  const [status, setStatus] = useState<SupplierConnectionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Sign-in opened in another tab; waiting for the address to be pasted */
  const [pasting, setPasting] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Back from the callback route (when the callback URL reaches this store)
    const params = new URLSearchParams(window.location.search);
    const result = params.get("aliexpress");
    if (result) window.history.replaceState(null, "", window.location.pathname);
    adminApi
      .aliexpressStatus()
      .then((s) => {
        setStatus(s);
        if (result === "connected") setNotice("AliExpress is connected.");
        if (result === "error") setError(params.get("message") ?? "Connecting to AliExpress failed.");
      })
      .catch((e) => setError(e.message));
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const startSignIn = () => {
    // Opened during the click, or popup blockers stop it; pointed at AliExpress once the link is ready
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    return run(async () => {
      try {
        const { url } = await adminApi.aliexpressAuthorize();
        if (tab) tab.location.href = url;
        else window.location.href = url;
      } catch (e) {
        tab?.close();
        throw e;
      }
      setAddress("");
      setPasting(true);
    });
  };

  const finish = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      setStatus(await adminApi.aliexpressConnect(address));
      setPasting(false);
      setNotice("AliExpress is connected.");
    });
  };

  const disconnect = () => {
    const message = "Disconnect AliExpress? The store won't be able to send orders there until you connect again.";
    if (!confirm(message)) return;
    return run(async () => {
      await adminApi.aliexpressDisconnect();
      setStatus(await adminApi.aliexpressStatus());
    });
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">AliExpress</h2>
        {status?.connected && <Badge tone="success">Connected</Badge>}
        {status?.expired && <Badge tone="warning">Needs reconnecting</Badge>}
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {notice}
        </p>
      )}

      {!status ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !status.configured ? (
        <p className="text-sm text-muted-foreground">
          Not set up yet: add <code>ALIEXPRESS_APP_KEY</code> and <code>ALIEXPRESS_APP_SECRET</code> from your
          AliExpress developer app to <code>.env</code>, then restart the store.
        </p>
      ) : (
        <>
          {status.account && (
            <p className="text-sm">
              {status.expired ? "Was connected" : "Connected"} as <strong>{status.account}</strong>
              {status.connectedAt && ` since ${date(status.connectedAt)}`}
              {status.connectedBy && ` (by ${status.connectedBy})`}.
              {status.connected && status.expiresAt && (
                <span className="text-muted-foreground">
                  {" "}
                  You&apos;ll need to reconnect by {date(status.expiresAt)}.
                </span>
              )}
            </p>
          )}
          {!status.account && (
            <p className="text-sm text-muted-foreground">
              Link the AliExpress account you&apos;ll place and pay for orders with. You&apos;ll sign in on
              AliExpress and allow access for your app.
            </p>
          )}

          {pasting ? (
            <form onSubmit={finish} className="space-y-3">
              <Field
                label="Address after signing in"
                htmlFor="aliexpressAddress"
                hint="After you allow access, AliExpress opens a page that may not load. Copy the whole address from the browser's address bar and paste it here."
              >
                <Input
                  id="aliexpressAddress"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="https://example.com/…?code=…"
                  autoComplete="off"
                  required
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !address.trim()}>
                  Finish connecting
                </Button>
                <Button variant="ghost" onClick={() => setPasting(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex gap-2">
              <Button onClick={startSignIn} disabled={busy} variant={status.connected ? "secondary" : "primary"}>
                {status.account ? "Reconnect AliExpress" : "Connect AliExpress"}
              </Button>
              {status.account && (
                <Button variant="ghost" onClick={disconnect} disabled={busy}>
                  Disconnect
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Admin → Settings: the countries an imported product's cost and delivery time are checked for. */
export function AliExpressCountries() {
  const [countries, setCountries] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi
      .aliexpressSettings()
      .then((s) => setCountries(s.countries.join(", ")))
      .catch((e) => setError(e.message));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const list = countries.split(/[\s,]+/).filter(Boolean);
      const result = await adminApi.saveAliexpressSettings({ countries: list });
      setCountries(result.countries.join(", "));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">AliExpress import countries</h2>
      <p className="text-sm text-muted-foreground">
        When you import a product, its cost and delivery time are checked for these countries. Each option&apos;s cost
        is the highest of them, so your profit figures stay on the safe side.
      </p>
      {error && <Alert>{error}</Alert>}
      {saved && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          Countries saved.
        </p>
      )}
      <form onSubmit={save} className="space-y-3">
        <Field label="Countries" htmlFor="aliexpressCountries" hint="2-letter codes, up to 10, e.g. NL, DE, FR, US">
          <Input
            id="aliexpressCountries"
            value={countries}
            onChange={(e) => setCountries(e.target.value.toUpperCase())}
            autoComplete="off"
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={busy}>
          Save countries
        </Button>
      </form>
    </Card>
  );
}
