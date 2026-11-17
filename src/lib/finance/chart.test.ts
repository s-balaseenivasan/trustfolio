import assert from "node:assert/strict";
import test from "node:test";
import { validateChartAccounts, type ChartAccountDraft } from "./chart";

const chart: ChartAccountDraft[] = [
  { code: "cash", name: "Cash", accountClass: "ASSET" },
  { code: "bank", name: "Bank", accountClass: "ASSET", parentCode: "cash" },
  { code: "donations", name: "Donation income", accountClass: "INCOME" },
];

test("chart accepts unique account codes and an acyclic parent tree", () => {
  assert.doesNotThrow(() => validateChartAccounts(chart));
});

test("chart rejects duplicate codes, missing parents and cycles", () => {
  assert.throws(() => validateChartAccounts([...chart, { code: "cash", name: "Duplicate", accountClass: "ASSET" }]), { code: "DUPLICATE_ACCOUNT_CODE" });
  assert.throws(() => validateChartAccounts([{ code: "cash", name: "Cash", accountClass: "ASSET", parentCode: "missing" }]), { code: "ACCOUNT_PARENT_MISSING" });
  assert.throws(() => validateChartAccounts([{ code: "a", name: "A", accountClass: "ASSET", parentCode: "b" }, { code: "b", name: "B", accountClass: "ASSET", parentCode: "a" }]), { code: "ACCOUNT_PARENT_CYCLE" });
});

test("chart rejects blank identifiers and unsupported classes", () => {
  assert.throws(() => validateChartAccounts([{ code: "  ", name: "Cash", accountClass: "ASSET" }]), { code: "ACCOUNT_CODE_REQUIRED" });
  assert.throws(() => validateChartAccounts([{ code: "cash", name: "  ", accountClass: "ASSET" }]), { code: "ACCOUNT_NAME_REQUIRED" });
  assert.throws(() => validateChartAccounts([{ code: "cash", name: "Cash", accountClass: "OTHER" as ChartAccountDraft["accountClass"] }]), { code: "ACCOUNT_CLASS_INVALID" });
});
