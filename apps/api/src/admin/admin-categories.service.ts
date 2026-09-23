import { BadRequestException, Injectable } from "@nestjs/common";
import type { CategoryDto, CategoryInput } from "@ecom/shared";
import { PrismaService } from "../prisma/prisma.service";
import { collectDescendantIds, toCategoryDto } from "../catalog/mappers";

@Injectable()
export class AdminCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CategoryInput): Promise<CategoryDto> {
    return toCategoryDto(await this.prisma.category.create({ data: input }));
  }

  async update(id: string, input: CategoryInput): Promise<CategoryDto> {
    if (input.parentId) {
      const all = await this.prisma.category.findMany();
      if (collectDescendantIds(all, id).includes(input.parentId)) {
        throw new BadRequestException("A category cannot be moved under itself or one of its children");
      }
    }
    return toCategoryDto(await this.prisma.category.update({ where: { id }, data: input }));
  }

  /** Children are re-attached to the root (onDelete: SetNull); product links are removed. */
  async remove(id: string): Promise<void> {
    await this.prisma.category.delete({ where: { id } });
  }
}
