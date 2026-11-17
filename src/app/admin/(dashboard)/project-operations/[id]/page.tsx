import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectOperationsEditor } from "@/components/admin/project-operations";
import { PageHeader } from "@/components/admin/page-header";
import { db } from "@/lib/db";
import { VOLUNTEER_CONSENT_VERSION } from "@/lib/validations/volunteer";
import { requireAdminPage } from "@/server/auth-guard";

export const metadata: Metadata = { title: "Project operations" };
export default async function ProjectOperationDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("ADMIN");
  const { id } = await params;
  if (id.length > 64) notFound();
  const query = await searchParams;
  const pageValue = Number(query.taskPage);
  const taskPage = Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 10000) : 1;
  const [project, clubs, users, tasks, taskCount, taskOptions] = await Promise.all([
    db.project.findUnique({ where: { id }, include: { clubAssignments: { include: { club: { select: { nameEn: true } }, history: { orderBy: { createdAt: "desc" }, take: 20 }, activities: { orderBy: { occurredAt: "desc" }, take: 20 } }, orderBy: { assignedAt: "asc" } }, milestones: { orderBy: { createdAt: "asc" } } } }),
    db.club.findMany({ where: { status: "ACTIVE" }, include: { memberships: { where: { status: "ACTIVE" }, include: { user: { select: { id: true, name: true, email: true, volunteerProfile: { select: { consentVersion: true } } } } } } }, orderBy: { nameEn: "asc" }, take: 200 }),
    db.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { email: "asc" }, take: 500 }),
    db.projectTask.findMany({ where: { projectId: id }, include: { clubAssignment: { include: { club: { select: { nameEn: true } } } }, assignments: { include: { profile: { include: { user: { select: { id: true, name: true, email: true } } } } } }, dependencies: { include: { predecessor: { select: { titleEn: true } } } }, history: { orderBy: { createdAt: "desc" }, take: 20 }, evidence: { where: { archivedAt: null }, select: { id: true, title: true, kind: true } } }, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }], skip: (taskPage - 1) * 25, take: 25 }),
    db.projectTask.count({ where: { projectId: id } }),
    db.projectTask.findMany({ where: { projectId: id }, select: { id: true, titleEn: true }, orderBy: { createdAt: "asc" }, take: 500 }),
  ]);
  if (!project) notFound();
  const clubOptions = clubs.map((club) => ({ id: club.id, name: club.nameEn, members: club.memberships.map((member) => ({ id: member.userId, label: member.user.name ?? member.user.email })) }));
  const volunteerOptions: Record<string, { id: string; label: string }[]> = {};
  for (const assignment of project.clubAssignments) {
    const club = clubs.find((row) => row.id === assignment.clubId);
    volunteerOptions[assignment.id] = club?.memberships.filter((row) => row.user.volunteerProfile?.consentVersion === VOLUNTEER_CONSENT_VERSION).map((row) => ({ id: row.userId, label: row.user.name ?? row.user.email })) ?? [];
  }
  const today = new Date().toISOString().slice(0, 10);
  return <div className="space-y-5"><Link href="/admin/project-operations" className="text-sm text-brand underline">← All project operations</Link><PageHeader title={project.titleEn} description="Private operational plan, club assignments, milestones and tasks for the existing project." /><ProjectOperationsEditor project={{ id: project.id, titleEn: project.titleEn, slug: project.slug, status: project.status, operationalStatus: project.operationalStatus, operationalVersion: project.operationalVersion, ownerId: project.ownerId, managerId: project.managerId, operationalStartDate: project.operationalStartDate?.toISOString().slice(0, 10) ?? null, operationalEndDate: project.operationalEndDate?.toISOString().slice(0, 10) ?? null, beneficiaryPlan: project.beneficiaryPlan, budgetPlanningNote: project.budgetPlanningNote }} users={users.map((user) => ({ id: user.id, label: user.name ?? user.email }))} clubs={clubOptions} assignments={project.clubAssignments.map((row) => ({ id: row.id, clubId: row.clubId, clubName: row.club.nameEn, coordinatorId: row.coordinatorId, responsibilities: row.responsibilities, status: row.status, canViewTasks: row.canViewTasks, canReportContribution: row.canReportContribution, version: row.version, history: row.history.map((event) => ({ id: event.id, toStatus: event.toStatus, reason: event.reason, createdAt: event.createdAt.toISOString() })), activities: row.activities.map((event) => ({ id: event.id, description: event.description, occurredAt: event.occurredAt.toISOString().slice(0, 10) })) }))} milestones={project.milestones.map((row) => ({ id: row.id, titleEn: row.titleEn, titleTa: row.titleTa, description: row.description, status: row.status, dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null, version: row.version }))} tasks={tasks.map((row) => ({ id: row.id, titleEn: row.titleEn, titleTa: row.titleTa, description: row.description, clubAssignmentId: row.clubAssignmentId, clubName: row.clubAssignment.club.nameEn, status: row.status, priority: row.priority, progressPercent: row.progressPercent, dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null, startDate: row.startDate?.toISOString().slice(0, 10) ?? null, version: row.version, overdue: Boolean(row.dueDate && row.dueDate.toISOString().slice(0, 10) < today && !["APPROVED", "CANCELLED"].includes(row.status)), assignees: row.assignments.map((assignment) => ({ userId: assignment.profile.userId, label: assignment.profile.user.name ?? assignment.profile.user.email, active: assignment.active })), dependencies: row.dependencies.map((edge) => ({ predecessorId: edge.predecessorId, title: edge.predecessor.titleEn })), history: row.history.map((event) => ({ id: event.id, toStatus: event.toStatus, note: event.note, createdAt: event.createdAt.toISOString() })), evidence: row.evidence }))} taskOptions={taskOptions} volunteerOptions={volunteerOptions} /><div className="flex justify-between text-sm"><span>{taskCount} tasks · page {taskPage}</span><span className="flex gap-4">{taskPage > 1 && <Link href={`/admin/project-operations/${id}?taskPage=${taskPage - 1}#tasks`} className="text-brand underline">Previous</Link>}{taskPage * 25 < taskCount && <Link href={`/admin/project-operations/${id}?taskPage=${taskPage + 1}#tasks`} className="text-brand underline">Next</Link>}</span></div></div>;
}
