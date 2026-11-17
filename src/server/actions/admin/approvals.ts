"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsFrom, formValues } from "@/lib/action-state";
import { approvalDefinitionSchema, SUBJECT_TYPES } from "@/lib/approval/definition";
import { requireAdmin, UnauthorizedError } from "@/server/auth-guard";
import {
  ApprovalError,
  createDraftGroup,
  createDraftDelegation,
  createDraftPolicy,
  createPermission,
  setGroupPermissions,
  simulateDraftPolicy,
  updateDraftGroup,
  updatePermission,
} from "@/server/approval/foundation";

const key = z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,63}$/, "Use an uppercase key with underscores");
const groupSchema = z.object({ key, name: z.string().trim().min(3).max(100), description: z.string().trim().max(500) });
const permissionSchema = z.object({ key, description: z.string().trim().min(5).max(300), effect: z.enum(["READ", "WRITE", "APPROVE"]) });
const policySchema = z.object({
  key,
  name: z.string().trim().min(3).max(120),
  subjectType: z.enum(SUBJECT_TYPES),
  definition: z.string().max(20_000),
});

async function runAction(formData: FormData, handler: (actorId: string) => Promise<ActionState>): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await requireAdmin("ADMIN");
    const result = await handler(actor.id);
    if (result.status === "success") revalidatePath("/admin/approvals");
    return result;
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ApprovalError) return { status: "error", message: error.message, values };
    if (error instanceof ZodError) return { status: "error", message: "Correct the highlighted values.", fieldErrors: fieldErrorsFrom(error), values };
    console.error("[approvals] draft configuration failed", error);
    return { status: "error", message: "Could not save the draft. Review the values and try again.", values };
  }
}

export async function addApprovalGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async (actorId) => {
    const parsed = groupSchema.parse(Object.fromEntries(formData));
    const group = await createDraftGroup(parsed, actorId);
    return { status: "success", message: "Approval group added. It has no members or authority.", id: group.id };
  });
}

export async function addApprovalPermission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async (actorId) => {
    const parsed = permissionSchema.parse(Object.fromEntries(formData));
    const permission = await createPermission(parsed, actorId);
    return { status: "success", message: "Permission added. It is not granted to anyone.", id: permission.id };
  });
}

export async function editApprovalGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async (actorId) => {
    const groupId = z.string().min(1).max(64).parse(formData.get("groupId"));
    const name = z.string().trim().min(3).max(100).parse(formData.get("name"));
    const description = z.string().trim().max(500).parse(formData.get("description"));
    await updateDraftGroup(groupId, { name, description }, actorId);
    return { status: "success", message: "Group details updated. Authority is unchanged." };
  });
}

export async function editApprovalPermission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async (actorId) => {
    const permissionId = z.string().min(1).max(64).parse(formData.get("permissionId"));
    const description = z.string().trim().min(5).max(300).parse(formData.get("description"));
    const effect = z.enum(["READ", "WRITE", "APPROVE"]).parse(formData.get("effect"));
    await updatePermission(permissionId, { description, effect }, actorId);
    return { status: "success", message: "Permission updated. Authority is unchanged." };
  });
}

export async function configureGroupPermissions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async (actorId) => {
    const groupId = z.string().min(1).max(64).parse(formData.get("groupId"));
    const ids = z.array(z.string().min(1).max(64)).max(100).parse(formData.getAll("permissionIds"));
    await setGroupPermissions(groupId, ids, actorId);
    return { status: "success", message: "Draft group permissions saved. No user was assigned authority." };
  });
}

export async function addDraftPolicy(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async (actorId) => {
    const parsed = policySchema.parse(Object.fromEntries(formData));
    let definition: unknown;
    try {
      definition = JSON.parse(parsed.definition);
    } catch {
      return { status: "error", message: "Policy steps are invalid.", fieldErrors: { definition: ["Review the approval steps."] } };
    }
    const checked = approvalDefinitionSchema.parse(definition);
    const policy = await createDraftPolicy({ ...parsed, definition: checked }, actorId);
    return { status: "success", message: `Draft policy ${policy.key} v${policy.version} saved. It cannot approve live work.`, id: policy.id };
  });
}

export async function addDraftDelegation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async (actorId) => {
    const grantorId = z.string().min(1).max(64).parse(formData.get("grantorId"));
    const recipientId = z.string().min(1).max(64).parse(formData.get("recipientId"));
    const groupId = z.string().min(1).max(64).parse(formData.get("groupId"));
    const scopeType = z.enum(["GLOBAL", "CLUB", "PROJECT"]).parse(formData.get("scopeType"));
    const scopeId = z.string().trim().max(64).parse(formData.get("scopeId") ?? "");
    const startsAt = z.coerce.date().parse(formData.get("startsAt"));
    const endsAt = z.coerce.date().parse(formData.get("endsAt"));
    await createDraftDelegation({ grantorId, recipientId, groupId, scopeType, scopeId, startsAt, endsAt }, actorId);
    return { status: "success", message: "Delegation draft saved. It cannot grant authority." };
  });
}

export async function simulateApprovalPolicy(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const policyId = z.string().min(1).max(64).parse(formData.get("policyId"));
    const subjectType = z.enum(SUBJECT_TYPES).parse(formData.get("subjectType"));
    const amount = z.string().trim().max(64).parse(formData.get("amount"));
    const currency = z.string().trim().max(3).parse(formData.get("currency"));
    const projectId = z.string().trim().max(64).parse(formData.get("projectId"));
    const result = await simulateDraftPolicy(policyId, {
      subjectType,
      amount: amount || null,
      currency: currency || null,
      projectId: projectId || null,
    });
    return {
      status: "success",
      message: result.matches
        ? `Matches draft v${result.version}: ${result.steps.map((step) => `step ${step.index} ${step.mode} of ${step.groups.join("/")}`).join("; ")}. Live execution remains disabled.`
        : `Does not match draft v${result.version}. No approval was created.`,
    };
  });
}
