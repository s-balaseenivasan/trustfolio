import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { VOLUNTEER_CONSENT_VERSION } from "@/lib/validations/volunteer";
import type { ClubAssignmentInput, MilestoneInput, ProjectPlanInput, TaskInput, TaskProgressInput } from "@/lib/validations/project-operations";

export class ProjectOperationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "ProjectOperationError"; }
}
const audit = (actorId: string, eventType: string, subjectType: string, subjectId: string, details: Prisma.InputJsonValue = {}) => ({ actorId, eventType, subjectType, subjectId, correlationId: randomUUID(), details });
const day = (value: string | null) => value ? new Date(`${value}T00:00:00.000Z`) : null;
const nullable = (value: string) => value || null;

export async function saveProjectPlan(projectId: string, expectedVersion: number, input: ProjectPlanInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { operationalStatus: true, operationalVersion: true } });
    if (!project || project.operationalVersion !== expectedVersion) throw new ProjectOperationError("PROJECT_CONFLICT", "The project plan changed. Reload it before saving.");
    if (["COMPLETED", "CANCELLED"].includes(project.operationalStatus)) throw new ProjectOperationError("PROJECT_CLOSED", "A completed or cancelled project plan cannot be edited.");
    const people = [input.ownerId, input.managerId].filter((value): value is string => Boolean(value));
    if (people.length && await tx.user.count({ where: { id: { in: people } } }) !== new Set(people).size) throw new ProjectOperationError("USER_NOT_FOUND", "Choose existing accounts for owner and manager.");
    const changed = await tx.project.updateMany({ where: { id: projectId, operationalVersion: expectedVersion }, data: { ownerId: input.ownerId, managerId: input.managerId, operationalStartDate: day(input.operationalStartDate), operationalEndDate: day(input.operationalEndDate), beneficiaryPlan: nullable(input.beneficiaryPlan), budgetPlanningNote: nullable(input.budgetPlanningNote), operationalVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new ProjectOperationError("PROJECT_CONFLICT", "The project plan changed. Reload it before saving.");
    await tx.auditEvent.create({ data: audit(actorId, "PROJECT_PLAN_UPDATED", "Project", projectId, { version: expectedVersion + 1 }) });
  }, { isolationLevel: "Serializable" });
}

const projectTransitions = { DRAFT: ["PLANNED", "CANCELLED"], PLANNED: ["ACTIVE", "PAUSED", "CANCELLED"], ACTIVE: ["PAUSED", "COMPLETED", "CANCELLED"], PAUSED: ["ACTIVE", "CANCELLED"], COMPLETED: [], CANCELLED: [] } as const;
export async function changeProjectOperationalStatus(projectId: string, expectedVersion: number, target: "PLANNED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED", actorId: string) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { operationalStatus: true, operationalVersion: true } });
    if (!project || project.operationalVersion !== expectedVersion) throw new ProjectOperationError("PROJECT_CONFLICT", "The project changed. Reload it before changing status.");
    if (!(projectTransitions[project.operationalStatus] as readonly string[]).includes(target)) throw new ProjectOperationError("INVALID_PROJECT_TRANSITION", "That operational status change is unavailable.");
    if (target === "COMPLETED") {
      const [openTasks, openMilestones] = await Promise.all([
        tx.projectTask.count({ where: { projectId, status: { notIn: ["APPROVED", "CANCELLED"] } } }),
        tx.projectMilestone.count({ where: { projectId, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
      ]);
      if (openTasks || openMilestones) throw new ProjectOperationError("PROJECT_WORK_OPEN", "Resolve every task and milestone before completion.");
    }
    const changed = await tx.project.updateMany({ where: { id: projectId, operationalVersion: expectedVersion, operationalStatus: project.operationalStatus }, data: { operationalStatus: target, operationalVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new ProjectOperationError("PROJECT_CONFLICT", "The project changed. Reload it before changing status.");
    await tx.auditEvent.create({ data: audit(actorId, `PROJECT_OPERATIONAL_${target}`, "Project", projectId, { from: project.operationalStatus, version: expectedVersion + 1 }) });
  }, { isolationLevel: "Serializable" });
}

async function requireActiveMember(tx: Prisma.TransactionClient, clubId: string, userId: string) {
  const member = await tx.clubMembership.findUnique({ where: { clubId_userId: { clubId, userId } }, select: { status: true, club: { select: { status: true } } } });
  if (member?.status !== "ACTIVE" || member.club.status !== "ACTIVE") throw new ProjectOperationError("CLUB_MEMBERSHIP_REQUIRED", "Choose an approved member of an active club.");
}

export async function createProjectClubAssignment(projectId: string, input: ClubAssignmentInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { operationalStatus: true } });
    if (!project || ["COMPLETED", "CANCELLED"].includes(project.operationalStatus)) throw new ProjectOperationError("PROJECT_CLOSED", "This project is unavailable for new assignments.");
    await requireActiveMember(tx, input.clubId, input.coordinatorId);
    const row = await tx.projectClubAssignment.create({ data: { projectId, clubId: input.clubId, coordinatorId: input.coordinatorId, responsibilities: input.responsibilities, canViewTasks: input.canViewTasks, canReportContribution: input.canReportContribution, createdById: actorId } });
    await tx.projectClubAssignmentHistory.create({ data: { assignmentId: row.id, actorId, toStatus: "ACTIVE", snapshot: { coordinatorId: row.coordinatorId, responsibilities: row.responsibilities, canViewTasks: row.canViewTasks, canReportContribution: row.canReportContribution } } });
    await tx.auditEvent.create({ data: audit(actorId, "PROJECT_CLUB_ASSIGNED", "ProjectClubAssignment", row.id, { projectId, clubId: input.clubId }) });
    return row;
  }, { isolationLevel: "Serializable" });
}

export async function updateProjectClubAssignment(id: string, expectedVersion: number, input: ClubAssignmentInput & { status: "ACTIVE" | "PAUSED" | "ENDED"; reason: string }, actorId: string) {
  return db.$transaction(async (tx) => {
    const row = await tx.projectClubAssignment.findUnique({ where: { id }, include: { project: { select: { operationalStatus: true } } } });
    if (!row || row.version !== expectedVersion) throw new ProjectOperationError("ASSIGNMENT_CONFLICT", "This assignment changed. Reload it before saving.");
    if (row.clubId !== input.clubId) throw new ProjectOperationError("ASSIGNMENT_CLUB_FIXED", "An assignment's club cannot change. Create a separate club assignment.");
    if (["COMPLETED", "CANCELLED"].includes(row.project.operationalStatus)) throw new ProjectOperationError("PROJECT_CLOSED", "This project is closed.");
    if (row.status === "ENDED" && input.status !== "ACTIVE") throw new ProjectOperationError("INVALID_ASSIGNMENT_TRANSITION", "An ended assignment can only be reactivated by a trust admin.");
    if (input.status !== row.status && ["ENDED", "ACTIVE"].includes(input.status) && input.reason.trim().length < 3) throw new ProjectOperationError("REASON_REQUIRED", "Give a reason for ending or reactivating this assignment.");
    if (input.status === "ACTIVE") await requireActiveMember(tx, row.clubId, input.coordinatorId);
    const changed = await tx.projectClubAssignment.updateMany({ where: { id, version: expectedVersion }, data: { coordinatorId: input.coordinatorId, responsibilities: input.responsibilities, status: input.status, canViewTasks: input.canViewTasks, canReportContribution: input.canReportContribution, endedAt: input.status === "ENDED" ? new Date() : null, version: { increment: 1 } } });
    if (changed.count !== 1) throw new ProjectOperationError("ASSIGNMENT_CONFLICT", "This assignment changed. Reload it before saving.");
    await tx.projectClubAssignmentHistory.create({ data: { assignmentId: id, actorId, fromStatus: row.status, toStatus: input.status, reason: input.reason.trim() || null, snapshot: { previousCoordinatorId: row.coordinatorId, coordinatorId: input.coordinatorId, responsibilities: input.responsibilities, canViewTasks: input.canViewTasks, canReportContribution: input.canReportContribution } } });
    await tx.auditEvent.create({ data: audit(actorId, "PROJECT_CLUB_ASSIGNMENT_UPDATED", "ProjectClubAssignment", id, { version: expectedVersion + 1, status: input.status }) });
  }, { isolationLevel: "Serializable" });
}

/** The club portal must check the assignment, club membership and project on every read. */
export async function requireProjectClubCoordinator(userId: string, assignmentId: string, permission: "view" | "report" | "either") {
  const row = await db.projectClubAssignment.findUnique({ where: { id: assignmentId }, include: { club: { select: { status: true } }, project: { select: { operationalStatus: true } } } });
  if (!row || row.status !== "ACTIVE" || row.club.status !== "ACTIVE" || row.coordinatorId !== userId || !["ACTIVE", "PLANNED"].includes(row.project.operationalStatus) || (permission === "view" && !row.canViewTasks) || (permission === "report" && !row.canReportContribution) || (permission === "either" && !row.canViewTasks && !row.canReportContribution)) throw new ProjectOperationError("PROJECT_SCOPE_DENIED", "You do not have access to this project assignment.");
  const member = await db.clubMembership.findUnique({ where: { clubId_userId: { clubId: row.clubId, userId } }, select: { status: true } });
  if (member?.status !== "ACTIVE") throw new ProjectOperationError("PROJECT_SCOPE_DENIED", "You do not have access to this project assignment.");
  return row;
}

export async function addProjectClubContribution(assignmentId: string, description: string, occurredAt: Date, actor: { id: string; role: string }) {
  if (actor.role !== "ADMIN") await requireProjectClubCoordinator(actor.id, assignmentId, "report");
  return db.$transaction(async (tx) => {
    const row = await tx.projectClubAssignment.findUnique({ where: { id: assignmentId }, include: { club: { select: { status: true } }, project: { select: { operationalStatus: true } } } });
    if (!row || row.status !== "ACTIVE" || row.club.status !== "ACTIVE" || row.project.operationalStatus !== "ACTIVE") throw new ProjectOperationError("ASSIGNMENT_INACTIVE", "Contribution reporting requires active project and club assignments.");
    if (actor.role !== "ADMIN") {
      if (row.coordinatorId !== actor.id || !row.canReportContribution) throw new ProjectOperationError("PROJECT_SCOPE_DENIED", "Contribution reporting is unavailable.");
      await requireActiveMember(tx, row.clubId, actor.id);
    }
    const activity = await tx.projectClubActivity.create({ data: { assignmentId, actorId: actor.id, description, occurredAt } });
    await tx.auditEvent.create({ data: audit(actor.id, "PROJECT_CLUB_CONTRIBUTION_RECORDED", "ProjectClubAssignment", assignmentId, { activityId: activity.id }) });
    return activity;
  }, { isolationLevel: "Serializable" });
}

export async function createProjectMilestone(projectId: string, input: MilestoneInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { operationalStatus: true } });
    if (!project || ["COMPLETED", "CANCELLED"].includes(project.operationalStatus)) throw new ProjectOperationError("PROJECT_CLOSED", "This project is closed.");
    const row = await tx.projectMilestone.create({ data: { projectId, titleEn: input.titleEn, titleTa: nullable(input.titleTa), description: nullable(input.description), dueDate: day(input.dueDate), createdById: actorId } });
    await tx.auditEvent.create({ data: audit(actorId, "PROJECT_MILESTONE_CREATED", "ProjectMilestone", row.id, { projectId }) });
    return row;
  });
}

export async function changeProjectMilestoneStatus(id: string, expectedVersion: number, target: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED", actorId: string) {
  return db.$transaction(async (tx) => {
    const row = await tx.projectMilestone.findUnique({ where: { id }, include: { project: { select: { operationalStatus: true } } } });
    if (!row || row.version !== expectedVersion) throw new ProjectOperationError("MILESTONE_CONFLICT", "This milestone changed. Reload it before saving.");
    if (["COMPLETED", "CANCELLED"].includes(row.project.operationalStatus)) throw new ProjectOperationError("PROJECT_CLOSED", "This project is closed.");
    if (row.status === "CANCELLED" || (row.status === "COMPLETED" && target !== "COMPLETED")) throw new ProjectOperationError("INVALID_MILESTONE_TRANSITION", "This milestone is already closed.");
    if (target === "COMPLETED" && await tx.projectTask.count({ where: { milestoneId: id, status: { notIn: ["APPROVED", "CANCELLED"] } } })) throw new ProjectOperationError("MILESTONE_TASKS_OPEN", "Resolve linked tasks before completing this milestone.");
    const changed = await tx.projectMilestone.updateMany({ where: { id, version: expectedVersion }, data: { status: target, version: { increment: 1 } } });
    if (changed.count !== 1) throw new ProjectOperationError("MILESTONE_CONFLICT", "This milestone changed. Reload it before saving.");
    await tx.auditEvent.create({ data: audit(actorId, "PROJECT_MILESTONE_STATUS", "ProjectMilestone", id, { from: row.status, to: target, version: expectedVersion + 1 }) });
  }, { isolationLevel: "Serializable" });
}

export async function createProjectTask(projectId: string, input: TaskInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { operationalStatus: true } });
    if (!project || !["PLANNED", "ACTIVE"].includes(project.operationalStatus)) throw new ProjectOperationError("PROJECT_INACTIVE", "Plan or activate the project before creating tasks.");
    const assignment = await tx.projectClubAssignment.findUnique({ where: { id: input.clubAssignmentId }, include: { club: { select: { status: true } } } });
    if (!assignment || assignment.projectId !== projectId || assignment.status !== "ACTIVE" || assignment.club.status !== "ACTIVE") throw new ProjectOperationError("ASSIGNMENT_INACTIVE", "Choose an active assignment for this project.");
    if (input.parentId) {
      const parent = await tx.projectTask.findUnique({ where: { id: input.parentId }, select: { projectId: true, clubAssignmentId: true, status: true } });
      if (!parent || parent.projectId !== projectId || parent.clubAssignmentId !== input.clubAssignmentId || parent.status === "CANCELLED") throw new ProjectOperationError("TASK_PARENT_INVALID", "Choose a parent task in the same project and club assignment.");
    }
    if (input.milestoneId) {
      const milestone = await tx.projectMilestone.findUnique({ where: { id: input.milestoneId }, select: { projectId: true, status: true } });
      if (!milestone || milestone.projectId !== projectId || milestone.status === "CANCELLED") throw new ProjectOperationError("TASK_MILESTONE_INVALID", "Choose a milestone in the same project.");
    }
    const row = await tx.projectTask.create({ data: { projectId, clubAssignmentId: input.clubAssignmentId, milestoneId: input.milestoneId, parentId: input.parentId, titleEn: input.titleEn, titleTa: nullable(input.titleTa), description: nullable(input.description), priority: input.priority, startDate: day(input.startDate), dueDate: day(input.dueDate), createdById: actorId } });
    await tx.projectTaskHistory.create({ data: { taskId: row.id, actorId, toStatus: "TODO", toProgress: 0, note: "Task created" } });
    await tx.auditEvent.create({ data: audit(actorId, "PROJECT_TASK_CREATED", "ProjectTask", row.id, { projectId, assignmentId: assignment.id }) });
    return row;
  }, { isolationLevel: "Serializable" });
}

export async function setTaskVolunteer(taskId: string, userId: string, active: boolean, actorId: string) {
  return db.$transaction(async (tx) => {
    const task = await tx.projectTask.findUnique({ where: { id: taskId }, include: { clubAssignment: { include: { club: { select: { status: true } } } }, project: { select: { operationalStatus: true } } } });
    if (!task || ["APPROVED", "CANCELLED"].includes(task.status) || !["PLANNED", "ACTIVE"].includes(task.project.operationalStatus) || task.clubAssignment.status !== "ACTIVE" || task.clubAssignment.club.status !== "ACTIVE") throw new ProjectOperationError("TASK_UNAVAILABLE", "This task is unavailable for assignments.");
    const profile = await tx.volunteerProfile.findUnique({ where: { userId }, select: { id: true, consentVersion: true } });
    if (!profile || profile.consentVersion !== VOLUNTEER_CONSENT_VERSION) throw new ProjectOperationError("VOLUNTEER_PROFILE_REQUIRED", "Choose a current consented volunteer profile.");
    if (active) await requireActiveMember(tx, task.clubAssignment.clubId, userId);
    const existing = await tx.taskAssignment.findUnique({ where: { taskId_profileId: { taskId, profileId: profile.id } } });
    if (existing?.active === active) throw new ProjectOperationError("TASK_ASSIGNMENT_EXISTS", "That volunteer assignment is already in this state.");
    if (existing) await tx.taskAssignment.update({ where: { id: existing.id }, data: { active, assignedAt: active ? new Date() : existing.assignedAt, endedAt: active ? null : new Date() } });
    else if (active) await tx.taskAssignment.create({ data: { taskId, profileId: profile.id } });
    else throw new ProjectOperationError("TASK_ASSIGNMENT_MISSING", "That volunteer is not assigned to this task.");
    await tx.projectTaskHistory.create({ data: { taskId, actorId, fromStatus: task.status, toStatus: task.status, fromProgress: task.progressPercent, toProgress: task.progressPercent, note: `${active ? "Assigned" : "Removed"} volunteer ${userId}` } });
    await tx.auditEvent.create({ data: audit(actorId, active ? "PROJECT_TASK_VOLUNTEER_ASSIGNED" : "PROJECT_TASK_VOLUNTEER_REMOVED", "ProjectTask", taskId, { userId }) });
    if (active) await tx.notificationOutbox.create({ data: { dedupeKey: `project-task-assigned:${taskId}:${profile.id}:${randomUUID()}`, recipientId: userId, templateKey: "PROJECT_TASK_ASSIGNED", payload: { taskId } } });
  }, { isolationLevel: "Serializable" });
}

/** An edge task -> predecessor is permitted only within one project and without a path back to task. */
export async function addTaskDependency(taskId: string, predecessorId: string, actorId: string) {
  if (taskId === predecessorId) throw new ProjectOperationError("TASK_DEPENDENCY_CYCLE", "A task cannot depend on itself.");
  return db.$transaction(async (tx) => {
    const [task, predecessor] = await Promise.all([
      tx.projectTask.findUnique({ where: { id: taskId }, select: { projectId: true, status: true, progressPercent: true } }),
      tx.projectTask.findUnique({ where: { id: predecessorId }, select: { projectId: true, status: true } }),
    ]);
    if (!task || !predecessor || task.projectId !== predecessor.projectId) throw new ProjectOperationError("TASK_DEPENDENCY_SCOPE", "Dependencies must stay inside one project.");
    if (["APPROVED", "CANCELLED"].includes(task.status)) throw new ProjectOperationError("TASK_CLOSED", "This task is closed.");
    const edges = await tx.projectTaskDependency.findMany({ where: { task: { projectId: task.projectId } }, select: { taskId: true, predecessorId: true } });
    const graph = new Map<string, string[]>();
    for (const edge of edges) graph.set(edge.taskId, [...(graph.get(edge.taskId) ?? []), edge.predecessorId]);
    const pending = [predecessorId]; const visited = new Set<string>();
    while (pending.length) { const current = pending.pop()!; if (current === taskId) throw new ProjectOperationError("TASK_DEPENDENCY_CYCLE", "This dependency would create a cycle."); if (!visited.has(current)) { visited.add(current); pending.push(...(graph.get(current) ?? [])); } }
    await tx.projectTaskDependency.create({ data: { taskId, predecessorId } });
    await tx.projectTaskHistory.create({ data: { taskId, actorId, fromStatus: task.status, toStatus: task.status, fromProgress: task.progressPercent, toProgress: task.progressPercent, note: `Added predecessor ${predecessorId}` } });
    await tx.auditEvent.create({ data: audit(actorId, "PROJECT_TASK_DEPENDENCY_ADDED", "ProjectTask", taskId, { predecessorId }) });
  }, { isolationLevel: "Serializable" });
}

export async function removeTaskDependency(taskId: string, predecessorId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const task = await tx.projectTask.findUnique({ where: { id: taskId }, select: { status: true, progressPercent: true } });
    if (!task || ["APPROVED", "CANCELLED"].includes(task.status)) throw new ProjectOperationError("TASK_CLOSED", "This task is closed.");
    await tx.projectTaskDependency.delete({ where: { taskId_predecessorId: { taskId, predecessorId } } });
    await tx.projectTaskHistory.create({ data: { taskId, actorId, fromStatus: task.status, toStatus: task.status, fromProgress: task.progressPercent, toProgress: task.progressPercent, note: `Removed predecessor ${predecessorId}` } });
    await tx.auditEvent.create({ data: audit(actorId, "PROJECT_TASK_DEPENDENCY_REMOVED", "ProjectTask", taskId, { predecessorId }) });
  });
}

export async function requireVolunteerTask(userId: string, taskId: string) {
  const row = await db.projectTask.findUnique({ where: { id: taskId }, include: { project: { select: { operationalStatus: true } }, clubAssignment: { include: { club: { select: { status: true } } } }, assignments: { where: { active: true }, include: { profile: { select: { userId: true, consentVersion: true } } } } } });
  if (!row || row.project.operationalStatus !== "ACTIVE" || row.clubAssignment.status !== "ACTIVE" || row.clubAssignment.club.status !== "ACTIVE" || !row.assignments.some((item) => item.profile.userId === userId && item.profile.consentVersion === VOLUNTEER_CONSENT_VERSION)) throw new ProjectOperationError("TASK_SCOPE_DENIED", "You do not have access to this task.");
  const member = await db.clubMembership.findUnique({ where: { clubId_userId: { clubId: row.clubAssignment.clubId, userId } }, select: { status: true } });
  if (member?.status !== "ACTIVE") throw new ProjectOperationError("TASK_SCOPE_DENIED", "You do not have access to this task.");
  return row;
}

export async function requireTaskReader(actor: { id: string; role: string }, taskId: string) {
  const task = await db.projectTask.findUnique({ where: { id: taskId }, select: { id: true, clubAssignmentId: true } });
  if (!task) throw new ProjectOperationError("TASK_NOT_FOUND", "Task unavailable.");
  if (actor.role === "ADMIN") return task;
  try { await requireVolunteerTask(actor.id, taskId); return task; } catch (error) { if (!(error instanceof ProjectOperationError)) throw error; }
  await requireProjectClubCoordinator(actor.id, task.clubAssignmentId, "view");
  return task;
}

export async function updateMyTask(taskId: string, expectedVersion: number, input: TaskProgressInput, userId: string) {
  return db.$transaction(async (tx) => {
    const task = await tx.projectTask.findUnique({ where: { id: taskId }, include: { project: { select: { operationalStatus: true } }, clubAssignment: { include: { club: { select: { status: true } } } }, assignments: { where: { active: true }, include: { profile: { select: { userId: true, consentVersion: true } } } }, dependencies: { include: { predecessor: { select: { status: true } } } } } });
    if (!task || task.version !== expectedVersion) throw new ProjectOperationError("TASK_CONFLICT", "This task changed. Reload it before saving.");
    if (task.project.operationalStatus !== "ACTIVE" || task.clubAssignment.status !== "ACTIVE" || task.clubAssignment.club.status !== "ACTIVE" || !task.assignments.some((item) => item.profile.userId === userId && item.profile.consentVersion === VOLUNTEER_CONSENT_VERSION)) throw new ProjectOperationError("TASK_SCOPE_DENIED", "You do not have access to this task.");
    await requireActiveMember(tx, task.clubAssignment.clubId, userId);
    if (!["TODO", "IN_PROGRESS"].includes(task.status)) throw new ProjectOperationError("TASK_STATE_DENIED", "This task is awaiting review or has been closed.");
    if (task.dependencies.some((edge) => edge.predecessor.status !== "APPROVED")) throw new ProjectOperationError("TASK_DEPENDENCY_OPEN", "Complete predecessor tasks before updating this task.");
    if (input.submit && input.progressPercent !== 100) throw new ProjectOperationError("TASK_NOT_COMPLETE", "Set progress to 100% before submitting completion.");
    const target = input.submit ? "SUBMITTED" : "IN_PROGRESS";
    const changed = await tx.projectTask.updateMany({ where: { id: taskId, version: expectedVersion, status: task.status }, data: { status: target, progressPercent: input.progressPercent, version: { increment: 1 } } });
    if (changed.count !== 1) throw new ProjectOperationError("TASK_CONFLICT", "This task changed. Reload it before saving.");
    await tx.projectTaskHistory.create({ data: { taskId, actorId: userId, fromStatus: task.status, toStatus: target, fromProgress: task.progressPercent, toProgress: input.progressPercent, note: input.note } });
    await tx.auditEvent.create({ data: audit(userId, input.submit ? "PROJECT_TASK_SUBMITTED" : "PROJECT_TASK_PROGRESS", "ProjectTask", taskId, { version: expectedVersion + 1, progress: input.progressPercent }) });
    return target;
  }, { isolationLevel: "Serializable" });
}

export async function reviewTaskCompletion(taskId: string, expectedVersion: number, actorId: string, decision: "APPROVE" | "RETURN", reason: string) {
  if (decision === "RETURN" && reason.trim().length < 3) throw new ProjectOperationError("REASON_REQUIRED", "Give a reason when returning a task.");
  return db.$transaction(async (tx) => {
    const task = await tx.projectTask.findUnique({ where: { id: taskId }, include: { assignments: { include: { profile: { select: { userId: true } } } }, dependencies: { include: { predecessor: { select: { status: true } } } }, subtasks: { select: { status: true } } } });
    if (!task || task.version !== expectedVersion || task.status !== "SUBMITTED") throw new ProjectOperationError("TASK_CONFLICT", "This task changed or is no longer submitted.");
    if (task.assignments.some((row) => row.profile.userId === actorId)) throw new ProjectOperationError("SELF_APPROVAL", "You cannot review your own assigned task.");
    if (decision === "APPROVE" && (task.dependencies.some((edge) => edge.predecessor.status !== "APPROVED") || task.subtasks.some((row) => !["APPROVED", "CANCELLED"].includes(row.status)))) throw new ProjectOperationError("TASK_WORK_OPEN", "Resolve dependencies and subtasks before approval.");
    const target = decision === "APPROVE" ? "APPROVED" : "IN_PROGRESS";
    const changed = await tx.projectTask.updateMany({ where: { id: taskId, version: expectedVersion, status: "SUBMITTED" }, data: { status: target, completedAt: decision === "APPROVE" ? new Date() : null, version: { increment: 1 } } });
    if (changed.count !== 1) throw new ProjectOperationError("TASK_CONFLICT", "This task changed. Reload it before deciding.");
    await tx.projectTaskHistory.create({ data: { taskId, actorId, fromStatus: "SUBMITTED", toStatus: target, fromProgress: task.progressPercent, toProgress: task.progressPercent, note: reason.trim() || (decision === "APPROVE" ? "Completion reviewed and approved" : null) } });
    await tx.auditEvent.create({ data: audit(actorId, `PROJECT_TASK_${target}`, "ProjectTask", taskId, { version: expectedVersion + 1 }) });
    for (const assignment of task.assignments.filter((row) => row.active)) await tx.notificationOutbox.create({ data: { dedupeKey: `project-task-review:${taskId}:v${expectedVersion + 1}:${assignment.profile.userId}`, recipientId: assignment.profile.userId, templateKey: `PROJECT_TASK_${target}`, payload: { taskId } } });
    return target;
  }, { isolationLevel: "Serializable" });
}

export async function setTaskAdministrativeStatus(taskId: string, expectedVersion: number, target: "BLOCKED" | "IN_PROGRESS" | "CANCELLED", reason: string, actorId: string) {
  if (reason.trim().length < 3) throw new ProjectOperationError("REASON_REQUIRED", "Give a reason for this task status change.");
  return db.$transaction(async (tx) => {
    const task = await tx.projectTask.findUnique({ where: { id: taskId }, select: { status: true, version: true, progressPercent: true } });
    if (!task || task.version !== expectedVersion || ["APPROVED", "CANCELLED"].includes(task.status)) throw new ProjectOperationError("TASK_CONFLICT", "This task changed or is closed.");
    if (target === "IN_PROGRESS" && task.status !== "BLOCKED") throw new ProjectOperationError("INVALID_TASK_TRANSITION", "Only a blocked task may be resumed by this action.");
    const changed = await tx.projectTask.updateMany({ where: { id: taskId, version: expectedVersion }, data: { status: target, version: { increment: 1 } } });
    if (changed.count !== 1) throw new ProjectOperationError("TASK_CONFLICT", "This task changed. Reload it before saving.");
    await tx.projectTaskHistory.create({ data: { taskId, actorId, fromStatus: task.status, toStatus: target, fromProgress: task.progressPercent, toProgress: task.progressPercent, note: reason.trim() } });
    await tx.auditEvent.create({ data: audit(actorId, `PROJECT_TASK_${target}`, "ProjectTask", taskId, { version: expectedVersion + 1 }) });
  }, { isolationLevel: "Serializable" });
}

export async function createTaskEvidenceFromUpload(input: { taskId: string; title: string; kind: "ATTACHMENT" | "COMPLETION"; filename: string; mimeType: string; size: number; url: string; storageKey: string }, actor: { id: string; role: string }) {
  if (!input.storageKey.startsWith("private/project-task-evidence/")) throw new ProjectOperationError("PRIVATE_FILE_REQUIRED", "Choose a dedicated private task file.");
  if (actor.role !== "ADMIN") await requireVolunteerTask(actor.id, input.taskId);
  return db.$transaction(async (tx) => {
    const task = await tx.projectTask.findUnique({ where: { id: input.taskId }, include: { project: { select: { operationalStatus: true } }, clubAssignment: { include: { club: { select: { status: true } } } }, assignments: { where: { active: true }, include: { profile: { select: { userId: true } } } } } });
    if (!task || !["TODO", "IN_PROGRESS"].includes(task.status) || task.project.operationalStatus !== "ACTIVE" || task.clubAssignment.status !== "ACTIVE" || task.clubAssignment.club.status !== "ACTIVE") throw new ProjectOperationError("TASK_UNAVAILABLE", "This task cannot accept evidence now.");
    if (actor.role !== "ADMIN") {
      if (!task.assignments.some((assignment) => assignment.profile.userId === actor.id)) throw new ProjectOperationError("TASK_SCOPE_DENIED", "You cannot attach evidence to this task.");
      await requireActiveMember(tx, task.clubAssignment.clubId, actor.id);
    }
    const media = await tx.media.create({ data: { url: input.url, storageKey: input.storageKey, filename: input.filename, mimeType: input.mimeType, size: input.size, visibility: "PRIVATE", uploadedById: actor.id } });
    const row = await tx.projectTaskEvidence.create({ data: { taskId: input.taskId, mediaId: media.id, kind: input.kind, title: input.title, createdById: actor.id } });
    await tx.projectTaskHistory.create({ data: { taskId: input.taskId, actorId: actor.id, fromStatus: task.status, toStatus: task.status, fromProgress: task.progressPercent, toProgress: task.progressPercent, note: `${input.kind === "COMPLETION" ? "Completion evidence" : "Attachment"} uploaded: ${row.id}` } });
    await tx.auditEvent.create({ data: audit(actor.id, "PROJECT_TASK_EVIDENCE_UPLOADED", "ProjectTask", input.taskId, { evidenceId: row.id }) });
    return row;
  }, { isolationLevel: "Serializable" });
}
