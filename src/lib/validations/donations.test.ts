import assert from "node:assert/strict";
import test from "node:test";
import { donorProfileSchema, manualDonationIntakeSchema } from "./donations";

test("donor profiles link only a valid existing account email and require organization names", () => {
  assert.equal(donorProfileSchema.safeParse({ email: "USER@example.org", type: "INDIVIDUAL", organizationName: "" }).success, true);
  assert.equal(donorProfileSchema.safeParse({ email: "bad", type: "INDIVIDUAL", organizationName: "" }).success, false);
  assert.equal(donorProfileSchema.safeParse({ email: "org@example.org", type: "ORGANIZATION", organizationName: "" }).success, false);
});

test("manual intake requires positive INR precision and a supported offline method", () => {
  const valid = { idempotencyKey: "e9e8e451-193f-4ed7-b0ab-764d3671a197", donorProfileId: "profile", projectId: "project", campaignId: "", amountRupees: "1200.05", method: "UPI", receivedAt: "2026-10-26", reference: "ref-1", privateNote: "" };
  assert.equal(manualDonationIntakeSchema.safeParse(valid).success, true);
  assert.equal(manualDonationIntakeSchema.safeParse({ ...valid, amountRupees: "0" }).success, false);
  assert.equal(manualDonationIntakeSchema.safeParse({ ...valid, amountRupees: "12.345" }).success, false);
  assert.equal(manualDonationIntakeSchema.safeParse({ ...valid, method: "ONLINE" }).success, false);
  assert.equal(manualDonationIntakeSchema.safeParse({ ...valid, receivedAt: "2099-01-01" }).success, false);
});
