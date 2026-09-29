import { formatMoney, type OrderDto } from "@ecom/shared";

/** Store details every email needs; admin settings layered over store.config.ts. */
export interface EmailStore {
  name: string;
  locale: string;
  paymentInstructions: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** One email, rendered to both HTML and plain text from the same blocks. */
type Block =
  | { p: string }
  | { button: string; href: string }
  | { order: OrderDto; locale: string }
  | { address: OrderDto["shippingAddress"] };

function render(store: EmailStore, subject: string, blocks: Block[]): RenderedEmail {
  const html: string[] = [];
  const text: string[] = [];
  for (const b of blocks) {
    if ("p" in b) {
      html.push(`<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(b.p).replace(/\n/g, "<br>")}</p>`);
      text.push(b.p);
    } else if ("button" in b) {
      html.push(
        `<p style="margin:0 0 16px"><a href="${escapeHtml(b.href)}" style="display:inline-block;background:#111827;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(b.button)}</a></p>`,
      );
      text.push(`${b.button}: ${b.href}`);
    } else if ("order" in b) {
      const { order, locale } = b;
      const money = (m: number) => formatMoney(m, order.currency, locale);
      const row = (label: string, value: string, bold = false) =>
        `<tr><td style="padding:6px 0;${bold ? "font-weight:600" : ""}">${label}</td><td style="padding:6px 0;text-align:right;white-space:nowrap;${bold ? "font-weight:600" : ""}">${value}</td></tr>`;
      const lines = order.items.map((i) => {
        const title = i.variantTitle === "Default" ? i.productTitle : `${i.productTitle} (${i.variantTitle})`;
        return { title: `${i.quantity} × ${title}`, amount: money(i.lineTotalMinor) };
      });
      const shipping = order.shippingMinor === 0 ? "Free" : money(order.shippingMinor);
      html.push(
        `<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 16px;border-top:1px solid #e5e7eb">` +
          lines.map((l) => row(escapeHtml(l.title), l.amount)).join("") +
          `<tr><td colspan="2" style="border-top:1px solid #e5e7eb"></td></tr>` +
          row("Subtotal", money(order.subtotalMinor)) +
          row("Shipping", shipping) +
          row("Total", money(order.totalMinor), true) +
          `</table>`,
      );
      text.push(
        [
          ...lines.map((l) => `${l.title}  ${l.amount}`),
          `Subtotal  ${money(order.subtotalMinor)}`,
          `Shipping  ${shipping}`,
          `Total  ${money(order.totalMinor)}`,
        ].join("\n"),
      );
    } else {
      const a = b.address;
      const lines = [a.name, a.line1, a.line2, `${a.postalCode} ${a.city}`, a.country, a.phone].filter(Boolean);
      html.push(
        `<p style="margin:0 0 16px;line-height:1.5"><strong>Shipping to</strong><br>${lines.map(escapeHtml).join("<br>")}</p>`,
      );
      text.push(`Shipping to:\n${lines.join("\n")}`);
    }
  }
  const name = escapeHtml(store.name);
  return {
    subject,
    html:
      `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">` +
      `<div style="max-width:560px;margin:0 auto;padding:24px 16px">` +
      `<p style="margin:0 0 16px;font-size:18px;font-weight:700">${name}</p>` +
      `<div style="background:#fff;border-radius:8px;padding:24px;font-size:15px">${html.join("")}</div>` +
      `</div></body></html>`,
    text: `${text.join("\n\n")}\n\n— ${store.name}`,
  };
}

const greeting = (order: OrderDto) => `Hi ${order.shippingAddress.name.split(" ")[0] || "there"},`;

/** Manual payment: sent at checkout, with the store's payment instructions. */
export function orderReceivedEmail(store: EmailStore, order: OrderDto, orderUrl: string): RenderedEmail {
  return render(store, `Order #${order.number} received`, [
    { p: greeting(order) },
    { p: `Thank you for your order. Here's a summary of order #${order.number}.` },
    ...(store.paymentInstructions ? [{ p: store.paymentInstructions }] : []),
    { order, locale: store.locale },
    { address: order.shippingAddress },
    { button: "View your order", href: orderUrl },
  ]);
}

/** Card payments: the only email for a new order, sent once the payment has gone through. */
export function orderConfirmedEmail(store: EmailStore, order: OrderDto, orderUrl: string): RenderedEmail {
  return render(store, `Order #${order.number} confirmed`, [
    { p: greeting(order) },
    { p: `Thank you, we've received your payment. Here's a summary of order #${order.number}. We'll email you again when it ships.` },
    { order, locale: store.locale },
    { address: order.shippingAddress },
    { button: "View your order", href: orderUrl },
  ]);
}

export function newOrderAlertEmail(
  store: EmailStore,
  order: OrderDto,
  adminUrl: string,
  { paid }: { paid: boolean },
): RenderedEmail {
  return render(store, `New order #${order.number} from ${order.email}`, [
    {
      p: paid
        ? `${order.email} placed and paid order #${order.number}. It's ready to ship.`
        : `${order.email} placed order #${order.number}. It's waiting for payment.`,
    },
    ...(order.note ? [{ p: `Customer note: ${order.note}` }] : []),
    { order, locale: store.locale },
    { address: order.shippingAddress },
    { button: "Open in admin", href: adminUrl },
  ]);
}

/** The customer email for a status change, or null when that change doesn't warrant one. */
export function orderStatusEmail(store: EmailStore, order: OrderDto, orderUrl: string): RenderedEmail | null {
  const n = order.number;
  const message = {
    PAID: [`Payment received for order #${n}`, "We've received your payment. We'll let you know when your order ships."],
    FULFILLED: [`Order #${n} has shipped`, "Good news: your order is on its way."],
    CANCELLED: [`Order #${n} was cancelled`, "Your order has been cancelled. If you have questions, just reply to this email."],
    REFUNDED: [`Order #${n} was refunded`, "Your order has been refunded. It can take a few days to show up on your account."],
  }[order.status as string];
  if (!message) return null;
  const [subject, body] = message;
  const shipped = order.status === "FULFILLED";
  return render(store, subject, [
    { p: greeting(order) },
    { p: body },
    ...(shipped ? trackingBlocks(order) : []),
    { order, locale: store.locale },
    shipped && order.trackingUrl
      ? { button: "Track your package", href: order.trackingUrl }
      : { button: "View your order", href: orderUrl },
    ...(shipped && order.trackingUrl ? [{ p: `Your order page: ${orderUrl}` }] : []),
  ]);
}

/** Sent when tracking is added or changed after the order was marked shipped. */
export function orderTrackingEmail(store: EmailStore, order: OrderDto, orderUrl: string): RenderedEmail {
  return render(store, `Tracking for order #${order.number}`, [
    { p: greeting(order) },
    { p: "Here are the tracking details for your order." },
    ...trackingBlocks(order),
    order.trackingUrl ? { button: "Track your package", href: order.trackingUrl } : { button: "View your order", href: orderUrl },
  ]);
}

const trackingBlocks = (order: OrderDto) => (order.trackingNumber ? [{ p: `Tracking number: ${order.trackingNumber}` }] : []);

export function passwordResetEmail(store: EmailStore, resetUrl: string, validMinutes: number): RenderedEmail {
  return render(store, `Reset your ${store.name} password`, [
    { p: "Someone asked to reset the password for your account. If that was you, use the button below." },
    { button: "Choose a new password", href: resetUrl },
    { p: `The link works once and expires in ${validMinutes} minutes. If you didn't ask for this, you can ignore this email.` },
  ]);
}
