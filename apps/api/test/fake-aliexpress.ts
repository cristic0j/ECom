import { AliExpressApiError, type AliExpressApi, type AliExpressTokens } from "../src/suppliers/aliexpress-client";
import type { DsProductResponse } from "../src/suppliers/aliexpress-product";

export const HOUR = 3_600_000;

/** A 1×1 PNG, so imported photos pass the image checks */
export const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

/**
 * Stands in for AliExpress: "good-*" codes work once, every refresh hands out new tokens, and
 * `products[id][country]` answers product lookups (missing = not sold there).
 */
export class FakeAliExpress implements AliExpressApi {
  used = new Set<string>();
  refreshes: string[] = [];
  accessLifetimeMs = 30 * 24 * HOUR;
  down = false;
  products: Record<string, Record<string, DsProductResponse>> = {};
  calls: { method: string; params: Record<string, string>; session: string }[] = [];
  imageFetches: string[] = [];

  authorizeUrl(redirectUri: string, state: string) {
    return `https://ae.test/oauth/authorize?${new URLSearchParams({ redirect_uri: redirectUri, state })}`;
  }
  async createToken(code: string) {
    if (this.down) throw new TypeError("fetch failed");
    if (!code.startsWith("good-") || this.used.has(code)) throw new AliExpressApiError("InvalidCode", "Invalid authorization code");
    this.used.add(code);
    return this.tokens(`at-${code}`, `rt-${code}`);
  }
  async refreshToken(refreshToken: string) {
    this.refreshes.push(refreshToken);
    return this.tokens(`at-refreshed-${this.refreshes.length}`, `rt-refreshed-${this.refreshes.length}`);
  }
  async call<T>(method: string, params: Record<string, string>, session: string): Promise<T> {
    if (this.down) throw new TypeError("fetch failed");
    this.calls.push({ method, params, session });
    if (method !== "aliexpress.ds.product.get") throw new AliExpressApiError("InvalidApi", `unknown method ${method}`);
    const answer = this.products[params.product_id]?.[params.ship_to_country];
    return (answer ?? { rsp_code: 605, rsp_msg: "ITEM_ID_NOT_FOUND" }) as T;
  }
  async fetchImage(url: string) {
    this.imageFetches.push(url);
    if (url.includes("broken")) throw new AliExpressApiError("404", "image download failed");
    return url.includes("not-an-image") ? Buffer.from("<html>nope</html>") : PNG;
  }
  private tokens(accessToken: string, refreshToken: string): AliExpressTokens {
    return {
      accessToken,
      refreshToken,
      accessExpiresAt: new Date(Date.now() + this.accessLifetimeMs),
      refreshExpiresAt: new Date(Date.now() + 365 * 24 * HOUR),
      account: "shop_owner",
    };
  }
}
