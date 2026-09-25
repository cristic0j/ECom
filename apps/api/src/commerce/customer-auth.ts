import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { CustomerDto } from "@ecom/shared";
import { storeConfig } from "@ecom/store-config";
import { CustomersService } from "./customers.service";

export const CUSTOMER_COOKIE = "ecom_customer";
/** Guest cart token; cleared at login, when the guest cart merges into the customer's cart */
export const CART_COOKIE = "ecom_cart";

export interface CustomerJwtPayload {
  sub: string;
  typ: "customer";
}

type CustomerRequest = Request & { customer?: CustomerDto };

export const CurrentCustomer = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<CustomerRequest>().customer,
);

/** Storefront commerce routes exist only when `features.cart` is on in store.config.ts. */
@Injectable()
export class CartFeatureGuard implements CanActivate {
  canActivate(): boolean {
    if (!storeConfig.features.cart) throw new NotFoundException();
    return true;
  }
}

/** Attaches the signed-in customer when there is one; never rejects (guest routes). */
@Injectable()
export class OptionalCustomerGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly customers: CustomersService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<CustomerRequest>();
    req.customer = (await this.resolve(req)) ?? undefined;
    return true;
  }

  protected async resolve(req: Request): Promise<CustomerDto | null> {
    const token = req.cookies?.[CUSTOMER_COOKIE];
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<CustomerJwtPayload>(token);
      if (payload.typ !== "customer") return null;
      // Re-read so deleted accounts lose access immediately
      return await this.customers.getById(payload.sub);
    } catch {
      return null;
    }
  }
}

/** Requires a signed-in customer. */
@Injectable()
export class CustomerAuthGuard extends OptionalCustomerGuard {
  override async canActivate(ctx: ExecutionContext): Promise<boolean> {
    await super.canActivate(ctx);
    if (!ctx.switchToHttp().getRequest<CustomerRequest>().customer) throw new UnauthorizedException("Please sign in");
    return true;
  }
}
