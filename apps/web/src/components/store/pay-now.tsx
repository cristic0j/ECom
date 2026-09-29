"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { shopApi } from "@/lib/shop-api";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

/**
 * "Pay now" for an unpaid order: sends the customer to the payment page. Guests pass the order's
 * token; signed-in customers can pay their own orders without one.
 */
export function PayNow({ number, token }: { number: number; token?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    setPending(true);
    setError(null);
    try {
      const { paymentUrl } = await shopApi.payOrder(number, token);
      window.location.assign(paymentUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open the payment page");
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button size="lg" onClick={pay} disabled={pending}>
        <CreditCard className="size-5" />
        {pending ? "Opening payment page…" : "Pay now"}
      </Button>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
