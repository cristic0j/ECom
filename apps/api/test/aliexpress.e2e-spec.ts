import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { hash } from "@node-rs/argon2";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  ALIEXPRESS_CLIENT,
  AliExpressApiError,
  type AliExpressAuthClient,
  type AliExpressTokens,
} from "../src/suppliers/aliexpress-client";
import { AliExpressService } from "../src/suppliers/aliexpress.service";

const HOUR = 3_600_000;

/** Stands in for AliExpress: "good-*" codes work once, and every refresh hands out new tokens. */
class FakeAliExpress implements AliExpressAuthClient {
  used = new Set<string>();
  refreshes: string[] = [];
  accessLifetimeMs = 30 * 24 * HOUR;
  down = false;

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

describe("AliExpress connection (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminCookie: string[];
  let otherAdminCookie: string[];
  let editorCookie: string[];
  const fake = new FakeAliExpress();

  const http = () => request(app.getHttpServer());
  const login = async (email: string) =>
    (await http().post("/api/auth/login").send({ email, password: "pass12345" }).expect(200)).get("Set-Cookie")!;
  const stateFor = async (cookie: string[]) => {
    const res = await http().post("/api/admin/aliexpress/authorize").set("Cookie", cookie).expect(200);
    return new URL(res.body.url).searchParams.get("state")!;
  };
  const pasted = (code: string, state: string) =>
    `https://example.com/api/admin/aliexpress/callback?${new URLSearchParams({ code, state })}`;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes("schema=e2e")) {
      throw new Error("Refusing to run e2e tests outside the e2e schema");
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ALIEXPRESS_CLIENT)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.$executeRawUnsafe(`TRUNCATE "AdminUser", "SupplierConnection" RESTART IDENTITY CASCADE`);
    const passwordHash = await hash("pass12345");
    await prisma.adminUser.createMany({
      data: [
        { email: "admin@test.dev", passwordHash, role: "ADMIN" },
        { email: "admin2@test.dev", passwordHash, role: "ADMIN" },
        { email: "editor@test.dev", passwordHash, role: "EDITOR" },
      ],
    });
    adminCookie = await login("admin@test.dev");
    otherAdminCookie = await login("admin2@test.dev");
    editorCookie = await login("editor@test.dev");
  });

  afterAll(async () => {
    await app.close();
  });

  it("is admin-only", async () => {
    await http().get("/api/admin/aliexpress").expect(401);
    await http().get("/api/admin/aliexpress").set("Cookie", editorCookie).expect(403);
  });

  it("starts disconnected, and the sign-in link carries the callback URL", async () => {
    const status = await http().get("/api/admin/aliexpress").set("Cookie", adminCookie).expect(200);
    expect(status.body).toMatchObject({ configured: true, connected: false, expired: false, account: null });

    const res = await http().post("/api/admin/aliexpress/authorize").set("Cookie", adminCookie).expect(200);
    expect(new URL(res.body.url).searchParams.get("redirect_uri")).toMatch(/^https:\/\/.+\/api\/admin\/aliexpress\/callback$/);
  });

  it("rejects a pasted address whose state belongs to another admin or is forged", async () => {
    const othersState = await stateFor(otherAdminCookie);
    await http()
      .post("/api/admin/aliexpress/connect")
      .set("Cookie", adminCookie)
      .send({ code: pasted("good-1", othersState) })
      .expect(400);
    await http()
      .post("/api/admin/aliexpress/connect")
      .set("Cookie", adminCookie)
      .send({ code: pasted("good-1", "forged") })
      .expect(400);
    expect(fake.used.size).toBe(0);
  });

  it("connects from a pasted address and stores the tokens encrypted", async () => {
    const state = await stateFor(adminCookie);
    const res = await http()
      .post("/api/admin/aliexpress/connect")
      .set("Cookie", adminCookie)
      .send({ code: pasted("good-1", state) })
      .expect(200);
    expect(res.body).toMatchObject({ connected: true, account: "shop_owner", connectedBy: "admin@test.dev" });

    const row = await prisma.supplierConnection.findUniqueOrThrow({ where: { provider: "aliexpress" } });
    expect(row.accessToken).not.toContain("at-good-1");
    expect(row.refreshToken).not.toContain("rt-good-1");
    expect(await app.get(AliExpressService).accessToken()).toBe("at-good-1");
    expect(fake.refreshes).toEqual([]);
  });

  it("explains a used-up code, and a supplier outage, without changing the connection", async () => {
    const used = await http().post("/api/admin/aliexpress/connect").set("Cookie", adminCookie).send({ code: "good-1" }).expect(400);
    expect(used.body.message).toMatch(/click Connect again/);

    fake.down = true;
    await http().post("/api/admin/aliexpress/connect").set("Cookie", adminCookie).send({ code: "good-2" }).expect(503);
    fake.down = false;

    expect(await app.get(AliExpressService).accessToken()).toBe("at-good-1");
  });

  it("renews an access token that's about to run out, once for parallel callers", async () => {
    await prisma.supplierConnection.update({
      where: { provider: "aliexpress" },
      data: { accessExpiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    const service = app.get(AliExpressService);
    const tokens = await Promise.all([service.accessToken(), service.accessToken(), service.accessToken()]);
    expect(tokens).toEqual(["at-refreshed-1", "at-refreshed-1", "at-refreshed-1"]);
    expect(fake.refreshes).toEqual(["rt-good-1"]);
    expect(await service.accessToken()).toBe("at-refreshed-1");
  });

  it("reports an expired connection", async () => {
    await prisma.supplierConnection.update({
      where: { provider: "aliexpress" },
      data: { accessExpiresAt: new Date(Date.now() - HOUR), refreshExpiresAt: new Date(Date.now() - HOUR) },
    });
    const status = await http().get("/api/admin/aliexpress").set("Cookie", adminCookie).expect(200);
    expect(status.body).toMatchObject({ connected: false, expired: true, account: "shop_owner" });
    await expect(app.get(AliExpressService).accessToken()).rejects.toThrow(/connect again/);
  });

  it("connects through the callback redirect, which requires a valid state", async () => {
    const bad = await http()
      .get("/api/admin/aliexpress/callback?code=good-3")
      .set("Cookie", adminCookie)
      .expect(302);
    expect(new URL(bad.headers.location, "http://x").searchParams.get("aliexpress")).toBe("error");
    expect(fake.used.has("good-3")).toBe(false);

    const state = await stateFor(adminCookie);
    const ok = await http()
      .get(`/api/admin/aliexpress/callback?${new URLSearchParams({ code: "good-3", state })}`)
      .set("Cookie", adminCookie)
      .expect(302);
    expect(ok.headers.location).toBe("/admin/settings?aliexpress=connected");
    const status = await http().get("/api/admin/aliexpress").set("Cookie", adminCookie).expect(200);
    expect(status.body).toMatchObject({ connected: true, expired: false });
  });

  it("disconnects", async () => {
    await http().delete("/api/admin/aliexpress").set("Cookie", adminCookie).expect(204);
    const status = await http().get("/api/admin/aliexpress").set("Cookie", adminCookie).expect(200);
    expect(status.body).toMatchObject({ connected: false, expired: false, account: null });
  });
});
