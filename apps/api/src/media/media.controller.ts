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
import { randomUUID } from "node:crypto";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@ecom/shared";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { STORAGE_DRIVER, type StorageDriver } from "./storage";

const EXTENSIONS: Record<(typeof ALLOWED_IMAGE_TYPES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

// Magic-byte checks so a renamed non-image can't be uploaded by lying about Content-Type
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b.subarray(0, 4).toString("ascii") === "GIF8",
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  "image/avif": (b) => b.subarray(4, 8).toString("ascii") === "ftyp",
};

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
    const type = file.mimetype as keyof typeof EXTENSIONS;
    if (!EXTENSIONS[type] || !SIGNATURES[type]?.(file.buffer)) {
      throw new BadRequestException(`Only ${ALLOWED_IMAGE_TYPES.join(", ")} images are allowed`);
    }

    const now = new Date();
    const key = `products/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${EXTENSIONS[type]}`;
    const url = await this.storage.put(key, file.buffer, type);
    return { url };
  }
}
