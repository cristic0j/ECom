import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env";

/** Pluggable media storage. Add new drivers (e.g. GCS) by implementing this interface. */
export interface StorageDriver {
  /** Stores the object and returns its public URL. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
}

export class LocalStorageDriver implements StorageDriver {
  private readonly root = join(process.cwd(), "uploads");

  async put(key: string, body: Buffer): Promise<string> {
    const path = join(this.root, key);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, body);
    return `${env.API_PUBLIC_URL}/uploads/${key}`;
  }
}

export class S3StorageDriver implements StorageDriver {
  private readonly client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(env.S3_ENDPOINT),
    credentials: { accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY! },
  });

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return `${env.S3_PUBLIC_URL!.replace(/\/$/, "")}/${key}`;
  }
}

export const STORAGE_DRIVER = Symbol("STORAGE_DRIVER");

export function createStorageDriver(): StorageDriver {
  return env.STORAGE_DRIVER === "s3" ? new S3StorageDriver() : new LocalStorageDriver();
}
