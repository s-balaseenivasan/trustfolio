import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { VOLUNTEER_CONSENT_VERSION } from "@/lib/validations/volunteer";
import { getAdminUser } from "@/server/auth-guard";

export const metadata: Metadata = { title: "My tasks" };
export default async function VolunteerTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getAdminUser();
  if (!actor) redirect("/admin/login?callbackUrl=/volunteer/tasks");
  const query = await searchParams;
  const value = Number(query.page);
  const page = Number.isSafeInteger(value) && value > 0 ? Math.min(value, 10000) : 1;
  const where = { active: true, profile: { userId: actor.id, consentVersion: VOLUNTEER_CONSENT_VERSION }, task: { project: { operationalStatus: "ACTIVE" as const }, clubAssignment: { status: "ACTIVE" as const, club: { status: "ACTIVE" as const, memberships: { some: { userId: actor.id, status: "ACTIVE" as const } } } } } };
  const [items, total] = await Promise.all([
    db.taskAssignment.findMany({ where, include: { task: { include: { project: { select: { titleEn: true } }, clubAssignment: { include: { club: { select: { nameEn: true } } } } } } }, orderBy: { assignedAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    db.taskAssignment.count({ where }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6"><Link href="/volunteer" className="text-sm text-brand underline">← Volunteer portal</Link><h1 className="mt-5 text-2xl font-semibold">My assigned project tasks</h1><p className="mt-1 text-sm text-muted-foreground">Only tasks assigned to you through an active club and project are shown.</p><p className="mt-4 text-xs text-muted-foreground">{total} tasks · page {page}</p>{items.length ? <ul className="mt-4 space-y-3">{items.map((item) => <li key={item.id} className="rounded-xl border bg-card p-4 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><Link href={`/volunteer/tasks/${item.taskId}`} className="font-semibold text-brand underline">{item.task.titleEn}</Link><p className="mt-1 text-muted-foreground">{item.task.project.titleEn} · {item.task.clubAssignment.club.nameEn}</p></div><span>{item.task.status} · {item.task.progressPercent}%{item.task.dueDate && item.task.dueDate.toISOString().slice(0, 10) < today && !["APPROVED", "CANCELLED"].includes(item.task.status) ? " · OVERDUE" : ""}</span></div></li>)}</ul> : <p className="mt-5 rounded-xl border border-dashed p-8 text-sm text-muted-foreground">No active project tasks are assigned to you.</p>}<div className="mt-5 flex justify-between text-sm">{page > 1 ? <Link href={`/volunteer/tasks?page=${page - 1}`} className="text-brand underline">Previous</Link> : <span />}{page * 30 < total && <Link href={`/volunteer/tasks?page=${page + 1}`} className="text-brand underline">Next</Link>}</div></main>;
}
