import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amountUnits,
  approvalDefinitionSchema,
  decisionEligibility,
  evaluateStep,
  matchesPolicy,
  policyTransition,
  selectMatchingPolicy,
} from "./definition";

const definition = approvalDefinitionSchema.parse({
  conditions: { minAmount: "100.00", maxAmount: "1000.00", currency: "INR", projectId: null },
  steps: [
    { mode: "ANY", groupKeys: ["FINANCE_MANAGER", "TRUSTEE_APPROVER"] },
    { mode: "ALL", groupKeys: ["TRUSTEE_APPROVER"] },
  ],
  noSelfApproval: true,
  delegationAllowed: false,
});

test("amount conditions compare exact decimal values at both boundaries", () => {
  assert.equal(amountUnits("100.00000001"), amountUnits("100") + BigInt(1));
  for (const amount of ["100", "100.00", "1000.00000000"]) {
    assert.equal(matchesPolicy({ subjectType: "EXPENSE", amount, currency: "INR", projectId: null }, "EXPENSE", definition), true);
  }
  for (const amount of ["99.99999999", "1000.00000001"]) {
    assert.equal(matchesPolicy({ subjectType: "EXPENSE", amount, currency: "INR", projectId: null }, "EXPENSE", definition), false);
  }
  assert.equal(matchesPolicy({ subjectType: "EXPENSE", amount: "500", currency: "USD", projectId: null }, "EXPENSE", definition), false);
  assert.throws(() => amountUnits("0.000000001"));
  assert.throws(() => amountUnits("1e3"));
});

test("unsafe policy definitions are rejected before storage", () => {
  assert.equal(approvalDefinitionSchema.safeParse({
    conditions: { minAmount: "20", maxAmount: "10" },
    steps: [{ mode: "ANY", groupKeys: ["AUDITOR"] }],
    noSelfApproval: true,
  }).success, false);
  assert.equal(approvalDefinitionSchema.safeParse({
    conditions: {}, steps: [{ mode: "ANY", groupKeys: ["FINANCE_MANAGER"] }], noSelfApproval: false,
  }).success, false);
});

test("ANY and ALL steps require the configured independent actors", () => {
  const any = { mode: "ANY" as const, groupKeys: ["FINANCE_MANAGER"], eligibleActorIds: ["a", "b"] };
  const all = { mode: "ALL" as const, groupKeys: ["TRUSTEE_APPROVER"], eligibleActorIds: ["a", "b"] };
  assert.equal(evaluateStep(any, [{ actorId: "a", kind: "APPROVE" }]), "ADVANCE");
  assert.equal(evaluateStep(all, [{ actorId: "a", kind: "APPROVE" }]), "PENDING");
  assert.equal(evaluateStep(all, [{ actorId: "a", kind: "APPROVE" }, { actorId: "b", kind: "APPROVE" }]), "ADVANCE");
  assert.equal(evaluateStep(all, [{ actorId: "a", kind: "APPROVE" }, { actorId: "b", kind: "REJECT" }]), "REJECTED");
  assert.equal(evaluateStep(any, [{ actorId: "b", kind: "RETURN" }]), "RETURNED");
  assert.equal(evaluateStep({ ...all, eligibleActorIds: [] }, []), "PENDING");
});

test("self-approval, stale grants and delegation fail closed", () => {
  const step = { mode: "ANY" as const, groupKeys: ["FINANCE_MANAGER"], eligibleActorIds: ["maker", "reviewer"] };
  assert.equal(decisionEligibility({ makerId: "maker", actorId: "maker", step, activeGroupMember: true }), "SELF_APPROVAL");
  assert.equal(decisionEligibility({ makerId: "maker", actorId: "reviewer", step, activeGroupMember: false }), "NOT_ELIGIBLE");
  assert.equal(decisionEligibility({ makerId: "maker", actorId: "reviewer", step, activeGroupMember: true, delegatedFromId: "other" }), "DELEGATION_DISABLED");
  assert.equal(decisionEligibility({ makerId: "maker", actorId: "reviewer", step, activeGroupMember: true }), "ELIGIBLE");
});

test("policy activation is blocked without explicit authorization", () => {
  assert.deepEqual(policyTransition("DRAFT", "ACTIVE", false), { ok: false, code: "POLICY_ACTIVATION_DISABLED" });
  assert.deepEqual(policyTransition("DRAFT", "ACTIVE", true), { ok: true, status: "ACTIVE" });
  assert.deepEqual(policyTransition("ACTIVE", "INACTIVE", true), { ok: true, status: "INACTIVE" });
  assert.deepEqual(policyTransition("DRAFT", "INACTIVE", true), { ok: false, code: "INVALID_POLICY_TRANSITION" });
});

test("missing, inactive and overlapping policies fail closed", () => {
  const subject = { subjectType: "EXPENSE", amount: "500", currency: "INR", projectId: null };
  const draft = { status: "DRAFT" as const, subjectType: "EXPENSE", definition };
  const active = { ...draft, status: "ACTIVE" as const };
  assert.deepEqual(selectMatchingPolicy([draft], subject), { ok: false, code: "MISSING_POLICY" });
  assert.deepEqual(selectMatchingPolicy([active, active], subject), { ok: false, code: "AMBIGUOUS_POLICY" });
  assert.equal(selectMatchingPolicy([draft, active], subject).ok, true);
});
