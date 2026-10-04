import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  adminProductListQuerySchema,
  categoryInputSchema,
  productInputSchema,
  productStatusSchema,
  type AdminProductListQuery,
  type CategoryInput,
  type ProductInput,
} from "@ecom/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, Roles } from "../auth/admin-auth.guard";
import { ProductsService } from "../catalog/products.service";
import { CategoriesService } from "../catalog/categories.service";
import { AdminProductsService } from "./admin-products.service";
import { AdminCategoriesService } from "./admin-categories.service";

const statusBodySchema = z.object({ status: productStatusSchema });

@ApiTags("admin")
@ApiCookieAuth()
@UseGuards(AdminAuthGuard)
@Controller("admin/products")
export class AdminProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly admin: AdminProductsService,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(adminProductListQuerySchema)) query: AdminProductListQuery) {
    return this.products.list(query);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.products.getAdminById(id);
  }

  @Post()
  create(@Body(new ZodValidationPipe(productInputSchema)) body: ProductInput) {
    return this.admin.create(body);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(productInputSchema)) body: ProductInput) {
    return this.admin.update(id, body);
  }

  @Patch(":id/status")
  setStatus(@Param("id") id: string, @Body(new ZodValidationPipe(statusBodySchema)) body: z.infer<typeof statusBodySchema>) {
    return this.admin.setStatus(id, body.status);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("ADMIN")
  remove(@Param("id") id: string) {
    return this.admin.remove(id);
  }
}

@ApiTags("admin")
@ApiCookieAuth()
@UseGuards(AdminAuthGuard)
@Controller("admin/categories")
export class AdminCategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly admin: AdminCategoriesService,
  ) {}

  @Get()
  list() {
    return this.categories.flat();
  }

  @Post()
  create(@Body(new ZodValidationPipe(categoryInputSchema)) body: CategoryInput) {
    return this.admin.create(body);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(categoryInputSchema)) body: CategoryInput) {
    return this.admin.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("ADMIN")
  remove(@Param("id") id: string) {
    return this.admin.remove(id);
  }
}
