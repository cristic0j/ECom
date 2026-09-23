import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module";
import { AdminCategoriesController, AdminProductsController } from "./admin.controllers";
import { AdminProductsService } from "./admin-products.service";
import { AdminCategoriesService } from "./admin-categories.service";

@Module({
  imports: [CatalogModule],
  controllers: [AdminProductsController, AdminCategoriesController],
  providers: [AdminProductsService, AdminCategoriesService],
})
export class AdminModule {}
