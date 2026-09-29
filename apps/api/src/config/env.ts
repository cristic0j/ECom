import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.string().default("development"),
    DATABASE_URL: z.string().min(1),
    API_PORT: z.coerce.number().default(4000),
    API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
    WEB_ORIGIN: z.string().default("http://localhost:3000"),
    JWT_SECRET: z.string().min(8),
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_PUBLIC_URL: z.string().optional(),
    /** Public storefront URL, used for links in emails */
    SITE_URL: z.string().url().default("http://localhost:3000"),
    EMAIL_DRIVER: z.enum(["console", "resend"]).default("console"),
    RESEND_API_KEY: z.string().optional(),
    /** Sender, e.g. "Demo Store <orders@shop.example.com>"; the domain must be verified with the provider */
    EMAIL_FROM: z.string().default("Store <orders@example.com>"),
    /** Where replies to store emails go; empty = the sender address */
    EMAIL_REPLY_TO: z.string().optional(),
    /** Comma-separated; who gets "new order" alerts. Empty = every ADMIN user */
    ORDER_NOTIFY_EMAIL: z.string().optional(),
    /** Required when `features.payments` is on. sk_test_… locally, sk_live_… in production */
    STRIPE_SECRET_KEY: z.string().optional(),
    /** whsec_…: from `stripe listen` locally, or the webhook endpoint in the Stripe dashboard */
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
  })
  .refine(
    (e) => e.NODE_ENV !== "production" || (e.JWT_SECRET.length >= 32 && !e.JWT_SECRET.startsWith("change-me")),
    "In production JWT_SECRET must be a random string of at least 32 characters (e.g. `openssl rand -base64 48`)",
  )
  .refine(
    (e) => e.STORAGE_DRIVER !== "s3" || (e.S3_BUCKET && e.S3_ACCESS_KEY && e.S3_SECRET_KEY && e.S3_PUBLIC_URL),
    "STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY and S3_PUBLIC_URL",
  )
  .refine(
    (e) => e.EMAIL_DRIVER !== "resend" || (e.RESEND_API_KEY && !e.EMAIL_FROM.includes("example.com")),
    "EMAIL_DRIVER=resend requires RESEND_API_KEY and a real EMAIL_FROM address",
  );

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten());
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
