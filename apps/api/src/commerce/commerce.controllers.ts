import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  type RawBodyRequest,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  adminOrderListQuerySchema,
  cartAddSchema,
  cartUpdateSchema,
  checkoutSchema,
  customerRegisterSchema,
  forgotPasswordSchema,
  loginSchema,
  orderStatusUpdateSchema,
  payOrderSchema,
  resetPasswordSchema,
  type AdminOrderListQuery,
  type AdminUserDto,
  type CartAddInput,
  type CartUpdateInput,
  type CheckoutInput,
  type CustomerDto,
  type CustomerRegisterInput,
  type ForgotPasswordInput,
  type LoginInput,
  type OrderStatusUpdateInput,
  type PayOrderInput,
  type ResetPasswordInput,
} from "@ecom/shared";
import { cookieOptions, DAY_MS } from "../common/cookies";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, CurrentAdmin } from "../auth/admin-auth.guard";
import { CartService, type CartOwner } from "./cart.service";
import { CustomersService, CUSTOMER_SESSION_DAYS } from "./customers.service";
import { OrdersService } from "./orders.service";
import { PaymentsService } from "./payments.service";
import {
  CART_COOKIE,
  CartFeatureGuard,
  CurrentCustomer,
  CUSTOMER_COOKIE,
  CustomerAuthGuard,
  OptionalCustomerGuard,
} from "./customer-auth";

const CART_COOKIE_DAYS = 30;

const ownerOf = (req: Request, customer?: CustomerDto): CartOwner =>
  customer ? { customerId: customer.id } : { token: req.cookies?.[CART_COOKIE] };

@ApiTags("account")
@UseGuards(CartFeatureGuard)
@Controller("account")
export class AccountController {
  constructor(
    private readonly customers: CustomersService,
    private readonly carts: CartService,
    private readonly orders: OrdersService,
  ) {}

  @Post("register")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async register(
    @Body(new ZodValidationPipe(customerRegisterSchema)) body: CustomerRegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, customer } = await this.customers.register(body);
    await this.startSession(req, res, token, customer);
    return customer;
  }

  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, customer } = await this.customers.login(body);
    await this.startSession(req, res, token, customer);
    return customer;
  }

  @Post("forgot-password")
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput) {
    await this.customers.requestPasswordReset(body.email);
  }

  @Post("reset-password")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, customer } = await this.customers.resetPassword(body);
    await this.startSession(req, res, token, customer);
    return customer;
  }

  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(CUSTOMER_COOKIE, cookieOptions);
  }

  @Get("me")
  @UseGuards(CustomerAuthGuard)
  me(@CurrentCustomer() customer: CustomerDto) {
    return customer;
  }

  @Get("orders")
  @UseGuards(CustomerAuthGuard)
  listOrders(@CurrentCustomer() customer: CustomerDto) {
    return this.orders.listForCustomer(customer.id);
  }

  @Get("orders/:number")
  @UseGuards(CustomerAuthGuard)
  getOrder(@CurrentCustomer() customer: CustomerDto, @Param("number", ParseIntPipe) number: number) {
    return this.orders.getForCustomer(customer.id, number);
  }

  /** Sets the session cookie and folds any guest cart into the customer's cart. */
  private async startSession(req: Request, res: Response, token: string, customer: CustomerDto) {
    await this.carts.mergeGuestCart(req.cookies?.[CART_COOKIE], customer.id);
    res.clearCookie(CART_COOKIE, cookieOptions);
    res.cookie(CUSTOMER_COOKIE, token, { ...cookieOptions, maxAge: CUSTOMER_SESSION_DAYS * DAY_MS });
  }
}

@ApiTags("cart")
@UseGuards(CartFeatureGuard, OptionalCustomerGuard)
@Controller("cart")
export class CartController {
  constructor(private readonly carts: CartService) {}

  @Get()
  view(@Req() req: Request, @CurrentCustomer() customer?: CustomerDto) {
    return this.carts.view(ownerOf(req, customer));
  }

  @Post("items")
  async add(
    @Body(new ZodValidationPipe(cartAddSchema)) body: CartAddInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentCustomer() customer?: CustomerDto,
  ) {
    const { cart, token } = await this.carts.add(ownerOf(req, customer), body);
    if (token) res.cookie(CART_COOKIE, token, { ...cookieOptions, maxAge: CART_COOKIE_DAYS * DAY_MS });
    return cart;
  }

  @Patch("items/:id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cartUpdateSchema)) body: CartUpdateInput,
    @Req() req: Request,
    @CurrentCustomer() customer?: CustomerDto,
  ) {
    return this.carts.update(ownerOf(req, customer), id, body.quantity);
  }

  @Delete("items/:id")
  remove(@Param("id") id: string, @Req() req: Request, @CurrentCustomer() customer?: CustomerDto) {
    return this.carts.update(ownerOf(req, customer), id, 0);
  }
}

@ApiTags("checkout")
@UseGuards(CartFeatureGuard, OptionalCustomerGuard)
@Controller()
export class CheckoutController {
  constructor(private readonly orders: OrdersService) {}

  @Post("checkout")
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  checkout(
    @Body(new ZodValidationPipe(checkoutSchema)) body: CheckoutInput,
    @Req() req: Request,
    @CurrentCustomer() customer?: CustomerDto,
  ) {
    return this.orders.checkout(ownerOf(req, customer), body, customer);
  }

  /** "Pay now" on an unpaid order: returns a payment page URL. 404 when card payments are off. */
  @Post("orders/:number/pay")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  pay(
    @Param("number", ParseIntPipe) number: number,
    @Body(new ZodValidationPipe(payOrderSchema)) body: PayOrderInput,
    @CurrentCustomer() customer?: CustomerDto,
  ) {
    return this.orders.pay(number, body.token, customer);
  }

  /** Order confirmation for guests: `?token=` is the secret returned by checkout. */
  @Get("orders/:number")
  getOrder(@Param("number", ParseIntPipe) number: number, @Query("token") token = "") {
    return this.orders.getWithToken(number, token);
  }
}

/**
 * Payment provider webhooks (Stripe calls this directly, not through the storefront). The signature
 * is checked against the raw request body, so this needs the app created with `rawBody: true`.
 */
@ApiTags("payments")
@SkipThrottle()
@Controller("payments")
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>) {
    await this.payments.handleWebhook(req.rawBody, req.headers);
    return { received: true };
  }
}

@ApiTags("admin")
@ApiCookieAuth()
@UseGuards(AdminAuthGuard)
@Controller("admin/orders")
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query(new ZodValidationPipe(adminOrderListQuerySchema)) query: AdminOrderListQuery) {
    return this.orders.adminList(query);
  }

  @Get("counts")
  counts() {
    return this.orders.countsByStatus();
  }

  @Get(":number")
  get(@Param("number", ParseIntPipe) number: number) {
    return this.orders.adminGet(number);
  }

  @Patch(":number/status")
  setStatus(
    @Param("number", ParseIntPipe) number: number,
    @Body(new ZodValidationPipe(orderStatusUpdateSchema)) body: OrderStatusUpdateInput,
    @CurrentAdmin() admin: AdminUserDto,
  ) {
    return this.orders.setStatus(number, body, admin.email);
  }
}
