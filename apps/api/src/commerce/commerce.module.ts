import { Module } from "@nestjs/common";
import { AccountController, AdminOrdersController, CartController, CheckoutController } from "./commerce.controllers";
import { CartService } from "./cart.service";
import { CustomersService } from "./customers.service";
import { OrdersService } from "./orders.service";
import { CartFeatureGuard, CustomerAuthGuard, OptionalCustomerGuard } from "./customer-auth";

/** Customer accounts, cart, checkout and orders (Phase 2). */
@Module({
  controllers: [AccountController, CartController, CheckoutController, AdminOrdersController],
  providers: [CartService, CustomersService, OrdersService, CartFeatureGuard, OptionalCustomerGuard, CustomerAuthGuard],
})
export class CommerceModule {}
