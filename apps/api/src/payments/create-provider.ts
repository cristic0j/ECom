import { Logger } from "@nestjs/common";
import { storeConfig } from "@ecom/store-config";
import { env } from "../config/env";
import type { PaymentProvider } from "./payment-provider";
import { StripeProvider } from "./stripe-provider";

/** Null when card payments are off; then orders are paid by hand and marked paid in the admin. */
export function createPaymentProvider(): PaymentProvider | null {
  if (!storeConfig.features.payments) return null;
  const { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: webhookSecret } = env;
  if (!key || !webhookSecret) {
    throw new Error(
      "features.payments is on in store.config.ts, so STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set (see README → Payments)",
    );
  }
  if (env.NODE_ENV === "production" && key.startsWith("sk_test_")) {
    new Logger("Payments").warn("STRIPE_SECRET_KEY is a test key: no real money will be collected");
  }
  return new StripeProvider(key, webhookSecret);
}
