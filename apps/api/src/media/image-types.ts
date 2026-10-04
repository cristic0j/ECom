import { randomUUID } from "node:crypto";
import { ALLOWED_IMAGE_TYPES } from "@ecom/shared";

export type ImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const IMAGE_EXTENSIONS: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

// Magic-byte checks so a renamed non-image can't be uploaded by lying about Content-Type
const SIGNATURES: Record<ImageType, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b.subarray(0, 4).toString("ascii") === "GIF8",
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  "image/avif": (b) => b.subarray(4, 8).toString("ascii") === "ftyp",
};

/** True when the bytes really are an image of the claimed type. */
export const matchesImageType = (type: string, body: Buffer): type is ImageType =>
  type in SIGNATURES && SIGNATURES[type as ImageType](body);

/** The image type the bytes start with, or null for anything that isn't an allowed image. */
export const sniffImageType = (body: Buffer): ImageType | null =>
  ALLOWED_IMAGE_TYPES.find((type) => SIGNATURES[type](body)) ?? null;

/** Storage key for a product image, e.g. products/2026/10/<uuid>.jpg */
export function productImageKey(type: ImageType, now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `products/${now.getUTCFullYear()}/${month}/${randomUUID()}.${IMAGE_EXTENSIONS[type]}`;
}
