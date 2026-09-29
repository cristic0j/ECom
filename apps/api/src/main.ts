import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { configureApp } from "./configure-app";
import { env } from "./config/env";

async function bootstrap() {
  // rawBody: payment webhooks verify their signature against the exact bytes received
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);

  const docs = new DocumentBuilder()
    .setTitle("E-commerce API")
    .setVersion("1.0")
    .addCookieAuth("ecom_admin")
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, docs));

  await app.listen(env.API_PORT);
  console.log(`API ready on http://localhost:${env.API_PORT}/api (docs: /api/docs)`);
}

bootstrap();
