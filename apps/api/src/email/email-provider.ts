import { Logger } from "@nestjs/common";
import { env } from "../config/env";

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/** Pluggable email delivery. Add new providers (e.g. Postmark, SMTP) by implementing this interface. */
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/** Local development: prints the email instead of sending it, so links (e.g. password reset) can be clicked. */
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger("Email");

  async send({ to, subject, text }: EmailMessage): Promise<void> {
    this.logger.log(`\n  To: ${to.join(", ")}\n  Subject: ${subject}\n\n${text.replace(/^/gm, "  ")}\n`);
  }
}

export class ResendEmailProvider implements EmailProvider {
  async send({ to, subject, html, text }: EmailMessage): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to,
        subject,
        html,
        text,
        ...(env.EMAIL_REPLY_TO && { reply_to: env.EMAIL_REPLY_TO }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");

export function createEmailProvider(): EmailProvider {
  if (env.EMAIL_DRIVER === "resend") return new ResendEmailProvider();
  if (env.NODE_ENV === "production") {
    new Logger("Email").warn("EMAIL_DRIVER is console: emails are only logged, customers won't receive them");
  }
  return new ConsoleEmailProvider();
}
