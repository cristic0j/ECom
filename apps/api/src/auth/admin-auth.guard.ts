import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { AdminUserDto } from "@ecom/shared";
import { AuthService, type AdminJwtPayload } from "./auth.service";

export const AUTH_COOKIE = "ecom_admin";
const ROLES_KEY = "roles";

/** Restrict a route/controller to specific admin roles (default: any authenticated admin). */
export const Roles = (...roles: AdminUserDto["role"][]) => SetMetadata(ROLES_KEY, roles);

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request & { admin?: AdminUserDto }>().admin,
);

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { admin?: AdminUserDto }>();
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException("Not authenticated");

    let payload: AdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminJwtPayload>(token);
    } catch {
      throw new UnauthorizedException("Session expired or invalid");
    }

    // Re-read the user so deleted admins / changed roles take effect immediately
    const admin = await this.auth.getUser(payload.sub);
    if (!admin) throw new UnauthorizedException("Not authenticated");

    const roles = this.reflector.getAllAndOverride<AdminUserDto["role"][] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.includes(admin.role)) throw new ForbiddenException("Insufficient role");

    req.admin = admin;
    return true;
  }
}

function extractToken(req: Request): string | undefined {
  const cookie = req.cookies?.[AUTH_COOKIE];
  if (cookie) return cookie;
  const [scheme, value] = req.headers.authorization?.split(" ") ?? [];
  return scheme === "Bearer" ? value : undefined;
}
