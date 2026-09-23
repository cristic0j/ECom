import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { join } from "node:path";
import { env } from "./config/env";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";

/** Shared between main.ts and e2e tests so both run the same middleware stack. */
export function configureApp(app: NestExpressApplication) {
  app.setGlobalPrefix("api");
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_ORIGIN.split(","), credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  if (env.STORAGE_DRIVER === "local") {
    app.useStaticAssets(join(process.cwd(), "uploads"), {
      prefix: "/uploads",
      maxAge: "7d",
      setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
    });
  }
}
