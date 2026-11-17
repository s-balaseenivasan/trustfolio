import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/server/auth-guard";

export const metadata: Metadata = { title: "Fundraising drafts" };
export default async function FundraisingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("ADMIN");
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const pageValue = Number(query.page);
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 10000) : 1;
  const where = { isDemo: false, ...(q ? { OR: [{ titleEn: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {}) };
  const [projects, total] = await Promise.all([
    db.project.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * 30, take: 30, select: { id: true, titleEn: true, titleTa: true, slug: true, operationalStatus: true, status: true, _count: { select: { donationRequests: true } } } }),
    db.project.count({ where }),
  ]);
  const href = (next: number) => `/admin/fundraising?${new URLSearchParams({ ...(q ? { q } : {}), page: String(next) })}`;
  return <div className="space-y-5"><PageHeader title="Fundraising drafts" description="Plan donation requests against existing projects. Submission, publication and collection are closed." /><form method="get" className="flex gap-2"><input name="q" defaultValue={q} aria-label="Search projects" placeholder="Search project or slug" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" /><button className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">Search</button></form><p className="text-xs text-muted-foreground">{total} non-demo projects · page {page}</p>{projects.length ? <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-sm"><caption className="sr-only">Projects and private donation request counts</caption><thead className="bg-muted/50 text-left"><tr><th scope="col" className="px-4 py-3">Project</th><th scope="col" className="px-4 py-3">Operations</th><th scope="col" className="px-4 py-3">Publication</th><th scope="col" className="px-4 py-3">Requests</th></tr></thead><tbody className="divide-y">{projects.map((project) => <tr key={project.id}><td className="px-4 py-3"><Link href={`/admin/fundraising/${project.id}`} className="font-medium text-brand underline">{project.titleEn}</Link><span className="block text-xs text-muted-foreground">/{project.slug}{project.titleTa ? ` · ${project.titleTa}` : ""}</span></td><td className="px-4 py-3">{project.operationalStatus}</td><td className="px-4 py-3">{project.status}</td><td className="px-4 py-3">{project._count.donationRequests}</td></tr>)}</tbody></table></div> : <p className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">No projects match. Create a non-demo project in the existing content editor first.</p>}<div className="flex justify-between text-sm">{page > 1 ? <Link href={href(page - 1)} className="text-brand underline">Previous</Link> : <span />}{page * 30 < total && <Link href={href(page + 1)} className="text-brand underline">Next</Link>}</div></div>;
}
