import { JournalInvariantError } from "@/lib/finance/journal-core";

/** Account classes required by the approved product scope; codes and names remain trust-configured. */
export const ACCOUNT_CLASSES = ["ASSET", "LIABILITY", "NET_ASSET", "INCOME", "EXPENSE"] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];

export type ChartAccountDraft = {
  code: string;
  name: string;
  accountClass: AccountClass;
  parentCode?: string | null;
};

/** Checks chart identifiers and tree structure without assigning codes or accounting semantics. */
export function validateChartAccounts(accounts: readonly ChartAccountDraft[]): void {
  const byCode = new Map<string, ChartAccountDraft>();
  for (const account of accounts) {
    const code = account.code.trim();
    if (!code) throw new JournalInvariantError("ACCOUNT_CODE_REQUIRED", "Every chart account needs a code.");
    if (!account.name.trim()) throw new JournalInvariantError("ACCOUNT_NAME_REQUIRED", `Account ${code} needs a name.`);
    if (!(ACCOUNT_CLASSES as readonly string[]).includes(account.accountClass)) throw new JournalInvariantError("ACCOUNT_CLASS_INVALID", `Account ${code} has an unsupported class.`);
    if (byCode.has(code)) throw new JournalInvariantError("DUPLICATE_ACCOUNT_CODE", `Account code ${code} is duplicated.`);
    byCode.set(code, account);
  }

  for (const account of accounts) {
    const parentCode = account.parentCode?.trim();
    if (!parentCode) continue;
    if (parentCode === account.code.trim()) throw new JournalInvariantError("ACCOUNT_PARENT_CYCLE", `Account ${account.code} cannot parent itself.`);
    if (!byCode.has(parentCode)) throw new JournalInvariantError("ACCOUNT_PARENT_MISSING", `Parent account ${parentCode} does not exist.`);
  }

  const state = new Map<string, "visiting" | "visited">();
  const visit = (code: string) => {
    if (state.get(code) === "visiting") throw new JournalInvariantError("ACCOUNT_PARENT_CYCLE", "Chart hierarchy contains a cycle.");
    if (state.get(code) === "visited") return;
    state.set(code, "visiting");
    const parentCode = byCode.get(code)?.parentCode?.trim();
    if (parentCode) visit(parentCode);
    state.set(code, "visited");
  };
  for (const code of byCode.keys()) visit(code);
}
