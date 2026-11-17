import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAdminUser } from "@/server/auth-guard";

export const metadata: Metadata = { title: "Assigned club projects" };
export default async function ClubProjectsPage() {
  const actor = await getAdminUser();
  if (!actor) redirect("/admin/login?callbackUrl=/club/projects");
  const assignments = await db.projectClubAssignment.findMany({ where: { coordinatorId: actor.id, status: "ACTIVE", club: { status: "ACTIVE", memberships: { some: { userId: actor.id, status: "ACTIVE" } } }, project: { operationalStatus: { in: ["PLANNED", "ACTIVE"] } }, OR: [{ canViewTasks: true }, { canReportContribution: true }] }, select: { id: true, responsibilities: true, club: { select: { nameEn: true } }, project: { select: { titleEn: true, titleTa: true, operationalStatus: true } } }, orderBy: { assignedAt: "desc" }, take: 100 });
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6"><Link href="/club" className="text-sm text-brand underline">← Club portal</Link><h1 className="mt-5 text-3xl font-semibold">Assigned projects</h1><p className="mt-2 text-sm text-muted-foreground">Projects where you are the appointed coordinator for an active club assignment.</p>{assignments.length ? <ul className="mt-6 grid gap-4 md:grid-cols-2">{assignments.map((assignment) => <li key={assignment.id} className="rounded-2xl border bg-card p-5"><Link href={`/club/projects/${assignment.id}`} className="font-medium text-brand underline">{assignment.project.titleEn}</Link>{assignment.project.titleTa && <p lang="ta" className="mt-1 text-sm text-muted-foreground">{assignment.project.titleTa}</p>}<p className="mt-2 text-xs text-muted-foreground">{assignment.club.nameEn} · {assignment.project.operationalStatus}</p><p className="mt-3 text-sm text-muted-foreground">{assignment.responsibilities}</p></li>)}</ul> : <p className="mt-6 rounded-2xl border border-dashed p-8 text-sm text-muted-foreground">No active project assignments.</p>}</main>;
}
