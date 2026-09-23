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
