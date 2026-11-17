import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProjectContributionForm } from "@/components/club/project-contribution-form";
import { db } from "@/lib/db";
import { getAdminUser } from "@/server/auth-guard";
import { ProjectOperationError, requireProjectClubCoordinator } from "@/server/projects/service";

export const metadata: Metadata = { title: "Club project assignment" };

export default async function ClubProjectAssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const actor = await getAdminUser();
  if (!actor) redirect("/admin/login?callbackUrl=/club");
  const { assignmentId } = await params;
  if (assignmentId.length > 64) notFound();
  let scope;
  try { scope = await requireProjectClubCoordinator(actor.id, assignmentId, "either"); }
  catch (error) { if (error instanceof ProjectOperationError) notFound(); throw error; }
  const assignment = await db.projectClubAssignment.findUnique({ where: { id: assignmentId }, select: {
    responsibilities: true, assignedAt: true, canViewTasks: true, canReportContribution: true,
    project: { select: { titleEn: true, titleTa: true, operationalStatus: true } },
    club: { select: { nameEn: true } },
    activities: { orderBy: { occurredAt: "desc" }, take: 50, select: { id: true, description: true, occurredAt: true, actor: { select: { name: true } } } },
    tasks: { orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }], take: 100, select: { id: true, titleEn: true, titleTa: true, status: true, priority: true, progressPercent: true, dueDate: true } },
  } });
  if (!assignment || scope.id !== assignmentId) notFound();
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6"><Link href="/club/projects" className="text-sm text-brand underline">← Assigned projects</Link><header className="mt-5 border-b pb-5"><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Assigned project · {assignment.project.operationalStatus}</p><h1 className="mt-1 text-3xl font-semibold">{assignment.project.titleEn}</h1>{assignment.project.titleTa && <p lang="ta" className="mt-1 text-lg text-muted-foreground">{assignment.project.titleTa}</p>}<p className="mt-3 text-sm text-muted-foreground">Assigned {assignment.assignedAt.toLocaleDateString("en-IN")}</p></header><section className="mt-6 rounded-2xl border bg-card p-6"><h2 className="font-semibold">This club’s responsibilities</h2><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{assignment.responsibilities}</p></section>
    {assignment.canViewTasks && <section className="mt-6 rounded-2xl border bg-card p-6"><h2 className="font-semibold">This club’s tasks</h2>{assignment.tasks.length ? <ul className="mt-4 divide-y">{assignment.tasks.map((task) => <li key={task.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><strong>{task.titleEn}</strong>{task.titleTa && <span lang="ta" className="ml-2 text-muted-foreground">{task.titleTa}</span>}</div><span className="text-muted-foreground">{task.status} · {task.progressPercent}%{task.dueDate ? ` · due ${task.dueDate.toISOString().slice(0, 10)}` : ""}</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No tasks assigned to this club.</p>}</section>}
    {assignment.canReportContribution && <section className="mt-6 rounded-2xl border bg-card p-6"><h2 className="font-semibold">Contribution history</h2><p className="mt-1 text-sm text-muted-foreground">Private operational notes for this club assignment.</p>{assignment.activities.length ? <ul className="mt-4 divide-y">{assignment.activities.map((item) => <li key={item.id} className="py-3 text-sm"><span className="text-muted-foreground">{item.occurredAt.toLocaleDateString("en-IN")}{item.actor.name ? ` · ${item.actor.name}` : ""}</span><p className="mt-1 whitespace-pre-wrap">{item.description}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No contributions recorded.</p>}{assignment.project.operationalStatus === "ACTIVE" && <ProjectContributionForm assignmentId={assignmentId} />}</section>}
  </main>;
}
