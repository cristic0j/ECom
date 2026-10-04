import {
  BadRequestException,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@ecom/shared";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { STORAGE_DRIVER, type StorageDriver } from "./storage";
import { matchesImageType, productImageKey } from "./image-types";

@ApiTags("admin")
@ApiCookieAuth()
@UseGuards(AdminAuthGuard)
@Controller("admin/media")
export class MediaController {
  constructor(@Inject(STORAGE_DRIVER) private readonly storage: StorageDriver) {}

  @Post()
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Missing "file" field');
    const type = file.mimetype;
    if (!matchesImageType(type, file.buffer)) {
      throw new BadRequestException(`Only ${ALLOWED_IMAGE_TYPES.join(", ")} images are allowed`);
    }

    const url = await this.storage.put(productImageKey(type), file.buffer, type);
    return { url };
  }
}
