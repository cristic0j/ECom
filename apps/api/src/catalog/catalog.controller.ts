import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { productListQuerySchema, type ProductListQuery } from "@ecom/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ProductsService } from "./products.service";
import { CategoriesService } from "./categories.service";

/** Public, unauthenticated storefront endpoints. Only ACTIVE products are ever returned. */
@ApiTags("catalog")
@Controller("catalog")
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
  ) {}

  @Get("products")
  listProducts(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.products.list({ ...query, status: "ACTIVE" });
  }

  @Get("products/slugs")
  productSlugs() {
    return this.products.activeSlugs();
  }

  @Get("products/:slug")
  getProduct(@Param("slug") slug: string) {
    return this.products.getBySlug(slug, "ACTIVE");
  }

  @Get("categories")
  listCategories() {
    return this.categories.tree();
  }

  @Get("categories/:slug")
  getCategory(@Param("slug") slug: string) {
    return this.categories.getBySlug(slug);
  }
}
