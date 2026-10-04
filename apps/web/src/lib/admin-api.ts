"use client";

import type {
  AdminOrderListQuery,
  AdminProductListQuery,
  AdminUserDto,
  CategoryDto,
  CategoryInput,
  OrderDto,
  OrderStatus,
  OrderTrackingInput,
  OrderSummaryDto,
  Paginated,
  ProductDto,
  ProductInput,
  ProductStatus,
  ProductSummaryDto,
  StoreSettings,
  SupplierConnectionDto,
} from "@ecom/shared";
import { json, request, toQuery } from "./api-client";

export { ApiRequestError } from "./api-client";

export const adminApi = {
  login: (email: string, password: string) => request<AdminUserDto>("/auth/login", json("POST", { email, password })),
  logout: () => request<void>("/auth/logout", json("POST")),
  me: () => request<AdminUserDto>("/auth/me"),

  listProducts: (q: Partial<AdminProductListQuery>) =>
    request<Paginated<ProductSummaryDto>>(`/admin/products${toQuery(q)}`),
  getProduct: (id: string) => request<ProductDto>(`/admin/products/${id}`),
  createProduct: (input: ProductInput) => request<ProductDto>("/admin/products", json("POST", input)),
  updateProduct: (id: string, input: ProductInput) => request<ProductDto>(`/admin/products/${id}`, json("PUT", input)),
  setProductStatus: (id: string, status: ProductStatus) =>
    request<ProductDto>(`/admin/products/${id}/status`, json("PATCH", { status })),
  deleteProduct: (id: string) => request<void>(`/admin/products/${id}`, json("DELETE")),

  listCategories: () => request<CategoryDto[]>("/admin/categories"),
  createCategory: (input: CategoryInput) => request<CategoryDto>("/admin/categories", json("POST", input)),
  updateCategory: (id: string, input: CategoryInput) =>
    request<CategoryDto>(`/admin/categories/${id}`, json("PUT", input)),
  deleteCategory: (id: string) => request<void>(`/admin/categories/${id}`, json("DELETE")),

  listOrders: (q: Partial<AdminOrderListQuery>) => request<Paginated<OrderSummaryDto>>(`/admin/orders${toQuery(q)}`),
  orderCounts: () => request<Partial<Record<OrderStatus, number>>>("/admin/orders/counts"),
  getOrder: (number: number) => request<OrderDto>(`/admin/orders/${number}`),
  setOrderStatus: (number: number, status: OrderStatus, note = "", tracking?: OrderTrackingInput) =>
    request<OrderDto>(`/admin/orders/${number}/status`, json("PATCH", { status, note, tracking })),
  setOrderTracking: (number: number, tracking: OrderTrackingInput) =>
    request<OrderDto>(`/admin/orders/${number}/tracking`, json("PATCH", tracking)),

  getSettings: () => request<StoreSettings>("/settings"),
  updateSettings: (patch: StoreSettings) => request<StoreSettings>("/admin/settings", json("PUT", patch)),

  aliexpressStatus: () => request<SupplierConnectionDto>("/admin/aliexpress"),
  aliexpressAuthorize: () => request<{ url: string }>("/admin/aliexpress/authorize", json("POST")),
  aliexpressConnect: (code: string) =>
    request<SupplierConnectionDto>("/admin/aliexpress/connect", json("POST", { code })),
  aliexpressDisconnect: () => request<void>("/admin/aliexpress", json("DELETE")),

  uploadImage: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ url: string }>("/admin/media", { method: "POST", body: form });
  },
};
