import { createHmac, timingSafeEqual } from "node:crypto";

export type PaymentOrderInput = { reference: string; amountPaise: bigint; currency: "INR" };
export type PaymentOrder = { providerOrderId: string; reference: string; amountPaise: bigint; currency: "INR" };
export type ProviderEvent = { eventId: string; orderId: string; paymentId: string; outcome: "SUCCEEDED" | "FAILED" };

/** Provider contract; no production provider is configured in Phase 6's gated slice. */
export interface DonationPaymentProvider {
  createOrder(input: PaymentOrderInput): Promise<PaymentOrder>;
  verifyWebhook(rawBody: string, signature: string): ProviderEvent;
}

export class PaymentUnavailableError extends Error {
  constructor() { super("Online donation collection is disabled until a provider and finance posting policy are approved."); this.name = "PaymentUnavailableError"; }
}

export function getLiveDonationProvider(): DonationPaymentProvider {
  throw new PaymentUnavailableError();
}

/** Explicit test adapter. It has no checkout endpoint and is rejected in production. */
export class MockSandboxProvider implements DonationPaymentProvider {
  constructor(private readonly secret: string, private readonly production = process.env.NODE_ENV === "production") {
    if (production || secret.length < 16) throw new Error("Mock payment provider is available only in non-production test contexts.");
  }

  async createOrder(input: PaymentOrderInput): Promise<PaymentOrder> {
    if (input.amountPaise <= BigInt(0) || input.currency !== "INR") throw new Error("Invalid sandbox order.");
    return { providerOrderId: `sandbox_${input.reference}`, ...input };
  }

  verifyWebhook(rawBody: string, signature: string): ProviderEvent {
    const expected = createHmac("sha256", this.secret).update(rawBody).digest();
    let supplied: Buffer;
    try { supplied = Buffer.from(signature, "hex"); } catch { throw new Error("Invalid sandbox signature."); }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid sandbox signature.");
    const value: unknown = JSON.parse(rawBody);
    if (!value || typeof value !== "object") throw new Error("Invalid sandbox event.");
    const event = value as Partial<ProviderEvent>;
    if (typeof event.eventId !== "string" || !event.eventId || typeof event.orderId !== "string" || !event.orderId || typeof event.paymentId !== "string" || !event.paymentId || (event.outcome !== "SUCCEEDED" && event.outcome !== "FAILED")) throw new Error("Invalid sandbox event.");
    return event as ProviderEvent;
  }

  signForTest(rawBody: string): string { return createHmac("sha256", this.secret).update(rawBody).digest("hex"); }
}
