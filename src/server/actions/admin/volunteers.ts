"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { formValues } from "@/lib/action-state";
import { requireAdmin, UnauthorizedError } from "@/server/auth-guard";
import { reviewVolunteerRecord, VolunteerError } from "@/server/volunteers/service";
import { volunteerVersionSchema } from "@/lib/validations/volunteer";

export async function decideVolunteerRecord(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await requireAdmin("ADMIN");
    const kind = z.enum(["ATTENDANCE", "SERVICE"]).parse(formData.get("kind"));
    const id = z.string().min(1).max(64).parse(formData.get("id"));
    const version = volunteerVersionSchema.parse(formData.get("version"));
    const decision = z.enum(["APPROVED", "REJECTED", "VOIDED"]).parse(formData.get("decision"));
    const reason = z.string().trim().max(1000).parse(formData.get("reason") ?? "");
    await reviewVolunteerRecord(kind, id, version, actor.id, decision, reason);
    revalidatePath("/admin/volunteers");
    revalidatePath("/volunteer");
    return { status: "success", message: `${kind === "ATTENDANCE" ? "Attendance" : "Service hours"} ${decision.toLowerCase()}.` };
  } catch (error) {
    if (error instanceof VolunteerError || error instanceof UnauthorizedError) return { status: "error", message: error.message, values };
    if (error instanceof z.ZodError) return { status: "error", message: "Check the review fields.", values };
    console.error("[volunteers] admin review failed", error);
    return { status: "error", message: "Could not review this record. Reload and try again.", values };
  }
}
