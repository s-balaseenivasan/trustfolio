"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsFrom, formValues } from "@/lib/action-state";
import { donationCampaignDraftSchema, donationRequestDraftSchema, fundraisingVersionSchema } from "@/lib/validations/fundraising";
import { requireAdmin, UnauthorizedError } from "@/server/auth-guard";
import { createDonationCampaignDraft, createDonationRequestDraft, FundraisingError, publishDonationCampaign, submitDonationRequest, updateDonationCampaignDraft, updateDonationRequestDraft } from "@/server/fundraising/service";

const id = z.string().min(1).max(64);
async function run(formData: FormData, work: (actorId: string) => Promise<{ message: string; requestId?: string; projectId?: string; id?: string }>): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await requireAdmin("ADMIN");
    const result = await work(actor.id);
    revalidatePath("/admin/fundraising");
    if (result.projectId) revalidatePath(`/admin/fundraising/${result.projectId}`);
    if (result.requestId) revalidatePath(`/admin/fundraising/requests/${result.requestId}`);
    return { status: "success", message: result.message, id: result.id };
  } catch (error) {
    if (error instanceof FundraisingError) return { status: "error", code: error.code, message: error.message, values };
    if (error instanceof UnauthorizedError) return { status: "error", code: "UNAUTHORIZED", message: error.message, values };
    if (error instanceof z.ZodError) return { status: "error", code: "VALIDATION_ERROR", message: "Correct the highlighted fields.", fieldErrors: fieldErrorsFrom(error), values };
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return { status: "error", code: "DUPLICATE_DRAFT", message: "This request already has a campaign draft, or a slug is taken.", values };
      if (error.code === "P2025") return { status: "error", code: "NOT_FOUND", message: "This record is no longer available.", values };
      if (error.code === "P2034") return { status: "error", code: "CONCURRENT_CHANGE", message: "A concurrent change occurred. Reload and try again.", values };
    }
    console.error("[fundraising] admin draft action failed", error);
    return { status: "error", code: "SAVE_FAILED", message: "Could not save this fundraising draft. Reload and try again.", values };
  }
}

export async function addDonationRequestDraft(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    const row = await createDonationRequestDraft(projectId, donationRequestDraftSchema.parse(Object.fromEntries(formData)), actorId);
    return { message: "Private donation request draft created.", projectId, requestId: row.id, id: row.id };
  });
}

export async function saveDonationRequestDraft(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const requestId = id.parse(formData.get("requestId"));
    await updateDonationRequestDraft(requestId, fundraisingVersionSchema.parse(formData.get("version")), donationRequestDraftSchema.parse(Object.fromEntries(formData)), actorId);
    return { message: "Private request draft saved; history retained.", requestId };
  });
}

export async function addDonationCampaignDraft(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const requestId = id.parse(formData.get("requestId"));
    const row = await createDonationCampaignDraft(requestId, donationCampaignDraftSchema.parse(Object.fromEntries(formData)), actorId);
    return { message: "Private campaign planning draft created. It is not approved or public.", requestId, id: row.id };
  });
}

export async function saveDonationCampaignDraft(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const requestId = id.parse(formData.get("requestId"));
    const campaignId = id.parse(formData.get("campaignId"));
    await updateDonationCampaignDraft(campaignId, fundraisingVersionSchema.parse(formData.get("version")), donationCampaignDraftSchema.parse(Object.fromEntries(formData)), actorId);
    return { message: "Private campaign planning draft saved; history retained.", requestId };
  });
}

/** Callable actions also fail closed if clients forge a submit/release request. */
export async function attemptDonationRequestSubmission(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async () => { id.parse(formData.get("requestId")); submitDonationRequest(); });
}
export async function attemptCampaignPublication(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async () => { id.parse(formData.get("campaignId")); publishDonationCampaign(); });
}
