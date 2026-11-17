import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestDraftForm } from "@/components/admin/fundraising-drafts";
import { PageHeader } from "@/components/admin/page-header";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/validations/fundraising";
import { requireAdminPage } from "@/server/auth-guard";

export const metadata: Metadata = { title: "Project fundraising drafts" };
export default async function ProjectFundraisingPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("ADMIN"); const { projectId } = await params; if (projectId.length > 64) notFound();
  const query = await searchParams; const pageValue = Number(query.page); const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 10000) : 1;
  const [project, requests, total] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { id: true, titleEn: true, titleTa: true, slug: true, isDemo: true, status: true, operationalStatus: true } }),
    db.donationRequest.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 20, take: 20, select: { id: true, purposeEn: true, purposeTa: true, targetPaise: true, status: true, version: true, neededBy: true, campaign: { select: { id: true, publicationStatus: true } } } }),
    db.donationRequest.count({ where: { projectId } }),
  ]);
  if (!project || project.isDemo) notFound();
  const open = !["COMPLETED", "CANCELLED"].includes(project.operationalStatus);
  return <div className="space-y-6"><Link href="/admin/fundraising" className="text-sm text-brand underline">← Fundraising drafts</Link><PageHeader title={project.titleEn} description={`Existing project /${project.slug} · operations ${project.operationalStatus} · public content ${project.status}`} />{project.titleTa && <p lang="ta" className="text-muted-foreground">{project.titleTa}</p>}{open ? <RequestDraftForm projectId={project.id} /> : <p className="rounded-xl border p-5 text-sm text-muted-foreground">This project is operationally closed. Existing drafts remain available for review.</p>}<section className="rounded-2xl border bg-card p-5"><h2 className="font-semibold">Donation requests</h2><p className="mt-1 text-sm text-muted-foreground">Private draft records only; no confirmed collections or public progress.</p>{requests.length ? <ul className="mt-4 divide-y">{requests.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><Link href={`/admin/fundraising/requests/${request.id}`} className="font-medium text-brand underline">{request.purposeEn}</Link>{request.purposeTa && <p lang="ta" className="text-muted-foreground">{request.purposeTa}</p>}</div><span className="text-muted-foreground">{formatPaise(request.targetPaise)} · {request.status} · {request.campaign ? "campaign proposal saved" : "no campaign proposal"}</span></li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">No donation requests yet.</p>}</section><div className="flex justify-between text-sm">{page > 1 ? <Link href={`?page=${page - 1}`} className="text-brand underline">Previous</Link> : <span />}{page * 20 < total && <Link href={`?page=${page + 1}`} className="text-brand underline">Next</Link>}</div></div>;
}
