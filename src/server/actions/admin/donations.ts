"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsFrom, formValues } from "@/lib/action-state";
import { donorProfileSchema, manualDonationIntakeSchema } from "@/lib/validations/donations";
import { requireAdmin, UnauthorizedError } from "@/server/auth-guard";
import { createDonorProfile, createPendingManualDonation, DonationError } from "@/server/donations/service";

async function run(formData: FormData, work: (actorId: string) => Promise<string>): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await requireAdmin("ADMIN");
    const message = await work(actor.id);
    revalidatePath("/admin/donations");
    revalidatePath("/donor");
    return { status: "success", message };
  } catch (error) {
    if (error instanceof DonationError) return { status: "error", code: error.code, message: error.message, values };
    if (error instanceof UnauthorizedError) return { status: "error", code: "UNAUTHORIZED", message: error.message, values };
    if (error instanceof z.ZodError) return { status: "error", code: "VALIDATION_ERROR", message: "Correct the highlighted fields.", fieldErrors: fieldErrorsFrom(error), values };
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return { status: "error", code: "DUPLICATE_DONOR", message: "This account already has a donor profile.", values };
      if (error.code === "P2025") return { status: "error", code: "NOT_FOUND", message: "The selected record is no longer available.", values };
      if (error.code === "P2034") return { status: "error", code: "CONCURRENT_CHANGE", message: "A concurrent change occurred. Reload and try again.", values };
    }
    console.error("[donations] admin intake failed", error);
    return { status: "error", code: "DONATION_SAVE_FAILED", message: "Could not save this private intake record. Try again.", values };
  }
}

export async function linkDonorAccount(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    await createDonorProfile(donorProfileSchema.parse(Object.fromEntries(formData)), actorId);
    return "Existing portal account linked as a private donor profile.";
  });
}

export async function recordManualDonationIntake(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    await createPendingManualDonation(manualDonationIntakeSchema.parse(Object.fromEntries(formData)), actorId);
    return "Offline donation recorded as pending verification. It is excluded from confirmed totals and balances.";
  });
}
