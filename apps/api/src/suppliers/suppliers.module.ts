import { Body, Controller, Delete, Get, HttpCode, Module, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { supplierConnectSchema, type AdminUserDto, type SupplierConnectInput } from "@ecom/shared";
import { AdminAuthGuard, CurrentAdmin, Roles } from "../auth/admin-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ALIEXPRESS_CLIENT } from "./aliexpress-client";
import { AliExpressService } from "./aliexpress.service";
import { parseAuthorizationInput } from "./authorization-input";
import { createAliExpressClient } from "./create-client";

@ApiTags("admin")
@ApiCookieAuth()
@UseGuards(AdminAuthGuard)
@Roles("ADMIN")
@Controller("admin/aliexpress")
export class AdminAliExpressController {
  constructor(private readonly aliexpress: AliExpressService) {}

  @Get()
  status() {
    return this.aliexpress.status();
  }

  @Post("authorize")
  @HttpCode(200)
  async authorize(@CurrentAdmin() admin: AdminUserDto) {
    return { url: await this.aliexpress.authorizeUrl(admin) };
  }

  /** For when the callback URL doesn't reach this API (local dev): the admin pastes the address instead. */
  @Post("connect")
  @HttpCode(200)
  connect(@Body(new ZodValidationPipe(supplierConnectSchema)) body: SupplierConnectInput, @CurrentAdmin() admin: AdminUserDto) {
    return this.aliexpress.connect(parseAuthorizationInput(body.code), admin);
  }

  /** Where AliExpress sends the browser after sign-in, once the store runs on its own domain. */
  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @CurrentAdmin() admin: AdminUserDto,
    @Res() res: Response,
  ) {
    const query = new URLSearchParams({ aliexpress: "connected" });
    try {
      if (!code) throw new Error("AliExpress didn't send a code (was access declined?)");
      await this.aliexpress.connect({ code, state }, admin, { requireState: true });
    } catch (err) {
      query.set("aliexpress", "error");
      query.set("message", err instanceof Error ? err.message : "Connecting failed");
    }
    res.redirect(`/admin/settings?${query}`);
  }

  @Delete()
  @HttpCode(204)
  disconnect() {
    return this.aliexpress.disconnect();
  }
}

/** Supplier accounts the store orders from (AliExpress). */
@Module({
  controllers: [AdminAliExpressController],
  providers: [AliExpressService, { provide: ALIEXPRESS_CLIENT, useFactory: createAliExpressClient }],
  exports: [AliExpressService],
})
export class SuppliersModule {}
