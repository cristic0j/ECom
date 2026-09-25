"use client";

import type {
  CartDto,
  CheckoutInput,
  CheckoutResultDto,
  CustomerDto,
  CustomerRegisterInput,
  OrderDto,
  OrderSummaryDto,
} from "@ecom/shared";
import { json, request } from "./api-client";

/** Storefront calls for customers: cart, checkout, account. Cookies carry the cart and session. */
export const shopApi = {
  cart: () => request<CartDto>("/cart"),
  addToCart: (variantId: string, quantity = 1) => request<CartDto>("/cart/items", json("POST", { variantId, quantity })),
  setQuantity: (itemId: string, quantity: number) =>
    request<CartDto>(`/cart/items/${itemId}`, json("PATCH", { quantity })),
  removeItem: (itemId: string) => request<CartDto>(`/cart/items/${itemId}`, json("DELETE")),

  checkout: (input: CheckoutInput) => request<CheckoutResultDto>("/checkout", json("POST", input)),
  order: (number: number, token: string) =>
    request<OrderDto>(`/orders/${number}?token=${encodeURIComponent(token)}`),

  register: (input: CustomerRegisterInput) => request<CustomerDto>("/account/register", json("POST", input)),
  login: (email: string, password: string) => request<CustomerDto>("/account/login", json("POST", { email, password })),
  logout: () => request<void>("/account/logout", json("POST")),
  me: () => request<CustomerDto>("/account/me"),
  myOrders: () => request<OrderSummaryDto[]>("/account/orders"),
  myOrder: (number: number) => request<OrderDto>(`/account/orders/${number}`),
};
