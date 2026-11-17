import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { DonationEvidenceUpload, DonorLinkForm, ManualDonationIntakeForm } from "@/components/admin/donation-intake";
import { formatPaise } from "@/lib/validations/fundraising";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/server/auth-guard";

export const metadata: Metadata = { title: "Donations · Trustfolio Admin" };

export default async function DonationsPage() {
  await requireAdminPage("ADMIN");
  const [donors, projects, donations] = await Promise.all([
    db.donorProfile.findMany({ where: { user: { role: "PORTAL_USER" } }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" } }),
    db.project.findMany({ where: { status: "PUBLISHED", isDemo: false }, select: { id: true, titleEn: true }, orderBy: { titleEn: "asc" } }),
    db.donation.findMany({ orderBy: { receivedAt: "desc" }, take: 100, include: { donorProfile: { include: { user: { select: { name: true, email: true } } } }, project: { select: { titleEn: true } }, evidence: { where: { archivedAt: null }, include: { media: { select: { filename: true } } } } } }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return <div className="space-y-6">
    <PageHeader title="Donation intake" description="Private donor profiles and unverified offline intake records." />
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm"><strong>Phase 6 gate:</strong> entries remain pending. No online checkout, verification, receipt, fund allocation, confirmed total, or financial posting is enabled.</div>
    <div className="grid gap-5 xl:grid-cols-2">
      <DonorLinkForm />
      <ManualDonationIntakeForm donors={donors.map((d) => ({ id: d.id, label: `${d.user.name ?? d.user.email} · ${d.user.email}` }))} projects={projects.map((p) => ({ id: p.id, label: p.titleEn }))} today={today} idempotencyKey={randomUUID()} />
    </div>
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="border-b p-5"><h2 className="font-semibold">Pending intake records</h2><p className="mt-1 text-sm text-muted-foreground">Unverified records do not appear in public totals or fund balances.</p></div>
      {donations.length ? <div className="divide-y">{donations.map((d) => <article key={d.id} className="grid gap-3 p-5 lg:grid-cols-[1fr_1fr]"><div><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{d.donorProfile.user.name ?? d.donorProfile.user.email}</h3><p className="mt-1 text-sm text-muted-foreground">{d.project.titleEn} · {d.method.replaceAll("_", " ")} · {d.receivedAt.toISOString().slice(0, 10)}</p></div><div className="text-right"><p className="font-semibold tabular-nums">{formatPaise(d.amountPaise)}</p><p className="text-xs text-warning">Pending verification</p></div></div>{d.reference && <p className="mt-2 text-xs text-muted-foreground">Reference: {d.reference}</p>}</div><div>{d.evidence.length ? <ul className="mb-2 space-y-1 text-xs">{d.evidence.map((item) => <li key={item.id}><Link className="text-brand underline" href={`/api/admin/donations/evidence/${item.id}/file`} target="_blank">{item.title} · {item.media.filename}</Link></li>)}</ul> : <p className="text-xs text-muted-foreground">No supporting file attached yet.</p>}<DonationEvidenceUpload donationId={d.id} /></div></article>)}</div> : <p className="p-8 text-sm text-muted-foreground">No offline intake records.</p>}
    </section>
  </div>;
}
