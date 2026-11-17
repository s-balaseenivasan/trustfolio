import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/server/auth-guard";

export const metadata: Metadata = { title: "Project operations" };
export default async function ProjectOperationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("ADMIN");
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const pageValue = Number(query.page);
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 10000) : 1;
  const where = q ? { OR: [{ titleEn: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {};
  const [projects, total] = await Promise.all([
    db.project.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * 30, take: 30, select: { id: true, slug: true, titleEn: true, titleTa: true, status: true, operationalStatus: true, _count: { select: { clubAssignments: true, tasks: true, milestones: true } } } }),
    db.project.count({ where }),
  ]);
  const href = (next: number) => `/admin/project-operations?${new URLSearchParams({ ...(q ? { q } : {}), page: String(next) })}`;
  return <div className="space-y-5"><PageHeader title="Project operations" description="Plan work on existing projects. Operational status and tasks are private; public publication remains separate." /><form method="get" className="flex gap-2"><input name="q" defaultValue={q} placeholder="Search project or slug" aria-label="Search projects" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" /><button className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">Search</button></form><p className="text-xs text-muted-foreground">{total} projects · page {page}</p>{projects.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">No projects match. Create a project in the existing content editor first.</p> : <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-sm"><caption className="sr-only">Existing projects and operational state</caption><thead className="bg-muted/50 text-left"><tr><th scope="col" className="px-4 py-3">Project</th><th scope="col" className="px-4 py-3">Operations</th><th scope="col" className="px-4 py-3">Publication</th><th scope="col" className="px-4 py-3">Work</th></tr></thead><tbody className="divide-y">{projects.map((project) => <tr key={project.id}><td className="px-4 py-3"><Link href={`/admin/project-operations/${project.id}`} className="font-medium text-brand underline">{project.titleEn}</Link><span className="block text-xs text-muted-foreground">/{project.slug}{project.titleTa ? ` · ${project.titleTa}` : ""}</span></td><td className="px-4 py-3">{project.operationalStatus}</td><td className="px-4 py-3">{project.status}</td><td className="px-4 py-3">{project._count.clubAssignments} clubs · {project._count.milestones} milestones · {project._count.tasks} tasks</td></tr>)}</tbody></table></div>}<div className="flex justify-between text-sm">{page > 1 ? <Link href={href(page - 1)} className="text-brand underline">Previous</Link> : <span />}{page * 30 < total && <Link href={href(page + 1)} className="text-brand underline">Next</Link>}</div></div>;
}
