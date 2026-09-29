import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { hash, verify } from "@node-rs/argon2";
import type { Customer } from "@ecom/db";
import type { CustomerDto, CustomerRegisterInput, LoginInput, ResetPasswordInput } from "@ecom/shared";
import { env } from "../config/env";
import { EmailService } from "../email/email.module";
import { PrismaService } from "../prisma/prisma.service";
import type { CustomerJwtPayload } from "./customer-auth";

export const CUSTOMER_SESSION_DAYS = 30;
const RESET_LINK_MINUTES = 60;

/**
 * Reset tokens are signed with the current password hash mixed into the secret, so a token stops
 * working as soon as the password changes: each link works once, with no token table to clean up.
 */
const resetSecret = (c: Customer) => `${env.JWT_SECRET}:reset:${c.passwordHash}`;

// Verified against when the email is unknown, so response time doesn't reveal which emails exist
const DUMMY_HASH_PROMISE = hash("timing-safe-dummy-password");

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  async register({ email, password, name }: CustomerRegisterInput): Promise<{ token: string; customer: CustomerDto }> {
    const existing = await this.prisma.customer.findUnique({ where: { email } });
    if (existing) throw new ConflictException("An account with this email already exists. Try signing in.");
    const customer = await this.prisma.customer.create({ data: { email, name, passwordHash: await hash(password) } });
    return { token: await this.sign(customer), customer: toCustomerDto(customer) };
  }

  async login({ email, password }: LoginInput): Promise<{ token: string; customer: CustomerDto }> {
    const customer = await this.prisma.customer.findUnique({ where: { email: email.toLowerCase() } });
    const valid = await verify(customer?.passwordHash ?? (await DUMMY_HASH_PROMISE), password);
    if (!customer || !valid) throw new UnauthorizedException("Invalid email or password");
    return { token: await this.sign(customer), customer: toCustomerDto(customer) };
  }

  /** Emails a reset link if the account exists. The response is the same either way, so emails can't be probed. */
  async requestPasswordReset(email: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { email } });
    if (!customer) return;
    const token = await this.jwt.signAsync(
      { sub: customer.id, typ: "password-reset" },
      { secret: resetSecret(customer), expiresIn: `${RESET_LINK_MINUTES}m` },
    );
    this.email.passwordReset(customer.email, token, RESET_LINK_MINUTES);
  }

  /** Sets the new password and signs the customer in. */
  async resetPassword({ token, password }: ResetPasswordInput): Promise<{ token: string; customer: CustomerDto }> {
    const invalid = new BadRequestException("This reset link is invalid or has expired. Please request a new one.");
    const claimed = this.jwt.decode<{ sub?: unknown } | null>(token);
    const customer =
      typeof claimed?.sub === "string" ? await this.prisma.customer.findUnique({ where: { id: claimed.sub } }) : null;
    if (!customer) throw invalid;
    try {
      const payload = await this.jwt.verifyAsync<{ typ?: string }>(token, { secret: resetSecret(customer) });
      if (payload.typ !== "password-reset") throw invalid;
    } catch {
      throw invalid;
    }
    // Guarded on the old hash so the same link can't be used twice at once
    const { count } = await this.prisma.customer.updateMany({
      where: { id: customer.id, passwordHash: customer.passwordHash },
      data: { passwordHash: await hash(password) },
    });
    if (count === 0) throw invalid;
    return { token: await this.sign(customer), customer: toCustomerDto(customer) };
  }

  async getById(id: string): Promise<CustomerDto | null> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    return customer ? toCustomerDto(customer) : null;
  }

  private sign(customer: Customer): Promise<string> {
    const payload: CustomerJwtPayload = { sub: customer.id, typ: "customer" };
    return this.jwt.signAsync(payload, { expiresIn: `${CUSTOMER_SESSION_DAYS}d` });
  }
}

export function toCustomerDto(c: Customer): CustomerDto {
  return { id: c.id, email: c.email, name: c.name };
}
