import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-256-GCM for supplier tokens at rest. The key comes from a secret, so a database copy alone can't use them. */
export class TokenCrypto {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash("sha256").update(`supplier-tokens:${secret}`).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
  }

  /** Null when the value was encrypted with another secret or has been altered. */
  decrypt(value: string): string | null {
    const [version, iv, tag, data] = value.split(".");
    if (version !== "v1" || !iv || !tag || data === undefined) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }
}
