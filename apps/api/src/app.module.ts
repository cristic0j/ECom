import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { CatalogModule } from "./catalog/catalog.module";
import { AdminModule } from "./admin/admin.module";
import { MediaModule } from "./media/media.module";
import { SettingsModule } from "./settings/settings.module";
import { CommerceModule } from "./commerce/commerce.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuthModule,
    CatalogModule,
    AdminModule,
    MediaModule,
    SettingsModule,
    CommerceModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
