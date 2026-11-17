import { z } from "zod";

export const PROPOSED_APPROVAL_GROUPS = [
  "TRUST_ADMIN",
  "TRUSTEE_APPROVER",
  "FINANCE_MANAGER",
  "FINANCE_OFFICER",
  "PROJECT_MANAGER",
  "CLUB_COORDINATOR",
  "CONTENT_APPROVER",
  "AUDITOR",
] as const;

export const SUBJECT_TYPES = [
  "DONATION_REQUEST",
  "MANUAL_DONATION",
  "EXPENSE",
  "REFUND",
  "JOURNAL_REVERSAL",
  "PUBLIC_RELEASE",
] as const;

const key = z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,63}$/, "Use an uppercase key with underscores");
const exactAmount = z.string().trim().regex(/^\d{1,22}(?:\.\d{1,8})?$/, "Use an exact non-negative amount with at most 8 decimal places");

export const approvalDefinitionSchema = z.object({
  conditions: z.object({
    minAmount: exactAmount.nullable().default(null),
    maxAmount: exactAmount.nullable().default(null),
    currency: z.string().trim().regex(/^[A-Z]{3}$/).nullable().default(null),
    projectId: z.string().trim().min(1).max(64).nullable().default(null),
  }),
  steps: z.array(z.object({
    mode: z.enum(["ANY", "ALL"]),
    groupKeys: z.array(key).min(1).max(16).refine((keys) => new Set(keys).size === keys.length, "Duplicate group"),
  })).min(1).max(10),
  noSelfApproval: z.literal(true),
  delegationAllowed: z.boolean().default(false),
}).superRefine((value, ctx) => {
  const { minAmount, maxAmount } = value.conditions;
  if (minAmount && maxAmount && compareAmounts(minAmount, maxAmount) > 0) {
    ctx.addIssue({ code: "custom", path: ["conditions", "maxAmount"], message: "Maximum must be at least the minimum" });
  }
  if ((minAmount || maxAmount) && !value.conditions.currency) {
    ctx.addIssue({ code: "custom", path: ["conditions", "currency"], message: "Choose a currency for amount conditions" });
  }
  value.steps.forEach((step, index) => {
    if (step.groupKeys.includes("AUDITOR")) {
      ctx.addIssue({ code: "custom", path: ["steps", index, "groupKeys"], message: "Auditors cannot approve" });
    }
  });
});

export type ApprovalDefinition = z.infer<typeof approvalDefinitionSchema>;
export type ApprovalSubject = {
  subjectType: string;
  amount: string | null;
  currency: string | null;
  projectId: string | null;
};

/** Exact comparison without JavaScript floating-point arithmetic. */
export function amountUnits(value: string): bigint {
  if (!/^\d{1,22}(?:\.\d{1,8})?$/.test(value)) throw new Error("Invalid exact amount");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * BigInt(100_000_000) + BigInt(fraction.padEnd(8, "0"));
}

export function compareAmounts(left: string, right: string): number {
  const a = amountUnits(left);
  const b = amountUnits(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function matchesPolicy(subject: ApprovalSubject, policySubjectType: string, definition: ApprovalDefinition): boolean {
  if (subject.subjectType !== policySubjectType) return false;
  const conditions = definition.conditions;
  if (conditions.currency && subject.currency !== conditions.currency) return false;
  if (conditions.projectId && subject.projectId !== conditions.projectId) return false;
  if (conditions.minAmount && (subject.amount === null || compareAmounts(subject.amount, conditions.minAmount) < 0)) return false;
  if (conditions.maxAmount && (subject.amount === null || compareAmounts(subject.amount, conditions.maxAmount) > 0)) return false;
  return true;
}

export function selectMatchingPolicy<T extends { status: "DRAFT" | "ACTIVE" | "INACTIVE"; subjectType: string; definition: ApprovalDefinition }>(
  policies: T[], subject: ApprovalSubject,
): { ok: true; policy: T } | { ok: false; code: "MISSING_POLICY" | "AMBIGUOUS_POLICY" } {
  const matches = policies.filter((policy) => policy.status === "ACTIVE" && matchesPolicy(subject, policy.subjectType, policy.definition));
  if (matches.length !== 1) return { ok: false, code: matches.length ? "AMBIGUOUS_POLICY" : "MISSING_POLICY" };
  return { ok: true, policy: matches[0]! };
}

export type StepSnapshot = { mode: "ANY" | "ALL"; eligibleActorIds: string[]; groupKeys: string[] };
export type DecisionInput = { actorId: string; kind: "APPROVE" | "REJECT" | "RETURN" };

export function decisionEligibility(input: {
  makerId: string;
  actorId: string;
  step: StepSnapshot;
  activeGroupMember: boolean;
  delegatedFromId?: string;
}): "ELIGIBLE" | "SELF_APPROVAL" | "DELEGATION_DISABLED" | "NOT_ELIGIBLE" {
  if (input.delegatedFromId) return "DELEGATION_DISABLED";
  if (input.makerId === input.actorId) return "SELF_APPROVAL";
  if (!input.step.eligibleActorIds.includes(input.actorId) || !input.activeGroupMember) return "NOT_ELIGIBLE";
  return "ELIGIBLE";
}

/** Returns the next state from immutable decisions within the current step. */
export function evaluateStep(step: StepSnapshot, decisions: DecisionInput[]): "PENDING" | "ADVANCE" | "REJECTED" | "RETURNED" {
  if (decisions.some((decision) => decision.kind === "REJECT")) return "REJECTED";
  if (decisions.some((decision) => decision.kind === "RETURN")) return "RETURNED";
  const approved = new Set(decisions.filter((decision) => decision.kind === "APPROVE").map((decision) => decision.actorId));
  if (step.mode === "ANY") return [...approved].some((id) => step.eligibleActorIds.includes(id)) ? "ADVANCE" : "PENDING";
  return step.eligibleActorIds.length > 0 && step.eligibleActorIds.every((id) => approved.has(id)) ? "ADVANCE" : "PENDING";
}

export function policyTransition(current: "DRAFT" | "ACTIVE" | "INACTIVE", target: "ACTIVE" | "INACTIVE", authorized: boolean) {
  if (!authorized) return { ok: false as const, code: "POLICY_ACTIVATION_DISABLED" };
  if (current === target || (current === "DRAFT" && target === "INACTIVE")) {
    return { ok: false as const, code: "INVALID_POLICY_TRANSITION" };
  }
  return { ok: true as const, status: target };
}
