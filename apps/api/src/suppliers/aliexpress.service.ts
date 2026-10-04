import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { SupplierConnection } from "@ecom/db";
import type { AdminUserDto, SupplierConnectionDto } from "@ecom/shared";
import { env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { ALIEXPRESS_CLIENT, AliExpressApiError, type AliExpressApi, type AliExpressTokens } from "./aliexpress-client";
import { TokenCrypto } from "./token-crypto";

const PROVIDER = "aliexpress";
const STATE_TYP = "aliexpress_oauth";
/** Renew the access token when it has less than this left */
const REFRESH_MARGIN_MS = 60 * 60 * 1000;

export const aliexpressCallbackUrl = () =>
  env.ALIEXPRESS_CALLBACK_URL || `${env.SITE_URL.replace(/\/$/, "")}/api/admin/aliexpress/callback`;

@Injectable()
export class AliExpressService {
  private readonly logger = new Logger("AliExpress");
  private readonly crypto = new TokenCrypto(env.JWT_SECRET);
  /** One refresh at a time, so parallel calls don't each spend the refresh token */
  private refreshing: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ALIEXPRESS_CLIENT) private readonly client: AliExpressApi | null,
  ) {}

  async status(): Promise<SupplierConnectionDto> {
    const row = await this.find();
    const expired = !!row && (row.refreshExpiresAt <= new Date() || this.crypto.decrypt(row.refreshToken) === null);
    return {
      configured: !!this.client,
      connected: !!row && !expired,
      expired,
      account: row?.account ?? null,
      connectedBy: row?.connectedBy ?? null,
      connectedAt: row?.createdAt.toISOString() ?? null,
      expiresAt: row?.refreshExpiresAt.toISOString() ?? null,
    };
  }

  /** Where to send the admin to sign in to AliExpress; the state ties the answer to this admin. */
  async authorizeUrl(admin: AdminUserDto): Promise<string> {
    const client = this.requireClient();
    const state = await this.jwt.signAsync({ sub: admin.id, typ: STATE_TYP }, { expiresIn: "15m" });
    return client.authorizeUrl(aliexpressCallbackUrl(), state);
  }

  /**
   * Finishes connecting. The redirect route always has a state; a pasted address is checked when it
   * carries one (a bare code can only be pasted by a signed-in admin).
   */
  async connect(
    { code, state }: { code: string; state?: string },
    admin: AdminUserDto,
    { requireState = false } = {},
  ): Promise<SupplierConnectionDto> {
    const client = this.requireClient();
    if (state || requireState) await this.verifyState(state, admin);

    let tokens: AliExpressTokens;
    try {
      tokens = await client.createToken(code);
    } catch (err) {
      throw this.asHttpError(err, "AliExpress didn't accept that code. Codes work once and only for a few minutes: click Connect again.");
    }
    const data = { ...this.encrypted(tokens), connectedBy: admin.email };
    // A reconnect starts a new connection, so "connected since" resets
    await this.prisma.$transaction([
      this.prisma.supplierConnection.deleteMany({ where: { provider: PROVIDER } }),
      this.prisma.supplierConnection.create({ data: { provider: PROVIDER, ...data } }),
    ]);
    this.logger.log(`Connected to AliExpress account ${tokens.account} by ${admin.email}`);
    return this.status();
  }

  async disconnect(): Promise<void> {
    await this.prisma.supplierConnection.deleteMany({ where: { provider: PROVIDER } });
  }

  /** A valid access token for API calls, renewed first when it's about to run out. */
  async accessToken(): Promise<string> {
    const row = await this.find();
    if (!row) throw new ServiceUnavailableException("AliExpress isn't connected (Admin → Settings → AliExpress)");
    const token = this.crypto.decrypt(row.accessToken);
    if (token && row.accessExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) return token;
    this.refreshing ??= this.refresh(row).finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async refresh(row: SupplierConnection): Promise<string> {
    const client = this.requireClient();
    const refreshToken = this.crypto.decrypt(row.refreshToken);
    if (!refreshToken || row.refreshExpiresAt <= new Date()) {
      throw new ServiceUnavailableException("The AliExpress connection has run out: connect again in Admin → Settings");
    }
    let tokens: AliExpressTokens;
    try {
      tokens = await client.refreshToken(refreshToken);
    } catch (err) {
      throw this.asHttpError(err, "Couldn't renew the AliExpress connection: connect again in Admin → Settings");
    }
    await this.prisma.supplierConnection.update({ where: { provider: PROVIDER }, data: this.encrypted(tokens) });
    return tokens.accessToken;
  }

  private encrypted(t: AliExpressTokens) {
    return {
      account: t.account,
      accessToken: this.crypto.encrypt(t.accessToken),
      refreshToken: this.crypto.encrypt(t.refreshToken),
      accessExpiresAt: t.accessExpiresAt,
      refreshExpiresAt: t.refreshExpiresAt,
    };
  }

  private async verifyState(state: string | undefined, admin: AdminUserDto) {
    const payload = state
      ? await this.jwt.verifyAsync<{ sub: string; typ: string }>(state).catch(() => null)
      : null;
    if (payload?.typ !== STATE_TYP || payload.sub !== admin.id) {
      throw new BadRequestException("This sign-in link has expired or was started by someone else: click Connect again");
    }
  }

  private find() {
    return this.prisma.supplierConnection.findUnique({ where: { provider: PROVIDER } });
  }

  private requireClient(): AliExpressApi {
    if (!this.client) {
      throw new ServiceUnavailableException("AliExpress isn't set up: add ALIEXPRESS_APP_KEY and ALIEXPRESS_APP_SECRET to .env");
    }
    return this.client;
  }

  /** AliExpress said no → 400 with a plain message; anything else (network, outage) → 503 */
  private asHttpError(err: unknown, message: string) {
    this.logger.warn(err instanceof Error ? err.message : String(err));
    return err instanceof AliExpressApiError && !/^\d+$/.test(err.code)
      ? new BadRequestException(message)
      : new ServiceUnavailableException("AliExpress couldn't be reached. Try again in a minute.");
  }
}
