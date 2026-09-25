import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { hash, verify } from "@node-rs/argon2";
import type { Customer } from "@ecom/db";
import type { CustomerDto, CustomerRegisterInput, LoginInput } from "@ecom/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { CustomerJwtPayload } from "./customer-auth";

export const CUSTOMER_SESSION_DAYS = 30;

// Verified against when the email is unknown, so response time doesn't reveal which emails exist
const DUMMY_HASH_PROMISE = hash("timing-safe-dummy-password");

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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
