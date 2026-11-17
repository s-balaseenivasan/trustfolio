import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  approvalDefinitionSchema,
  decisionEligibility,
  evaluateStep,
  matchesPolicy,
  policyTransition,
  selectMatchingPolicy,
  type ApprovalDefinition,
  type ApprovalSubject,
  type StepSnapshot,
} from "@/lib/approval/definition";

/** Phase 1 is a draft engine. A later explicitly approved change must open this gate. */
const LIVE_APPROVALS_ENABLED = false;

export class ApprovalError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

type Scope = { scopeType: "GLOBAL" | "CLUB" | "PROJECT"; scopeId: string };

const audit = (actorId: string, eventType: string, subjectType: string, subjectId: string, details: Prisma.InputJsonValue = {}) => ({
  actorId,
  eventType,
  subjectType,
  subjectId,
  correlationId: randomUUID(),
  details,
});

export async function hasScopedPermission(userId: string, permissionKey: string, scope: Scope): Promise<boolean> {
  const count = await db.accessGroupMembership.count({
    where: {
      userId,
      status: "ACTIVE",
      OR: [{ scopeType: "GLOBAL", scopeId: "" }, scope],
      group: { permissions: { some: { permission: { key: permissionKey } } } },
    },
  });
  return count > 0;
}

export async function createDraftGroup(input: { key: string; name: string; description?: string }, actorId: string) {
  return db.$transaction(async (tx) => {
    const group = await tx.accessGroup.create({ data: input });
    await tx.auditEvent.create({ data: audit(actorId, "ACCESS_GROUP_CREATED", "AccessGroup", group.id, { key: group.key }) });
    return group;
  });
}

export async function updateDraftGroup(groupId: string, input: { name: string; description: string }, actorId: string) {
  return db.$transaction(async (tx) => {
    const group = await tx.accessGroup.update({ where: { id: groupId }, data: input });
    await tx.auditEvent.create({ data: audit(actorId, "ACCESS_GROUP_UPDATED", "AccessGroup", group.id, { key: group.key }) });
    return group;
  });
}

export async function createPermission(input: { key: string; description: string; effect: "READ" | "WRITE" | "APPROVE" }, actorId: string) {
  return db.$transaction(async (tx) => {
    const permission = await tx.permission.create({ data: input });
    await tx.auditEvent.create({ data: audit(actorId, "PERMISSION_CREATED", "Permission", permission.id, { key: permission.key }) });
    return permission;
  });
}

export async function updatePermission(permissionId: string, input: { description: string; effect: "READ" | "WRITE" | "APPROVE" }, actorId: string) {
  return db.$transaction(async (tx) => {
    const active = await tx.accessGroupMembership.count({
      where: { status: "ACTIVE", group: { permissions: { some: { permissionId } } } },
    });
    if (active) throw new ApprovalError("ACTIVE_PERMISSION_LOCKED", "Cannot change a permission held by an active member.");
    if (input.effect !== "READ") {
      const auditor = await tx.accessGroupPermission.count({ where: { permissionId, group: { key: "AUDITOR" } } });
      if (auditor) throw new ApprovalError("AUDITOR_READ_ONLY", "Auditors can receive read-only permissions only.");
    }
    const permission = await tx.permission.update({ where: { id: permissionId }, data: input });
    await tx.auditEvent.create({ data: audit(actorId, "PERMISSION_UPDATED", "Permission", permission.id, { key: permission.key, effect: permission.effect }) });
    return permission;
  });
}

/** Configures a group without granting any person membership or approval authority. */
export async function setGroupPermissions(groupId: string, permissionIds: string[], actorId: string) {
  return db.$transaction(async (tx) => {
    const activeMembers = await tx.accessGroupMembership.count({ where: { groupId, status: "ACTIVE" } });
    if (activeMembers) throw new ApprovalError("ACTIVE_GROUP_LOCKED", "Cannot change permissions for a group with active members in draft mode.");
    const group = await tx.accessGroup.findUniqueOrThrow({ where: { id: groupId } });
    const found = await tx.permission.findMany({ where: { id: { in: permissionIds } }, select: { id: true, effect: true } });
    if (found.length !== new Set(permissionIds).size) throw new ApprovalError("INVALID_PERMISSION", "Select valid permissions.");
    if (group.key === "AUDITOR" && found.some((permission) => permission.effect !== "READ")) {
      throw new ApprovalError("AUDITOR_READ_ONLY", "Auditors can receive read-only permissions only.");
    }
    await tx.accessGroupPermission.deleteMany({ where: { groupId } });
    if (permissionIds.length) await tx.accessGroupPermission.createMany({ data: [...new Set(permissionIds)].map((permissionId) => ({ groupId, permissionId })) });
    await tx.auditEvent.create({ data: audit(actorId, "GROUP_PERMISSIONS_CONFIGURED", "AccessGroup", groupId, { permissionIds }) });
  });
}

export async function createDraftPolicy(input: {
  key: string;
  name: string;
  subjectType: string;
  definition: unknown;
}, actorId: string) {
  const definition = approvalDefinitionSchema.parse(input.definition);
  const referencedKeys = [...new Set(definition.steps.flatMap((step) => step.groupKeys))];
  return db.$transaction(async (tx) => {
    const found = await tx.accessGroup.count({ where: { key: { in: referencedKeys } } });
    if (found !== referencedKeys.length) throw new ApprovalError("UNKNOWN_GROUP", "Policy references a group that does not exist.");
    const latest = await tx.approvalPolicy.findFirst({ where: { key: input.key }, orderBy: { version: "desc" }, select: { version: true } });
    const policy = await tx.approvalPolicy.create({
      data: {
        key: input.key,
        name: input.name,
        subjectType: input.subjectType,
        version: (latest?.version ?? 0) + 1,
        definition: definition as Prisma.InputJsonValue,
        createdById: actorId,
      },
    });
    await tx.auditEvent.create({ data: audit(actorId, "APPROVAL_POLICY_DRAFT_CREATED", "ApprovalPolicy", policy.id, { key: policy.key, version: policy.version }) });
    return policy;
  }, { isolationLevel: "Serializable" });
}

export async function createDraftDelegation(input: {
  grantorId: string;
  recipientId: string;
  groupId: string;
  scopeType: "GLOBAL" | "CLUB" | "PROJECT";
  scopeId: string;
  startsAt: Date;
  endsAt: Date;
}, actorId: string) {
  if (input.grantorId === input.recipientId) throw new ApprovalError("SELF_DELEGATION", "Choose a different recipient.");
  if (input.endsAt <= input.startsAt) throw new ApprovalError("INVALID_DELEGATION_WINDOW", "End must be after start.");
  if ((input.scopeType === "GLOBAL") !== (input.scopeId === "")) throw new ApprovalError("INVALID_SCOPE", "Choose a valid delegation scope.");
  return db.$transaction(async (tx) => {
    const users = await tx.user.count({ where: { id: { in: [input.grantorId, input.recipientId] } } });
    if (users !== 2) throw new ApprovalError("INVALID_USER", "Choose existing users.");
    await tx.accessGroup.findUniqueOrThrow({ where: { id: input.groupId } });
    const draft = await tx.approvalDelegation.create({ data: input });
    await tx.auditEvent.create({ data: audit(actorId, "DELEGATION_DRAFT_CREATED", "ApprovalDelegation", draft.id, { groupId: input.groupId, scopeType: input.scopeType, scopeId: input.scopeId }) });
    return draft;
  });
}

export async function simulateDraftPolicy(policyId: string, subject: ApprovalSubject) {
  const policy = await db.approvalPolicy.findUniqueOrThrow({ where: { id: policyId } });
  const definition = approvalDefinitionSchema.parse(policy.definition);
  return {
    policyId: policy.id,
    version: policy.version,
    status: policy.status,
    matches: matchesPolicy(subject, policy.subjectType, definition),
    steps: definition.steps.map((step, index) => ({ index: index + 1, mode: step.mode, groups: step.groupKeys, sequential: index > 0 })),
    liveExecutionEnabled: LIVE_APPROVALS_ENABLED,
  };
}

/** Activation and deactivation mechanics exist, but the production gate is closed. */
export async function transitionPolicy(policyId: string, target: "ACTIVE" | "INACTIVE", actorId: string) {
  const current = await db.approvalPolicy.findUniqueOrThrow({ where: { id: policyId } });
  const transition = policyTransition(current.status, target, LIVE_APPROVALS_ENABLED);
  if (!transition.ok) throw new ApprovalError(transition.code, "Policy activation is unavailable pending explicit authorization.");
  return db.$transaction(async (tx) => {
    const updated = await tx.approvalPolicy.updateMany({
      where: { id: policyId, status: current.status },
      data: { status: transition.status, ...(target === "ACTIVE" ? { activatedAt: new Date() } : {}) },
    });
    if (updated.count !== 1) throw new ApprovalError("POLICY_CONFLICT", "Policy changed. Review the current version.");
    await tx.auditEvent.create({ data: audit(actorId, `APPROVAL_POLICY_${target}`, "ApprovalPolicy", policyId, { version: current.version }) });
  }, { isolationLevel: "Serializable" });
}

function requireLiveApprovals() {
  if (!LIVE_APPROVALS_ENABLED) throw new ApprovalError("POLICY_ACTIVATION_DISABLED", "Approval policies are not active.");
}

async function eligibleActors(groupKeys: string[], scope: Scope): Promise<string[]> {
  const members = await db.accessGroupMembership.findMany({
    where: {
      status: "ACTIVE",
      group: { key: { in: groupKeys } },
      OR: [{ scopeType: "GLOBAL", scopeId: "" }, scope],
    },
    select: { userId: true },
  });
  return [...new Set(members.map((member) => member.userId))];
}

export async function startApproval(subject: ApprovalSubject & { subjectId: string; makerId: string; scope: Scope }) {
  requireLiveApprovals();
  const policies = await db.approvalPolicy.findMany({ where: { subjectType: subject.subjectType, status: "ACTIVE" } });
  const parsedPolicies = policies.map((policy) => ({ ...policy, definition: approvalDefinitionSchema.parse(policy.definition) }));
  const selection = selectMatchingPolicy(parsedPolicies, subject);
  if (!selection.ok) throw new ApprovalError(selection.code, "No single active approval policy matches this action.");
  const { definition, ...policy } = selection.policy;
  const steps: StepSnapshot[] = await Promise.all(definition.steps.map(async (step) => ({
    mode: step.mode,
    groupKeys: step.groupKeys,
    eligibleActorIds: (await eligibleActors(step.groupKeys, subject.scope)).filter((id) => id !== subject.makerId),
  })));
  if (steps.some((step) => step.eligibleActorIds.length === 0)) throw new ApprovalError("NO_ELIGIBLE_APPROVER", "A required approval step has no eligible independent approver.");
  const snapshot = { ...definition, steps };
  return db.$transaction(async (tx) => {
    const existing = await tx.approvalInstance.findFirst({ where: { subjectType: subject.subjectType, subjectId: subject.subjectId, status: "PENDING" } });
    if (existing) throw new ApprovalError("APPROVAL_ALREADY_PENDING", "An approval is already pending for this record.");
    const instance = await tx.approvalInstance.create({
      data: {
        policyId: policy.id,
        policyVersion: policy.version,
        policySnapshot: snapshot as Prisma.InputJsonValue,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        makerId: subject.makerId,
        amount: subject.amount ? new Prisma.Decimal(subject.amount) : null,
        currency: subject.currency,
        scopeType: subject.scope.scopeType,
        scopeId: subject.scope.scopeId,
      },
    });
    await tx.auditEvent.create({ data: audit(subject.makerId, "APPROVAL_SUBMITTED", subject.subjectType, subject.subjectId, { instanceId: instance.id, policyVersion: policy.version }) });
    await tx.notificationOutbox.createMany({
      data: steps[0]!.eligibleActorIds.map((recipientId) => ({
        dedupeKey: `approval:${instance.id}:step:0:${recipientId}`,
        recipientId,
        templateKey: "APPROVAL_REVIEW_REQUESTED",
        payload: { instanceId: instance.id },
      })),
    });
    return instance;
  }, { isolationLevel: "Serializable" });
}

export async function decideApproval(input: { instanceId: string; actorId: string; kind: "APPROVE" | "REJECT" | "RETURN"; reason?: string; expectedVersion: number; delegatedFromId?: string }) {
  requireLiveApprovals();
  if (input.kind !== "APPROVE" && !input.reason?.trim()) throw new ApprovalError("REASON_REQUIRED", "Give a reason for returning or rejecting.");
  return db.$transaction(async (tx) => {
    const instance = await tx.approvalInstance.findUniqueOrThrow({ where: { id: input.instanceId }, include: { decisions: true } });
    if (instance.status !== "PENDING" || instance.version !== input.expectedVersion) throw new ApprovalError("APPROVAL_CONFLICT", "This approval changed. Review its current state.");
    const snapshot = instance.policySnapshot as unknown as ApprovalDefinition & { steps: StepSnapshot[] };
    const step = snapshot.steps[instance.currentStep];
    if (!step) throw new ApprovalError("INVALID_APPROVAL_SNAPSHOT", "This approval needs administrator review.");
    const stillMember = await tx.accessGroupMembership.count({
      where: {
        userId: input.actorId,
        status: "ACTIVE",
        group: { key: { in: step.groupKeys } },
        OR: [{ scopeType: "GLOBAL", scopeId: "" }, { scopeType: instance.scopeType, scopeId: instance.scopeId }],
      },
    });
    const eligibility = decisionEligibility({ makerId: instance.makerId, actorId: input.actorId, step, activeGroupMember: stillMember > 0, delegatedFromId: input.delegatedFromId });
    if (eligibility !== "ELIGIBLE") throw new ApprovalError(eligibility, "You are not eligible for this approval step.");
    if (instance.decisions.some((decision) => decision.stepIndex === instance.currentStep && decision.actorId === input.actorId)) {
      throw new ApprovalError("DUPLICATE_DECISION", "You have already decided this step.");
    }
    const prior = instance.decisions.filter((decision) => decision.stepIndex === instance.currentStep).map((decision) => ({ actorId: decision.actorId, kind: decision.kind }));
    const outcome = evaluateStep(step, [...prior, { actorId: input.actorId, kind: input.kind }]);
    const nextStep = outcome === "ADVANCE" ? instance.currentStep + 1 : instance.currentStep;
    const nextStatus = outcome === "REJECTED" || outcome === "RETURNED"
      ? outcome
      : nextStep === snapshot.steps.length ? "APPROVED" : "PENDING";
    const updated = await tx.approvalInstance.updateMany({
      where: { id: instance.id, version: input.expectedVersion, status: "PENDING" },
      data: { version: { increment: 1 }, currentStep: nextStep, status: nextStatus, ...(nextStatus !== "PENDING" ? { finishedAt: new Date() } : {}) },
    });
    if (updated.count !== 1) throw new ApprovalError("APPROVAL_CONFLICT", "This approval changed. Review its current state.");
    const decision = await tx.approvalDecision.create({
      data: { instanceId: instance.id, stepIndex: instance.currentStep, actorId: input.actorId, kind: input.kind, reason: input.reason?.trim() || null, policyVersion: instance.policyVersion },
    });
    await tx.auditEvent.create({ data: audit(input.actorId, `APPROVAL_${input.kind}`, instance.subjectType, instance.subjectId, { instanceId: instance.id, decisionId: decision.id, policyVersion: instance.policyVersion }) });
    const recipients = nextStatus === "PENDING" && nextStep !== instance.currentStep
      ? snapshot.steps[nextStep]!.eligibleActorIds
      : nextStatus === "PENDING" ? [] : [instance.makerId];
    if (recipients.length) await tx.notificationOutbox.createMany({
      data: recipients.map((recipientId) => ({
        dedupeKey: `approval:${instance.id}:version:${instance.version + 1}:${recipientId}`,
        recipientId,
        templateKey: nextStatus === "PENDING" ? "APPROVAL_REVIEW_REQUESTED" : `APPROVAL_${nextStatus}`,
        payload: { instanceId: instance.id },
      })),
    });
    return { decision, status: nextStatus, version: instance.version + 1 };
  }, { isolationLevel: "Serializable" });
}
