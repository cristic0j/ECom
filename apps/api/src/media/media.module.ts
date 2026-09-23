import { Module } from "@nestjs/common";
import { MediaController } from "./media.controller";
import { createStorageDriver, STORAGE_DRIVER } from "./storage";

@Module({
  controllers: [MediaController],
  providers: [{ provide: STORAGE_DRIVER, useFactory: createStorageDriver }],
})
export class MediaModule {}
