import assert from "node:assert/strict";
import test from "node:test";
import { MockSandboxProvider, PaymentUnavailableError, getLiveDonationProvider } from "./provider";

test("mock sandbox verifies an authentic event and rejects altered bodies", () => {
  const provider = new MockSandboxProvider("test-only-secret-123456");
  const body = JSON.stringify({ eventId: "evt_1", orderId: "sandbox_order_1", paymentId: "pay_1", outcome: "SUCCEEDED" });
  const signature = provider.signForTest(body);
  assert.equal(provider.verifyWebhook(body, signature).eventId, "evt_1");
  assert.throws(() => provider.verifyWebhook(`${body} `, signature), /signature/i);
});

test("live provider fails closed while provider and posting policy are unconfigured", () => {
  assert.throws(getLiveDonationProvider, PaymentUnavailableError);
});
