import { createHmac } from "node:crypto";
import { AliExpressApiError, AliExpressClient, parseTokenResponse, signParams } from "./aliexpress-client";
import { parseAuthorizationInput } from "./authorization-input";
import { TokenCrypto } from "./token-crypto";

describe("signParams", () => {
  const hmac = (base: string) => createHmac("sha256", "secret").update(base).digest("hex").toUpperCase();

  it("signs sorted key+value pairs, with the path in front for system APIs", () => {
    const params = { timestamp: "1", code: "abc", app_key: "123" };
    expect(signParams(params, "secret", "/auth/token/create")).toBe(hmac("/auth/token/createapp_key123codeabctimestamp1"));
    expect(signParams(params, "secret")).toBe(hmac("app_key123codeabctimestamp1"));
  });
});

describe("parseTokenResponse", () => {
  it("reads tokens, expiry times and the account name", () => {
    const t = parseTokenResponse({
      code: "0",
      access_token: "at",
      refresh_token: "rt",
      expire_time: 2_000_000,
      refresh_token_valid_time: 3_000_000,
      user_nick: "shop_owner",
    });
    expect(t).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      accessExpiresAt: new Date(2_000_000),
      refreshExpiresAt: new Date(3_000_000),
      account: "shop_owner",
    });
  });

  it("falls back to expires_in seconds", () => {
    const t = parseTokenResponse(
      { code: "0", access_token: "at", refresh_token: "rt", expires_in: 60, refresh_expires_in: 120, account: "a@b.c" },
      1_000,
    );
    expect(t.accessExpiresAt).toEqual(new Date(61_000));
    expect(t.refreshExpiresAt).toEqual(new Date(121_000));
    expect(t.account).toBe("a@b.c");
  });

  it("throws AliExpress's error code", () => {
    expect(() => parseTokenResponse({ code: "InvalidCode", message: "Invalid authorization code" })).toThrow(
      new AliExpressApiError("InvalidCode", "Invalid authorization code"),
    );
  });
});

describe("AliExpressClient.authorizeUrl", () => {
  it("points at the AliExpress sign-in page with the callback and state", () => {
    const url = new URL(new AliExpressClient("123", "secret").authorizeUrl("https://shop.test/cb", "st"));
    expect(url.origin + url.pathname).toBe("https://api-sg.aliexpress.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      force_auth: "true",
      client_id: "123",
      redirect_uri: "https://shop.test/cb",
      state: "st",
    });
  });
});

describe("parseAuthorizationInput", () => {
  it("takes the code and state from a pasted address", () => {
    expect(parseAuthorizationInput(" https://example.com/api/admin/aliexpress/callback?code=3_abc&state=xyz#top ")).toEqual({
      code: "3_abc",
      state: "xyz",
    });
  });

  it("accepts a bare code", () => {
    expect(parseAuthorizationInput("3_abc")).toEqual({ code: "3_abc" });
  });

  it("rejects an address without a code", () => {
    expect(() => parseAuthorizationInput("https://example.com/cb?code=&state=x")).toThrow("no authorization code");
  });
});

describe("TokenCrypto", () => {
  const crypto = new TokenCrypto("secret-1");

  it("round-trips, without the plain token in the stored value", () => {
    const stored = crypto.encrypt("token-value");
    expect(stored).not.toContain("token-value");
    expect(crypto.decrypt(stored)).toBe("token-value");
    expect(crypto.encrypt("token-value")).not.toBe(stored);
  });

  it("returns null for another secret or an altered value", () => {
    const stored = crypto.encrypt("token-value");
    expect(new TokenCrypto("secret-2").decrypt(stored)).toBeNull();
    const [v, iv, tag, data] = stored.split(".");
    const flipped = data[0] === "A" ? "B" + data.slice(1) : "A" + data.slice(1);
    expect(crypto.decrypt([v, iv, tag, flipped].join("."))).toBeNull();
    expect(crypto.decrypt("plain-text")).toBeNull();
  });
});
