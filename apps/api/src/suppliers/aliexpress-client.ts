import { createHmac } from "node:crypto";

const GATEWAY = "https://api-sg.aliexpress.com";

/** Injection token. The value is null when ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET aren't set. */
export const ALIEXPRESS_CLIENT = Symbol("ALIEXPRESS_CLIENT");

export interface AliExpressTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  account: string;
}

/** The OAuth part of the AliExpress Open Platform; the e2e tests swap in a fake. */
export interface AliExpressAuthClient {
  authorizeUrl(redirectUri: string, state: string): string;
  createToken(code: string): Promise<AliExpressTokens>;
  refreshToken(refreshToken: string): Promise<AliExpressTokens>;
}

export class AliExpressApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`AliExpress: ${message} (${code})`);
  }
}

/**
 * HMAC-SHA256 of the sorted params as key+value pairs, uppercase hex. System APIs (/auth/...) put their
 * path in front; business APIs (/sync?method=...) don't.
 */
export function signParams(params: Record<string, string>, secret: string, apiPath = ""): string {
  const base = apiPath + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha256", secret).update(base, "utf8").digest("hex").toUpperCase();
}

interface TokenResponse {
  code: string;
  message?: string;
  access_token?: string;
  refresh_token?: string;
  /** Epoch ms */
  expire_time?: number;
  refresh_token_valid_time?: number;
  /** Seconds */
  expires_in?: number;
  refresh_expires_in?: number;
  user_nick?: string;
  account?: string;
}

export function parseTokenResponse(body: TokenResponse, now = Date.now()): AliExpressTokens {
  if (body.code !== "0" || !body.access_token || !body.refresh_token) {
    throw new AliExpressApiError(body.code ?? "unknown", body.message ?? "unexpected token response");
  }
  const at = (epochMs: number | undefined, seconds: number | undefined) =>
    new Date(epochMs ?? now + (seconds ?? 0) * 1000);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    accessExpiresAt: at(body.expire_time, body.expires_in),
    refreshExpiresAt: at(body.refresh_token_valid_time, body.refresh_expires_in),
    account: body.user_nick || body.account || "AliExpress account",
  };
}

export class AliExpressClient implements AliExpressAuthClient {
  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
  ) {}

  authorizeUrl(redirectUri: string, state: string): string {
    const q = new URLSearchParams({
      response_type: "code",
      force_auth: "true",
      client_id: this.appKey,
      redirect_uri: redirectUri,
      state,
    });
    return `${GATEWAY}/oauth/authorize?${q}`;
  }

  createToken(code: string) {
    return this.system("/auth/token/create", { code });
  }

  refreshToken(refreshToken: string) {
    return this.system("/auth/token/refresh", { refresh_token: refreshToken });
  }

  private async system(path: string, extra: Record<string, string>): Promise<AliExpressTokens> {
    const params: Record<string, string> = {
      app_key: this.appKey,
      timestamp: String(Date.now()),
      sign_method: "sha256",
      ...extra,
    };
    params.sign = signParams(params, this.appSecret, path);
    const res = await fetch(`${GATEWAY}/rest${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new AliExpressApiError(String(res.status), "request failed");
    return parseTokenResponse((await res.json()) as TokenResponse);
  }
}
