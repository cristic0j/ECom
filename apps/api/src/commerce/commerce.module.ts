import { Module } from "@nestjs/common";
import {
  AccountController,
  AdminOrdersController,
  CartController,
  CheckoutController,
  PaymentsWebhookController,
} from "./commerce.controllers";
import { CartService } from "./cart.service";
import { CustomersService } from "./customers.service";
import { OrdersService } from "./orders.service";
import { PaymentsService } from "./payments.service";
import { CartFeatureGuard, CustomerAuthGuard, OptionalCustomerGuard } from "./customer-auth";
import { PAYMENT_PROVIDER } from "../payments/payment-provider";
import { createPaymentProvider } from "../payments/create-provider";

/** Customer accounts, cart, checkout and orders (Phase 2), and card payments (Phase 3). */
@Module({
  controllers: [AccountController, CartController, CheckoutController, PaymentsWebhookController, AdminOrdersController],
  providers: [
    CartService,
    CustomersService,
    OrdersService,
    PaymentsService,
    { provide: PAYMENT_PROVIDER, useFactory: createPaymentProvider },
    CartFeatureGuard,
    OptionalCustomerGuard,
    CustomerAuthGuard,
  ],
})
export class CommerceModule {}
