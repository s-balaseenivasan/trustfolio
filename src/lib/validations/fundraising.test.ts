import assert from "node:assert/strict";
import test from "node:test";
import { donationCampaignDraftSchema, donationRequestDraftSchema, formatPaise, paiseToRupeesInput, rupeesToPaise } from "./fundraising";

test("INR amount parsing preserves paise without floating point", () => {
  for (const [input, expected] of [["0.01", "1"], ["1", "100"], ["1.2", "120"], ["123456789.99", "12345678999"]]) assert.equal(rupeesToPaise(input).toString(), expected);
  assert.equal(formatPaise(BigInt(12345678999)), "₹12,34,56,789.99");
  assert.equal(paiseToRupeesInput(BigInt(120)), "1.20");
  for (const invalid of ["0", "0.00", "-1", "1.234", "1e4", "1,000", " 1 "]) assert.throws(() => rupeesToPaise(invalid));
});

test("draft validation requires positive INR and ordered campaign dates", () => {
  const request = { purposeEn: "School kits", purposeTa: "", justificationEn: "Purchase new learning kits", justificationTa: "", targetRupees: "0.01", neededBy: "" };
  assert.equal(donationRequestDraftSchema.safeParse(request).success, true);
  assert.equal(donationRequestDraftSchema.safeParse({ ...request, targetRupees: "0.00" }).success, false);
  assert.equal(donationRequestDraftSchema.safeParse({ ...request, targetRupees: "2.345" }).success, false);
  const campaign = { titleEn: "School kits", titleTa: "", summaryEn: "Provide new school kits", summaryTa: "", storyEn: "", storyTa: "", startsOn: "2026-11-03", endsOn: "2026-11-02" };
  assert.equal(donationCampaignDraftSchema.safeParse(campaign).success, false);
});
