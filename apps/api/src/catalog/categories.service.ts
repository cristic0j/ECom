import { Injectable, NotFoundException } from "@nestjs/common";
import type { CategoryDto } from "@ecom/shared";
import { PrismaService } from "../prisma/prisma.service";
import { buildCategoryTree, toCategoryDto } from "./mappers";

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private findAllSorted() {
    return this.prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  }

  async tree(): Promise<CategoryDto[]> {
    return buildCategoryTree(await this.findAllSorted());
  }

  async flat(): Promise<CategoryDto[]> {
    return (await this.findAllSorted()).map(toCategoryDto);
  }

  async getBySlug(slug: string): Promise<CategoryDto> {
    const all = await this.findAllSorted();
    const node = all.find((c) => c.slug === slug);
    if (!node) throw new NotFoundException("Category not found");
    return {
      ...toCategoryDto(node),
      children: all.filter((c) => c.parentId === node.id).map(toCategoryDto),
    };
  }
}
