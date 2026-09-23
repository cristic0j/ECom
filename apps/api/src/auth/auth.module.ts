import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { env } from "../config/env";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AdminAuthGuard } from "./admin-auth.guard";

@Global()
@Module({
  imports: [JwtModule.register({ secret: env.JWT_SECRET, signOptions: { expiresIn: "7d" } })],
  controllers: [AuthController],
  providers: [AuthService, AdminAuthGuard],
  exports: [AuthService, AdminAuthGuard, JwtModule],
})
export class AuthModule {}
