import type { Address, OrderStatus, PaymentStatus } from "./schemas";

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
  inStock: boolean;
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
  /** "out" when no variant can be bought, "partial" when some can't */
  stock: "in" | "partial" | "out";
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
  /** Out-of-stock lines stay in the cart but aren't counted in the totals and block checkout */
  inStock: boolean;
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
  trackingNumber: string;
  trackingUrl: string;
  items: OrderItemDto[];
  /** Admin views only */
  events?: OrderEventDto[];
  /** Admin views only */
  payments?: PaymentDto[];
}

export interface PaymentDto {
  id: string;
  provider: string;
  providerRef: string;
  chargeRef: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
}

/** Returned by checkout; the token lets a guest open their confirmation page. */
export interface CheckoutResultDto {
  number: number;
  accessToken: string;
  /** Card payments on: the provider's payment page to send the customer to (null if it couldn't be created) */
  paymentUrl: string | null;
}

export interface PayOrderResultDto {
  paymentUrl: string;
}

export interface SupplierConnectionDto {
  /** The app keys are in the API's environment */
  configured: boolean;
  /** Connected, and the connection hasn't run out */
  connected: boolean;
  /** Connected once, but the connection ran out: connect again */
  expired: boolean;
  account: string | null;
  connectedBy: string | null;
  connectedAt: string | null;
  /** When the owner will have to connect again */
  expiresAt: string | null;
}
