import assert from "node:assert/strict";
import test from "node:test";
import { buildFullReversal, journalFingerprint, JournalInvariantError, validateJournal, type JournalDraft } from "./journal-core";

const base: JournalDraft = {
  currency: "INR", sourceType: "TEST_SOURCE", sourceId: "source-1", periodId: "period-1", effectiveDate: "2026-10-26",
  lines: [
    { accountId: "cash", currency: "INR", debitMinor: BigInt(12345), creditMinor: BigInt(0), fundId: "general", projectId: "project-1" },
    { accountId: "income", currency: "INR", debitMinor: BigInt(0), creditMinor: BigInt(12345), fundId: "general", projectId: "project-1" },
  ],
};

test("balanced integer-minor-unit journal validates without floating point", () => {
  const result = validateJournal(base.currency, base.lines);
  assert.equal(result.totalDebitMinor, BigInt(12345));
  assert.equal(result.totalCreditMinor, BigInt(12345));
});

test("unbalanced, mixed-currency, dual-sided, and numeric amounts fail closed", () => {
  assert.throws(() => validateJournal("INR", [{ ...base.lines[0]!, debitMinor: BigInt(10) }, base.lines[1]!]), { code: "JOURNAL_UNBALANCED" });
  assert.throws(() => validateJournal("INR", [{ ...base.lines[0]!, currency: "USD" }, base.lines[1]!]), { code: "CURRENCY_MISMATCH" });
  assert.throws(() => validateJournal("INR", [{ ...base.lines[0]!, creditMinor: BigInt(1) }, base.lines[1]!]), { code: "ONE_SIDE_REQUIRED" });
  assert.throws(() => validateJournal("INR", [{ ...base.lines[0]!, debitMinor: 1 as unknown as bigint }, base.lines[1]!]), { code: "EXACT_AMOUNT_REQUIRED" });
});

test("fingerprints are order-independent but change when journal economics change", () => {
  const reordered = { ...base, lines: [...base.lines].reverse() };
  const changed = { ...base, lines: [{ ...base.lines[0]!, debitMinor: BigInt(12346) }, { ...base.lines[1]!, creditMinor: BigInt(12346) }] };
  assert.equal(journalFingerprint(base), journalFingerprint(reordered));
  assert.notEqual(journalFingerprint(base), journalFingerprint(changed));
  assert.throws(() => journalFingerprint({ ...base, lines: [base.lines[0]!, { ...base.lines[1]!, creditMinor: BigInt(1) }] }), JournalInvariantError);
});

test("full reversal swaps debit and credit while preserving dimensions", () => {
  const reversal = buildFullReversal("journal-1", base, { periodId: "adjustment-period", effectiveDate: "2026-11-01" });
  assert.equal(reversal.sourceType, "JOURNAL_REVERSAL");
  assert.equal(reversal.sourceId, "journal-1");
  assert.equal(reversal.periodId, "adjustment-period");
  assert.equal(reversal.effectiveDate, "2026-11-01");
  assert.equal(reversal.lines[0]!.debitMinor, BigInt(0));
  assert.equal(reversal.lines[0]!.creditMinor, BigInt(12345));
  assert.equal(reversal.lines[0]!.projectId, "project-1");
  assert.equal(validateJournal(reversal.currency, reversal.lines).totalDebitMinor, BigInt(12345));
});
