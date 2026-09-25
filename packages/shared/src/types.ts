import type { Address, OrderStatus } from "./schemas";

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface CategoryDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  children?: CategoryDto[];
}

export interface VariantDto {
  id: string;
  sku: string;
  title: string;
  priceMinor: number;
  compareAtMinor: number | null;
  options: Record<string, string>;
  isDefault: boolean;
}

export interface ImageDto {
  id: string;
  url: string;
  alt: string;
  variantId: string | null;
}

export interface ProductSummaryDto {
  id: string;
  slug: string;
  title: string;
  status: ProductStatus;
  priceMinor: number;
  compareAtMinor: number | null;
  image: ImageDto | null;
}

export interface ProductDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: ProductStatus;
  attributes: Record<string, string>;
  categories: Pick<CategoryDto, "id" | "slug" | "name">[];
  variants: VariantDto[];
  images: ImageDto[];
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "EDITOR";
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

// ---- Customers, cart, checkout, orders ----


export interface CustomerDto {
  id: string;
  email: string;
  name: string;
}

export interface CartItemDto {
  id: string;
  variantId: string;
  quantity: number;
  productSlug: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
  image: ImageDto | null;
}

export interface CartDto {
  items: CartItemDto[];
  itemCount: number;
  subtotalMinor: number;
  shippingMinor: number;
  totalMinor: number;
  currency: string;
  /** Subtotal needed for free shipping; null when it never applies */
  freeShippingOverMinor: number | null;
}

export interface OrderItemDto {
  id: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string;
  sku: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
}

export interface OrderEventDto {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actor: string;
  note: string;
  createdAt: string;
}

export interface OrderSummaryDto {
  id: string;
  number: number;
  email: string;
  status: OrderStatus;
  currency: string;
  totalMinor: number;
  itemCount: number;
  createdAt: string;
}

export interface OrderDto extends OrderSummaryDto {
  customerId: string | null;
  subtotalMinor: number;
  shippingMinor: number;
  shippingAddress: Address;
  note: string;
  items: OrderItemDto[];
  /** Admin views only */
  events?: OrderEventDto[];
}

/** Returned by checkout; the token lets a guest open their confirmation page. */
export interface CheckoutResultDto {
  number: number;
  accessToken: string;
}
