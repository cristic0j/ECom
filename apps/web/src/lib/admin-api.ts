"use client";

import type {
  AdminProductListQuery,
  AdminUserDto,
  ApiError,
  CategoryDto,
  CategoryInput,
  Paginated,
  ProductDto,
  ProductInput,
  ProductStatus,
  ProductSummaryDto,
  StoreSettings,
} from "@ecom/shared";

// Same-origin: next.config.ts proxies /api/* to the Nest API, so the auth cookie is first-party
const API_URL = "/api";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError | null,
  ) {
    super(body?.message ?? `Request failed (${status})`);
  }

  /** zod field errors from a 400 "Validation failed" response, keyed by field path. */
  get fieldErrors(): Record<string, string[]> {
    const details = this.body?.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return details?.fieldErrors ?? {};
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, body);
  return body as T;
}

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  body: data === undefined ? undefined : JSON.stringify(data),
});

function toQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

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

  getSettings: () => request<StoreSettings>("/settings"),
  updateSettings: (patch: StoreSettings) => request<StoreSettings>("/admin/settings", json("PUT", patch)),

  uploadImage: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ url: string }>("/admin/media", { method: "POST", body: form });
  },
};
