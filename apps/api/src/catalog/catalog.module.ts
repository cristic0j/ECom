import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller";
import { ProductsService } from "./products.service";
import { CategoriesService } from "./categories.service";

@Module({
  controllers: [CatalogController],
  providers: [ProductsService, CategoriesService],
  exports: [ProductsService, CategoriesService],
})
export class CatalogModule {}
