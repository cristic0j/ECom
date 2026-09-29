import type { OrderDto } from "@ecom/shared";
import { escapeHtml, newOrderAlertEmail, orderReceivedEmail, orderStatusEmail, passwordResetEmail } from "./templates";

const store = { name: "Demo <Store>", locale: "en-US", paymentInstructions: "Pay by bank transfer to IBAN DE00." };

const order = (overrides: Partial<OrderDto> = {}): OrderDto => ({
  id: "o1",
  number: 1001,
  email: "ada@example.com",
  status: "PENDING",
  currency: "EUR",
  totalMinor: 5499,
  itemCount: 2,
  createdAt: "2026-09-27T10:00:00.000Z",
  customerId: null,
  subtotalMinor: 5000,
  shippingMinor: 499,
  shippingAddress: {
    name: "Ada <script>Lovelace",
    line1: "1 Main St",
    line2: "",
    city: "Berlin",
    postalCode: "10115",
    country: "DE",
    phone: "",
  },
  note: "",
  items: [
    {
      id: "i1",
      variantId: "v1",
      productTitle: "Tee & Co",
      variantTitle: "M",
      sku: "TEE-M",
      unitPriceMinor: 2500,
      quantity: 2,
      lineTotalMinor: 5000,
    },
  ],
  ...overrides,
});

describe("email templates", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("renders the order confirmation with totals, payment instructions and link", () => {
    const email = orderReceivedEmail(store, order(), "https://shop.test/order/1001?token=abc");
    expect(email.subject).toBe("Order #1001 received");
    expect(email.text).toContain("Hi Ada,");
    expect(email.text).toContain("2 × Tee & Co (M)  €50.00");
    expect(email.text).toContain("Shipping  €4.99");
    expect(email.text).toContain("Total  €54.99");
    expect(email.text).toContain("Pay by bank transfer to IBAN DE00.");
    expect(email.text).toContain("View your order: https://shop.test/order/1001?token=abc");
    // Customer-entered and catalog text is escaped in the HTML version
    expect(email.html).toContain("Tee &amp; Co");
    expect(email.html).toContain("Demo &lt;Store&gt;");
    expect(email.html).not.toContain("<script>");
  });

  it("leaves out empty payment instructions and says free shipping", () => {
    const email = orderReceivedEmail({ ...store, paymentInstructions: "" }, order({ shippingMinor: 0 }), "https://x");
    expect(email.text).not.toContain("IBAN");
    expect(email.text).toContain("Shipping  Free");
  });

  it("includes the customer note in the store alert", () => {
    const email = newOrderAlertEmail(store, order({ note: "Leave at the door" }), "https://shop.test/admin/orders/1001");
    expect(email.subject).toBe("New order #1001 from ada@example.com");
    expect(email.text).toContain("Customer note: Leave at the door");
  });

  it("only emails the customer for statuses they care about", () => {
    expect(orderStatusEmail(store, order({ status: "PENDING" }), "https://x")).toBeNull();
    expect(orderStatusEmail(store, order({ status: "PAID" }), "https://x")?.subject).toBe("Payment received for order #1001");
    expect(orderStatusEmail(store, order({ status: "FULFILLED" }), "https://x")?.subject).toBe("Order #1001 has shipped");
    expect(orderStatusEmail(store, order({ status: "CANCELLED" }), "https://x")?.subject).toBe("Order #1001 was cancelled");
    expect(orderStatusEmail(store, order({ status: "REFUNDED" }), "https://x")?.subject).toBe("Order #1001 was refunded");
  });

  it("renders the password reset link", () => {
    const email = passwordResetEmail(store, "https://shop.test/account/reset-password?token=t", 60);
    expect(email.text).toContain("Choose a new password: https://shop.test/account/reset-password?token=t");
    expect(email.text).toContain("expires in 60 minutes");
  });
});
