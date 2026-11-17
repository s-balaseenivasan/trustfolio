"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ActionState } from "@/lib/action-state";
import { formValues, fieldErrorsFrom } from "@/lib/action-state";
import { clubProfileSchema, clubVersionSchema } from "@/lib/validations/club";
import { requireAdmin, UnauthorizedError } from "@/server/auth-guard";
import { appointClubCoordinator, archiveClubDocument, changeClubStatus, closeClubMembership, ClubError, createClub, inviteClubMember, reviewClubMembership, updateClub } from "@/server/clubs/service";

const id = z.string().min(1).max(64);

async function run(formData: FormData, handler: (actorId: string) => Promise<ActionState>): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await requireAdmin("ADMIN");
    const result = await handler(actor.id);
    if (result.status === "success") revalidatePath("/admin/clubs");
    return result;
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ClubError) return { status: "error", message: error.message, values };
    if (error instanceof z.ZodError) return { status: "error", message: "Correct the highlighted values.", fieldErrors: fieldErrorsFrom(error), values };
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return { status: "error", message: "This club code or file link is already in use.", values };
      if (error.code === "P2025") return { status: "error", message: "This record no longer exists.", values };
    }
    console.error("[clubs] action failed", error);
    return { status: "error", message: "Could not save this club change. Review it and try again.", values };
  }
}

export async function addClub(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const input = clubProfileSchema.parse(Object.fromEntries(formData));
    const club = await createClub(input, actorId);
    return { status: "success", message: `Draft club ${club.code} created.`, id: club.id };
  });
}

export async function editClub(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const clubId = id.parse(formData.get("clubId"));
    const version = clubVersionSchema.parse(formData.get("version"));
    const input = clubProfileSchema.parse(Object.fromEntries(formData));
    await updateClub(clubId, version, input, actorId);
    revalidatePath(`/admin/clubs/${clubId}`);
    return { status: "success", message: "Club profile saved." };
  });
}

export async function setClubStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const clubId = id.parse(formData.get("clubId"));
    const version = clubVersionSchema.parse(formData.get("version"));
    const target = z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).parse(formData.get("target"));
    await changeClubStatus(clubId, version, target, actorId);
    revalidatePath(`/admin/clubs/${clubId}`);
    return { status: "success", message: `Club set to ${target.toLowerCase()}.` };
  });
}

export async function removeClubDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const documentId = id.parse(formData.get("documentId"));
    const clubId = id.parse(formData.get("clubId"));
    await archiveClubDocument(documentId, actorId);
    revalidatePath(`/admin/clubs/${clubId}`);
    return { status: "success", message: "Document archived; history retained." };
  });
}

export async function inviteMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const clubId = id.parse(formData.get("clubId"));
    const userId = id.parse(formData.get("userId"));
    await inviteClubMember(clubId, userId, actorId);
    revalidatePath(`/admin/clubs/${clubId}`);
    return { status: "success", message: "Existing account invited. Membership remains inactive until consent and approval." };
  });
}

export async function decideMembership(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const clubId = id.parse(formData.get("clubId"));
    const membershipId = id.parse(formData.get("membershipId"));
    const version = clubVersionSchema.parse(formData.get("version"));
    const decision = z.enum(["APPROVE", "REJECT"]).parse(formData.get("decision"));
    const reason = z.string().trim().max(1000).parse(formData.get("reason") ?? "");
    await reviewClubMembership(membershipId, version, actorId, decision, reason);
    revalidatePath(`/admin/clubs/${clubId}`);
    return { status: "success", message: decision === "APPROVE" ? "Membership approved." : "Membership rejected." };
  });
}

export async function setCoordinator(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const clubId = id.parse(formData.get("clubId"));
    const userId = id.parse(formData.get("userId"));
    const version = clubVersionSchema.parse(formData.get("version"));
    await appointClubCoordinator(clubId, userId, version, actorId);
    revalidatePath(`/admin/clubs/${clubId}`);
    return { status: "success", message: "Coordinator appointed from approved members." };
  });
}

export async function endMembership(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const clubId = id.parse(formData.get("clubId"));
    const membershipId = id.parse(formData.get("membershipId"));
    const version = clubVersionSchema.parse(formData.get("version"));
    const target = z.enum(["SUSPENDED", "ENDED"]).parse(formData.get("target"));
    const reason = z.string().trim().min(3).max(1000).parse(formData.get("reason"));
    await closeClubMembership(membershipId, version, actorId, target, reason);
    revalidatePath(`/admin/clubs/${clubId}`);
    return { status: "success", message: `Membership ${target.toLowerCase()}; history retained.` };
  });
}
