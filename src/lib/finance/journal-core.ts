import { createHash } from "node:crypto";

/** Currency precision and account/fund policy are injected by approved configuration later. */
export type JournalLineDraft = {
  accountId: string;
  currency: string;
  debitMinor: bigint;
  creditMinor: bigint;
  fundId?: string | null;
  projectId?: string | null;
  campaignId?: string | null;
};

export type JournalDraft = {
  currency: string;
  sourceType: string;
  sourceId: string;
  periodId: string;
  effectiveDate: string;
  lines: readonly JournalLineDraft[];
};

export type JournalBalance = { currency: string; totalDebitMinor: bigint; totalCreditMinor: bigint };

export class JournalInvariantError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "JournalInvariantError";
  }
}

function validCurrency(value: string): boolean { return /^[A-Z]{3}$/.test(value); }

/** Validates mechanical double-entry invariants only; it does not authorize or post. */
export function validateJournal(currency: string, lines: readonly JournalLineDraft[]): JournalBalance {
  if (!validCurrency(currency)) throw new JournalInvariantError("INVALID_CURRENCY_CODE", "Use a three-letter uppercase currency code.");
  if (lines.length < 2) throw new JournalInvariantError("TOO_FEW_LINES", "A journal needs at least two lines.");

  let totalDebitMinor = BigInt(0);
  let totalCreditMinor = BigInt(0);
  for (const [index, line] of lines.entries()) {
    if (!line.accountId.trim()) throw new JournalInvariantError("ACCOUNT_REQUIRED", `Line ${index + 1} needs an account reference.`);
    if (line.currency !== currency) throw new JournalInvariantError("CURRENCY_MISMATCH", "All lines in a journal must use the journal currency.");
    if (typeof line.debitMinor !== "bigint" || typeof line.creditMinor !== "bigint") throw new JournalInvariantError("EXACT_AMOUNT_REQUIRED", "Journal amounts must be integer minor units, not floating-point values.");
    if (line.debitMinor < BigInt(0) || line.creditMinor < BigInt(0)) throw new JournalInvariantError("NEGATIVE_LINE_AMOUNT", "Debit and credit amounts cannot be negative.");
    const hasDebit = line.debitMinor > BigInt(0);
    const hasCredit = line.creditMinor > BigInt(0);
    if (hasDebit === hasCredit) throw new JournalInvariantError("ONE_SIDE_REQUIRED", "Each line must have exactly one positive debit or credit amount.");
    totalDebitMinor += line.debitMinor;
    totalCreditMinor += line.creditMinor;
  }
  if (totalDebitMinor !== totalCreditMinor) throw new JournalInvariantError("JOURNAL_UNBALANCED", "Total debits must equal total credits.");
  return { currency, totalDebitMinor, totalCreditMinor };
}

function canonicalLine(line: JournalLineDraft) {
  return [line.accountId, line.currency, line.debitMinor.toString(), line.creditMinor.toString(), line.fundId ?? "", line.projectId ?? "", line.campaignId ?? ""];
}

/** Stable request fingerprint for idempotency; a reused key with changed economics has a different digest. */
export function journalFingerprint(draft: JournalDraft): string {
  validateJournal(draft.currency, draft.lines);
  const lines = draft.lines.map(canonicalLine).sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const canonical = JSON.stringify([draft.currency, draft.sourceType, draft.sourceId, draft.periodId, draft.effectiveDate, lines]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** Produces a balanced full reversal draft; authorization and persistence remain separate. */
export function buildFullReversal(originalId: string, original: JournalDraft, reversal: { periodId: string; effectiveDate: string }): JournalDraft {
  if (!originalId.trim()) throw new JournalInvariantError("SOURCE_REQUIRED", "A reversal must identify its original journal.");
  if (!reversal.periodId.trim() || !reversal.effectiveDate) throw new JournalInvariantError("REVERSAL_PERIOD_REQUIRED", "A reversal needs an explicitly selected period and effective date.");
  validateJournal(original.currency, original.lines);
  return {
    currency: original.currency,
    sourceType: "JOURNAL_REVERSAL",
    sourceId: originalId,
    periodId: reversal.periodId,
    effectiveDate: reversal.effectiveDate,
    lines: original.lines.map((line) => ({ ...line, debitMinor: line.creditMinor, creditMinor: line.debitMinor })),
  };
}
