import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { hash, verify } from "@node-rs/argon2";
import type { AdminUser } from "@ecom/db";
import type { AdminUserDto, LoginInput } from "@ecom/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface AdminJwtPayload {
  sub: string;
  role: AdminUser["role"];
}

// Verified against when the email is unknown, so response time doesn't reveal which emails exist
const DUMMY_HASH_PROMISE = hash("timing-safe-dummy-password");

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login({ email, password }: LoginInput): Promise<{ token: string; user: AdminUserDto }> {
    const user = await this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    const valid = await verify(user?.passwordHash ?? (await DUMMY_HASH_PROMISE), password);
    if (!user || !valid) throw new UnauthorizedException("Invalid email or password");

    const payload: AdminJwtPayload = { sub: user.id, role: user.role };
    return { token: await this.jwt.signAsync(payload), user: toAdminUserDto(user) };
  }

  async getUser(id: string): Promise<AdminUserDto | null> {
    const user = await this.prisma.adminUser.findUnique({ where: { id } });
    return user ? toAdminUserDto(user) : null;
  }
}

export function toAdminUserDto(u: AdminUser): AdminUserDto {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}
