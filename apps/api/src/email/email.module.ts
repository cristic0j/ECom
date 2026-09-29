import { Global, Inject, Injectable, Logger, Module } from "@nestjs/common";
import type { OrderDto } from "@ecom/shared";
import { storeConfig } from "@ecom/store-config";
import { env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.module";
import { createEmailProvider, EMAIL_PROVIDER, type EmailProvider } from "./email-provider";
import {
  newOrderAlertEmail,
  orderConfirmedEmail,
  orderReceivedEmail,
  orderStatusEmail,
  orderTrackingEmail,
  passwordResetEmail,
  type EmailStore,
  type RenderedEmail,
} from "./templates";

const siteUrl = (path: string) => `${env.SITE_URL.replace(/\/$/, "")}${path}`;

/**
 * Store emails. Sending happens in the background: a slow or failing email provider never
 * fails or delays the request that triggered it (failures are logged).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Manual payment: at checkout, "order received" (with payment instructions) to the customer and
   * the new-order alert to the store. With card payments nothing is sent at checkout; see orderPaidOnline.
   */
  orderPlaced(order: OrderDto, accessToken: string): void {
    this.queue(async () => {
      const store = await this.store();
      await this.deliver([order.email], orderReceivedEmail(store, order, orderUrl(order, accessToken)));
      await this.alertStaff(store, order, { paid: false });
    });
  }

  /**
   * Card payments: the payment webhook marked the order PAID. One "order confirmed" email to the
   * customer and the alert to the store; abandoned payments send nothing.
   */
  orderPaidOnline(order: OrderDto, accessToken: string): void {
    this.queue(async () => {
      const store = await this.store();
      await this.deliver([order.email], orderConfirmedEmail(store, order, orderUrl(order, accessToken)));
      await this.alertStaff(store, order, { paid: true });
    });
  }

  orderStatusChanged(order: OrderDto, accessToken: string): void {
    this.queue(async () => {
      const email = orderStatusEmail(await this.store(), order, orderUrl(order, accessToken));
      if (email) await this.deliver([order.email], email);
    });
  }

  /** Tracking added or changed after the order was marked shipped. */
  trackingUpdated(order: OrderDto, accessToken: string): void {
    this.queue(async () => {
      await this.deliver([order.email], orderTrackingEmail(await this.store(), order, orderUrl(order, accessToken)));
    });
  }

  passwordReset(to: string, token: string, validMinutes: number): void {
    this.queue(async () => {
      const url = siteUrl(`/account/reset-password?token=${encodeURIComponent(token)}`);
      await this.deliver([to], passwordResetEmail(await this.store(), url, validMinutes));
    });
  }

  /** Resolves once every queued email has been attempted. Used by tests. */
  async flush(): Promise<void> {
    while (this.inFlight.size) await Promise.all(this.inFlight);
  }

  private queue(job: () => Promise<void>): void {
    const p = job()
      .catch((err) => this.logger.error(`Email failed: ${err instanceof Error ? err.message : err}`))
      .finally(() => this.inFlight.delete(p));
    this.inFlight.add(p);
  }

  private async alertStaff(store: EmailStore, order: OrderDto, { paid }: { paid: boolean }): Promise<void> {
    const staff = await this.staffRecipients();
    if (staff.length) await this.deliver(staff, newOrderAlertEmail(store, order, siteUrl(`/admin/orders/${order.number}`), { paid }));
  }

  private deliver(to: string[], email: RenderedEmail): Promise<void> {
    return this.provider.send({ to, ...email });
  }

  private async store(): Promise<EmailStore> {
    const s = await this.settings.get();
    return {
      name: s.name ?? storeConfig.name,
      locale: s.locale ?? storeConfig.locale,
      paymentInstructions: s.paymentInstructions ?? storeConfig.paymentInstructions,
    };
  }

  /** ORDER_NOTIFY_EMAIL if set, otherwise every ADMIN user. */
  private async staffRecipients(): Promise<string[]> {
    const configured = env.ORDER_NOTIFY_EMAIL?.split(",").map((e) => e.trim()).filter(Boolean);
    if (configured?.length) return configured;
    const admins = await this.prisma.adminUser.findMany({ where: { role: "ADMIN" }, select: { email: true } });
    return admins.map((a) => a.email);
  }
}

function orderUrl(order: OrderDto, accessToken: string): string {
  return siteUrl(`/order/${order.number}?token=${encodeURIComponent(accessToken)}`);
}

@Global()
@Module({
  providers: [{ provide: EMAIL_PROVIDER, useFactory: createEmailProvider }, EmailService],
  exports: [EmailService],
})
export class EmailModule {}
