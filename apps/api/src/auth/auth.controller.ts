import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { loginSchema, type LoginInput } from "@ecom/shared";
import { cookieOptions, DAY_MS } from "../common/cookies";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { AdminAuthGuard, CurrentAdmin, AUTH_COOKIE } from "./admin-auth.guard";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.login(body);
    res.cookie(AUTH_COOKIE, token, { ...cookieOptions, maxAge: 7 * DAY_MS });
    return user;
  }

  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, cookieOptions);
  }

  @Get("me")
  @UseGuards(AdminAuthGuard)
  me(@CurrentAdmin() admin: unknown) {
    return admin;
  }
}
