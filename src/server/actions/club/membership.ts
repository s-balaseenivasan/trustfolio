"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { formValues } from "@/lib/action-state";
import { rateLimit } from "@/lib/rate-limit";
import { getAdminUser } from "@/server/auth-guard";
import { ClubError, requestClubMembership } from "@/server/clubs/service";

export async function requestMyClubMembership(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await getAdminUser();
    if (!actor) return { status: "error", message: "Sign in before requesting membership.", values };
    const clubId = z.string().min(1).max(64).parse(formData.get("clubId"));
    const acceptedConsent = formData.get("consent") === "yes";
    const adultAttested = formData.get("adult") === "yes";
    if (!acceptedConsent || !adultAttested) return { status: "error", message: "Confirm both the adult declaration and membership data use.", values };
    const limit = await rateLimit(`club-request:${actor.id}`, { limit: 10, windowMs: 60 * 60 * 1000 });
    if (!limit.success) return { status: "error", message: "Too many membership requests. Try again later.", values };
    await requestClubMembership(clubId, actor.id, actor.id, acceptedConsent, adultAttested);
    revalidatePath("/club");
    return { status: "success", message: "Request submitted. A trust administrator must approve it." };
  } catch (error) {
    if (error instanceof ClubError) return { status: "error", message: error.message, values };
    if (error instanceof z.ZodError) return { status: "error", message: "Choose a valid club and confirm both declarations.", values };
    console.error("[clubs] membership request failed", error);
    return { status: "error", message: "Could not submit the request. Try again later.", values };
  }
}
