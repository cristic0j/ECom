import { env } from "../config/env";
import { AliExpressClient, type AliExpressApi } from "./aliexpress-client";

/** Null when the app keys aren't set; the admin then shows how to set AliExpress up. */
export function createAliExpressClient(): AliExpressApi | null {
  const { ALIEXPRESS_APP_KEY: key, ALIEXPRESS_APP_SECRET: secret } = env;
  return key && secret ? new AliExpressClient(key, secret) : null;
}
