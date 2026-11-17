import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClubAdminEditor } from "@/components/admin/club-management";
import { PageHeader } from "@/components/admin/page-header";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/server/auth-guard";

export const metadata: Metadata = { title: "Club management" };

export default async function ClubDetailPage({ params }: PageProps<"/admin/clubs/[id]">) {
  await requireAdminPage("ADMIN");
  const { id } = await params;
  if (id.length > 64) notFound();
  const [club, users, history] = await Promise.all([
    db.club.findUnique({ where: { id }, include: { memberships: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true, email: true } }, history: { orderBy: { createdAt: "desc" }, include: { actor: { select: { name: true, email: true } } } } } }, documents: { orderBy: { createdAt: "desc" }, include: { media: { select: { filename: true } } } } } }),
    db.user.findMany({ orderBy: { email: "asc" }, select: { id: true, email: true, name: true } }),
    db.auditEvent.findMany({ where: { subjectType: "Club", subjectId: id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, eventType: true, createdAt: true, actor: { select: { name: true, email: true } } } }),
  ]);
  if (!club) notFound();
  return <>
    <PageHeader title={club.nameEn} description="Club operations and private membership records." backHref="/admin/clubs" backLabel="All clubs" />
    <ClubAdminEditor
      club={{ id: club.id, code: club.code, nameEn: club.nameEn, nameTa: club.nameTa, summaryEn: club.summaryEn, summaryTa: club.summaryTa, descriptionEn: club.descriptionEn, descriptionTa: club.descriptionTa, status: club.status, publicationStatus: club.publicationStatus, version: club.version, coordinatorId: club.coordinatorId }}
      members={club.memberships.map((member) => ({ id: member.id, userId: member.userId, userName: member.user.name, userEmail: member.user.email, role: member.role, status: member.status, version: member.version, consentAt: member.consentAt?.toISOString() ?? null, adultAttestedAt: member.adultAttestedAt?.toISOString() ?? null, history: member.history.map((event) => ({ id: event.id, toStatus: event.toStatus, toRole: event.toRole, reason: event.reason, createdAt: event.createdAt.toISOString(), actor: event.actor.name ?? event.actor.email })) }))}
      files={club.documents.map((file) => ({ id: file.id, titleEn: file.titleEn, titleTa: file.titleTa, mediaId: file.mediaId, filename: file.media.filename, createdAt: file.createdAt.toISOString(), archivedAt: file.archivedAt?.toISOString() ?? null }))}
      users={users}
    />
    <section className="mt-6 rounded-2xl border bg-card p-6 shadow-soft" aria-labelledby="club-history"><h2 id="club-history" className="font-semibold">Activity history</h2>{history.length ? <ol className="mt-4 space-y-2 text-sm">{history.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 border-t pt-2"><span>{event.eventType.replaceAll("_", " ")} · {event.actor?.name ?? event.actor?.email ?? "System"}</span><time className="text-muted-foreground" dateTime={event.createdAt.toISOString()}>{event.createdAt.toLocaleString("en-IN")}</time></li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">No activity recorded yet.</p>}</section>
  </>;
}
