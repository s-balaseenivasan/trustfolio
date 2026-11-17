import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TaskProgress } from "@/components/volunteer/task-progress";
import { db } from "@/lib/db";
import { getAdminUser } from "@/server/auth-guard";
import { ProjectOperationError, requireVolunteerTask } from "@/server/projects/service";

export const metadata: Metadata = { title: "Assigned task" };
export default async function VolunteerTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getAdminUser();
  if (!actor) redirect("/admin/login?callbackUrl=/volunteer/tasks");
  const { id } = await params;
  if (id.length > 64) notFound();
  try { await requireVolunteerTask(actor.id, id); } catch (error) { if (error instanceof ProjectOperationError) notFound(); throw error; }
  const task = await db.projectTask.findUnique({ where: { id }, include: { project: { select: { titleEn: true } }, clubAssignment: { include: { club: { select: { nameEn: true } } } }, dependencies: { include: { predecessor: { select: { titleEn: true, status: true } } } }, history: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true, email: true } } } }, evidence: { where: { archivedAt: null }, select: { id: true, title: true, kind: true } } } });
  if (!task) notFound();
  const today = new Date().toISOString().slice(0, 10);
  return <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6"><Link href="/volunteer/tasks" className="text-sm text-brand underline">← My tasks</Link><header className="mt-5 border-b pb-5"><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{task.project.titleEn} · {task.clubAssignment.club.nameEn}</p><h1 className="mt-1 text-2xl font-semibold">{task.titleEn}</h1>{task.titleTa && <p lang="ta" className="mt-1 text-muted-foreground">{task.titleTa}</p>}<p className="mt-2 text-sm text-muted-foreground">{task.status} · {task.priority} · {task.progressPercent}%{task.dueDate ? ` · due ${task.dueDate.toISOString().slice(0, 10)}` : ""}{task.dueDate && task.dueDate.toISOString().slice(0, 10) < today && !["APPROVED", "CANCELLED"].includes(task.status) ? " · OVERDUE" : ""}</p></header>{task.description && <section className="my-5 rounded-2xl border bg-card p-5 text-sm"><h2 className="font-semibold">Instructions</h2><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{task.description}</p></section>}{task.dependencies.length > 0 && <section className="my-5 rounded-2xl border bg-card p-5 text-sm"><h2 className="font-semibold">Predecessors</h2><ul className="mt-2 space-y-1">{task.dependencies.map((edge) => <li key={edge.predecessorId}>{edge.predecessor.titleEn} · {edge.predecessor.status}</li>)}</ul></section>}<TaskProgress taskId={task.id} version={task.version} status={task.status} progressPercent={task.progressPercent} dependenciesOpen={task.dependencies.some((edge) => edge.predecessor.status !== "APPROVED")} /><section className="mt-5 rounded-2xl border bg-card p-5 text-sm"><h2 className="font-semibold">Activity and evidence</h2><ul className="mt-3 space-y-2">{task.history.map((event) => <li key={event.id} className="border-b pb-2"><strong>{event.toStatus}</strong> · {event.actor.name ?? event.actor.email} · {event.createdAt.toLocaleString("en-IN")}{event.note && <p className="text-muted-foreground">{event.note}</p>}</li>)}</ul>{task.evidence.length > 0 && <ul className="mt-4 space-y-1">{task.evidence.map((row) => <li key={row.id}><Link href={`/api/task-evidence/${row.id}/file`} target="_blank" className="text-brand underline">{row.title}</Link> <span className="text-muted-foreground">({row.kind.toLowerCase()})</span></li>)}</ul>}</section></main>;
}
