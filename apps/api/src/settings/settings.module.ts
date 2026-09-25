import { Body, Controller, Get, Global, Injectable, Module, Put, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { Prisma } from "@ecom/db";
import { storeSettingsSchema, type ShippingRules, type StoreSettings } from "@ecom/shared";
import { storeConfig } from "@ecom/store-config";
import { PrismaService } from "../prisma/prisma.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, Roles } from "../auth/admin-auth.guard";

const SETTINGS_KEY = "store";

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<StoreSettings> {
    const row = await this.prisma.storeSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const parsed = storeSettingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : {};
  }

  /** What checkout needs: admin settings layered over store.config.ts defaults. */
  async commerce(): Promise<{ currency: string; shipping: ShippingRules }> {
    const s = await this.get();
    return {
      currency: s.currency ?? storeConfig.currency,
      shipping: { ...storeConfig.shipping, ...s.shipping },
    };
  }

  /** Merges the patch over current settings; theme and shipping are merged one level deep. */
  async update(patch: StoreSettings): Promise<StoreSettings> {
    const current = await this.get();
    const next: StoreSettings = {
      ...current,
      ...patch,
      theme: { ...current.theme, ...patch.theme },
      shipping: { ...current.shipping, ...patch.shipping },
    };
    const value = next as Prisma.InputJsonValue;
    await this.prisma.storeSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value },
      update: { value },
    });
    return next;
  }
}

@ApiTags("settings")
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Public: storefront merges these over store.config.ts defaults. */
  @Get("settings")
  get() {
    return this.settings.get();
  }

  @Put("admin/settings")
  @ApiCookieAuth()
  @UseGuards(AdminAuthGuard)
  @Roles("ADMIN")
  update(@Body(new ZodValidationPipe(storeSettingsSchema)) body: StoreSettings) {
    return this.settings.update(body);
  }
}

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
