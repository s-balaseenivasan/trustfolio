"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsFrom, formValues } from "@/lib/action-state";
import { clubAssignmentSchema, milestoneSchema, operationalVersionSchema, projectPlanSchema, taskSchema } from "@/lib/validations/project-operations";
import { requireAdmin, UnauthorizedError } from "@/server/auth-guard";
import { addTaskDependency, changeProjectMilestoneStatus, changeProjectOperationalStatus, createProjectClubAssignment, createProjectMilestone, createProjectTask, ProjectOperationError, removeTaskDependency, reviewTaskCompletion, saveProjectPlan, setTaskAdministrativeStatus, setTaskVolunteer, updateProjectClubAssignment } from "@/server/projects/service";

const id = z.string().min(1).max(64);
async function run(formData: FormData, work: (actorId: string) => Promise<{ message: string; projectId?: string; id?: string }>): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await requireAdmin("ADMIN");
    const result = await work(actor.id);
    if (result.projectId) revalidatePath(`/admin/project-operations/${result.projectId}`);
    revalidatePath("/admin/project-operations");
    revalidatePath("/volunteer/tasks");
    revalidatePath("/club");
    return { status: "success", message: result.message, id: result.id };
  } catch (error) {
    if (error instanceof ProjectOperationError || error instanceof UnauthorizedError) return { status: "error", message: error.message, values };
    if (error instanceof z.ZodError) return { status: "error", message: "Correct the highlighted fields.", fieldErrors: fieldErrorsFrom(error), values };
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return { status: "error", message: "That project, club, volunteer or dependency link already exists.", values };
      if (error.code === "P2025") return { status: "error", message: "That record no longer exists.", values };
      if (error.code === "P2034") return { status: "error", message: "A concurrent change occurred. Reload and try again.", values };
    }
    console.error("[project-operations] admin action failed", error);
    return { status: "error", message: "Could not save this project change. Reload and try again.", values };
  }
}

export async function saveOperationalPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    await saveProjectPlan(projectId, operationalVersionSchema.parse(formData.get("version")), projectPlanSchema.parse(Object.fromEntries(formData)), actorId);
    return { message: "Project plan saved. Public project content is unchanged.", projectId };
  });
}
export async function setOperationalStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    await changeProjectOperationalStatus(projectId, operationalVersionSchema.parse(formData.get("version")), z.enum(["PLANNED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]).parse(formData.get("target")), actorId);
    return { message: "Operational status changed. Publication is unchanged.", projectId };
  });
}
export async function addProjectClub(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    const input = clubAssignmentSchema.parse({ ...Object.fromEntries(formData), canViewTasks: formData.get("canViewTasks") === "yes", canReportContribution: formData.get("canReportContribution") === "yes" });
    const row = await createProjectClubAssignment(projectId, input, actorId);
    return { message: "Club assigned to this project.", projectId, id: row.id };
  });
}
export async function editProjectClub(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    const assignmentId = id.parse(formData.get("assignmentId"));
    const input = clubAssignmentSchema.parse({ ...Object.fromEntries(formData), canViewTasks: formData.get("canViewTasks") === "yes", canReportContribution: formData.get("canReportContribution") === "yes" });
    const status = z.enum(["ACTIVE", "PAUSED", "ENDED"]).parse(formData.get("status"));
    const reason = z.string().trim().max(1000).parse(formData.get("reason") ?? "");
    await updateProjectClubAssignment(assignmentId, operationalVersionSchema.parse(formData.get("version")), { ...input, status, reason }, actorId);
    return { message: "Club assignment saved; history retained.", projectId };
  });
}
export async function addMilestone(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    const row = await createProjectMilestone(projectId, milestoneSchema.parse(Object.fromEntries(formData)), actorId);
    return { message: "Milestone added.", projectId, id: row.id };
  });
}
export async function setMilestoneStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    await changeProjectMilestoneStatus(id.parse(formData.get("milestoneId")), operationalVersionSchema.parse(formData.get("version")), z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).parse(formData.get("target")), actorId);
    return { message: "Milestone status changed.", projectId };
  });
}
export async function addTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    const row = await createProjectTask(projectId, taskSchema.parse(Object.fromEntries(formData)), actorId);
    return { message: "Task created for this project and club.", projectId, id: row.id };
  });
}
export async function changeTaskVolunteer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    const active = z.enum(["ASSIGN", "REMOVE"]).parse(formData.get("mode")) === "ASSIGN";
    await setTaskVolunteer(id.parse(formData.get("taskId")), id.parse(formData.get("userId")), active, actorId);
    return { message: active ? "Volunteer assigned to task." : "Volunteer removed from task.", projectId };
  });
}
export async function changeTaskDependency(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    const taskId = id.parse(formData.get("taskId"));
    const predecessorId = id.parse(formData.get("predecessorId"));
    const add = z.enum(["ADD", "REMOVE"]).parse(formData.get("mode")) === "ADD";
    if (add) await addTaskDependency(taskId, predecessorId, actorId); else await removeTaskDependency(taskId, predecessorId, actorId);
    return { message: add ? "Dependency added." : "Dependency removed.", projectId };
  });
}
export async function decideTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    const decision = z.enum(["APPROVE", "RETURN"]).parse(formData.get("decision"));
    await reviewTaskCompletion(id.parse(formData.get("taskId")), operationalVersionSchema.parse(formData.get("version")), actorId, decision, z.string().trim().max(1000).parse(formData.get("reason") ?? ""));
    return { message: decision === "APPROVE" ? "Task completion approved." : "Task returned for correction.", projectId };
  });
}
export async function setTaskStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (actorId) => {
    const projectId = id.parse(formData.get("projectId"));
    const target = z.enum(["BLOCKED", "IN_PROGRESS", "CANCELLED"]).parse(formData.get("target"));
    await setTaskAdministrativeStatus(id.parse(formData.get("taskId")), operationalVersionSchema.parse(formData.get("version")), target, z.string().trim().min(3).max(1000).parse(formData.get("reason")), actorId);
    return { message: `Task ${target.toLowerCase()}.`, projectId };
  });
}
