"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsFrom, formValues } from "@/lib/action-state";
import { rateLimit } from "@/lib/rate-limit";
import { operationalVersionSchema, taskProgressSchema } from "@/lib/validations/project-operations";
import { getAdminUser } from "@/server/auth-guard";
import { addProjectClubContribution, ProjectOperationError, updateMyTask } from "@/server/projects/service";

export async function updateAssignedTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await getAdminUser();
    if (!actor) return { status: "error", message: "Sign in to update your task.", values };
    const taskId = z.string().min(1).max(64).parse(formData.get("taskId"));
    const limit = await rateLimit(`project-task-progress:${actor.id}`, { limit: 60, windowMs: 60 * 60 * 1000 });
    if (!limit.success) return { status: "error", message: "Too many updates. Try again later.", values };
    const input = taskProgressSchema.parse({ progressPercent: formData.get("progressPercent"), submit: formData.get("submit") === "yes", note: formData.get("note") });
    const target = await updateMyTask(taskId, operationalVersionSchema.parse(formData.get("version")), input, actor.id);
    revalidatePath("/volunteer/tasks"); revalidatePath(`/volunteer/tasks/${taskId}`);
    return { status: "success", message: target === "SUBMITTED" ? "Completion submitted for trust-admin review." : "Progress saved." };
  } catch (error) {
    if (error instanceof ProjectOperationError) return { status: "error", message: error.message, values };
    if (error instanceof z.ZodError) return { status: "error", message: "Correct the task update fields.", fieldErrors: fieldErrorsFrom(error), values };
    console.error("[project-tasks] volunteer progress failed", error);
    return { status: "error", message: "Could not save your task update. Reload and try again.", values };
  }
}

export async function reportClubContribution(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await getAdminUser();
    if (!actor) return { status: "error", message: "Sign in to report contribution.", values };
    const assignmentId = z.string().min(1).max(64).parse(formData.get("assignmentId"));
    const description = z.string().trim().min(3).max(2000).parse(formData.get("description"));
    const occurredDate = z.iso.date().parse(formData.get("occurredDate"));
    const occurredAt = new Date(`${occurredDate}T00:00:00.000Z`);
    if (occurredAt.getTime() > Date.now()) return { status: "error", message: "Contribution date cannot be in the future.", values };
    await addProjectClubContribution(assignmentId, description, occurredAt, actor);
    revalidatePath("/club"); revalidatePath(`/club/projects/${assignmentId}`);
    return { status: "success", message: "Private contribution recorded." };
  } catch (error) {
    if (error instanceof ProjectOperationError) return { status: "error", message: error.message, values };
    if (error instanceof z.ZodError) return { status: "error", message: "Check the contribution fields.", values };
    console.error("[project-tasks] contribution failed", error);
    return { status: "error", message: "Could not record contribution. Reload and try again.", values };
  }
}
