import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { CLUB_CONSENT_VERSION, type ClubProfileInput } from "@/lib/validations/club";

export class ClubError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ClubError";
  }
}

function nullable(value: string): string | null {
  return value || null;
}

function profile(input: ClubProfileInput) {
  return {
    nameEn: input.nameEn,
    nameTa: nullable(input.nameTa),
    summaryEn: nullable(input.summaryEn),
    summaryTa: nullable(input.summaryTa),
    descriptionEn: nullable(input.descriptionEn),
    descriptionTa: nullable(input.descriptionTa),
  };
}

const audit = (actorId: string, eventType: string, subjectId: string, details: Prisma.InputJsonValue = {}) => ({
  actorId,
  eventType,
  subjectType: "Club",
  subjectId,
  correlationId: randomUUID(),
  details,
});

const consentRecord = () => ({ consentAt: new Date(), adultAttestedAt: new Date(), consentVersion: CLUB_CONSENT_VERSION });

/** Random opaque code avoids implying a registered or sequential trust identifier. */
function newCode() {
  return `CLB-${randomBytes(6).toString("hex").toUpperCase()}`;
}

export async function createClub(input: ClubProfileInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const club = await tx.club.create({ data: { ...profile(input), code: newCode(), createdById: actorId } });
    await tx.auditEvent.create({ data: audit(actorId, "CLUB_DRAFT_CREATED", club.id, { code: club.code }) });
    return club;
  });
}

export async function updateClub(id: string, expectedVersion: number, input: ClubProfileInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const updated = await tx.club.updateMany({
      where: { id, version: expectedVersion, status: { not: "ARCHIVED" } },
      data: { ...profile(input), version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ClubError("CLUB_CONFLICT", "This club changed or was archived. Reload it before saving.");
    await tx.auditEvent.create({ data: audit(actorId, "CLUB_PROFILE_UPDATED", id, { version: expectedVersion + 1 }) });
  });
}

const transitions = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
} as const;

export async function changeClubStatus(id: string, expectedVersion: number, target: "ACTIVE" | "SUSPENDED" | "ARCHIVED", actorId: string) {
  return db.$transaction(async (tx) => {
    const current = await tx.club.findUnique({ where: { id }, select: { status: true, version: true, coordinatorId: true } });
    if (!current || current.version !== expectedVersion) throw new ClubError("CLUB_CONFLICT", "This club changed. Reload it before continuing.");
    if (!(transitions[current.status] as readonly string[]).includes(target)) throw new ClubError("INVALID_CLUB_TRANSITION", "That club status change is not allowed.");
    const updated = await tx.club.updateMany({ where: { id, version: expectedVersion, status: current.status }, data: { status: target, version: { increment: 1 } } });
    if (updated.count !== 1) throw new ClubError("CLUB_CONFLICT", "This club changed. Reload it before continuing.");
    await tx.auditEvent.create({ data: audit(actorId, `CLUB_${target}`, id, { from: current.status, to: target, version: expectedVersion + 1 }) });
    return target;
  }, { isolationLevel: "Serializable" });
}

export async function createClubDocumentFromUpload(input: {
  clubId: string; titleEn: string; titleTa: string; filename: string; mimeType: string; size: number; url: string; storageKey: string;
}, actorId: string) {
  if (!input.storageKey.startsWith("private/club-documents/")) throw new ClubError("PRIVATE_DOCUMENT_REQUIRED", "Choose a dedicated private club file.");
  return db.$transaction(async (tx) => {
    const club = await tx.club.findUnique({ where: { id: input.clubId }, select: { status: true } });
    if (!club || !["DRAFT", "ACTIVE"].includes(club.status)) throw new ClubError("CLUB_UNAVAILABLE", "This club is unavailable for new documents.");
    const media = await tx.media.create({ data: { url: input.url, storageKey: input.storageKey, filename: input.filename, mimeType: input.mimeType, size: input.size, visibility: "PRIVATE", uploadedById: actorId } });
    const document = await tx.clubDocument.create({ data: { clubId: input.clubId, mediaId: media.id, titleEn: input.titleEn, titleTa: nullable(input.titleTa), createdById: actorId } });
    await tx.auditEvent.create({ data: audit(actorId, "CLUB_DOCUMENT_UPLOADED", input.clubId, { documentId: document.id, mediaId: media.id }) });
    return document;
  });
}

export async function archiveClubDocument(documentId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const document = await tx.clubDocument.findUnique({ where: { id: documentId }, select: { clubId: true, archivedAt: true } });
    if (!document || document.archivedAt) throw new ClubError("DOCUMENT_UNAVAILABLE", "This document is already archived or unavailable.");
    const updated = await tx.clubDocument.updateMany({ where: { id: documentId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (updated.count !== 1) throw new ClubError("DOCUMENT_CONFLICT", "This document changed. Reload it before continuing.");
    await tx.auditEvent.create({ data: audit(actorId, "CLUB_DOCUMENT_ARCHIVED", document.clubId, { documentId }) });
  });
}

/** Admin invitation does not itself grant membership or coordinator access. */
export async function inviteClubMember(clubId: string, userId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const [club, user, current] = await Promise.all([
      tx.club.findUnique({ where: { id: clubId }, select: { status: true } }),
      tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
      tx.clubMembership.findUnique({ where: { clubId_userId: { clubId, userId } } }),
    ]);
    if (!club || club.status !== "ACTIVE") throw new ClubError("CLUB_NOT_ACTIVE", "Membership is available only for active clubs.");
    if (!user) throw new ClubError("USER_NOT_FOUND", "Choose an existing account.");
    if (current && !["REJECTED", "ENDED"].includes(current.status)) throw new ClubError("MEMBERSHIP_EXISTS", "This account already has a current membership request or invitation.");
    const membership = current
      ? await tx.clubMembership.update({ where: { id: current.id }, data: { status: "INVITED", role: "MEMBER", version: { increment: 1 }, consentAt: null, consentVersion: null, adultAttestedAt: null, joinedAt: null, endedAt: null } })
      : await tx.clubMembership.create({ data: { clubId, userId, status: "INVITED" } });
    await tx.clubMembershipHistory.create({ data: { membershipId: membership.id, actorId, fromStatus: current?.status ?? null, toStatus: "INVITED", fromRole: current?.role ?? null, toRole: "MEMBER" } });
    await tx.auditEvent.create({ data: audit(actorId, "CLUB_MEMBERSHIP_INVITED", clubId, { membershipId: membership.id, userId }) });
    await tx.notificationOutbox.create({ data: { dedupeKey: `club-invite:${membership.id}:v${membership.version}`, recipientId: userId, templateKey: "CLUB_INVITATION", payload: { clubId, membershipId: membership.id } } });
    return membership;
  }, { isolationLevel: "Serializable" });
}

/** Self request and invitation acceptance require explicit adult/consent attestations. */
export async function requestClubMembership(clubId: string, userId: string, actorId: string, acceptedConsent: boolean, adultAttested: boolean) {
  if (actorId !== userId) throw new ClubError("MEMBERSHIP_SCOPE_DENIED", "You can request membership only for yourself.");
  if (!acceptedConsent || !adultAttested) throw new ClubError("CONSENT_REQUIRED", "Confirm that you are an adult and agree to the membership data use.");
  return db.$transaction(async (tx) => {
    const club = await tx.club.findUnique({ where: { id: clubId }, select: { status: true } });
    if (!club || club.status !== "ACTIVE") throw new ClubError("CLUB_NOT_ACTIVE", "Membership is available only for active clubs.");
    const current = await tx.clubMembership.findUnique({ where: { clubId_userId: { clubId, userId } } });
    if (current && !["INVITED", "REJECTED", "ENDED"].includes(current.status)) throw new ClubError("MEMBERSHIP_EXISTS", "You already have a current request or membership.");
    const membership = current
      ? await tx.clubMembership.update({ where: { id: current.id }, data: { status: "REQUESTED", role: "MEMBER", version: { increment: 1 }, ...consentRecord(), joinedAt: null, endedAt: null } })
      : await tx.clubMembership.create({ data: { clubId, userId, status: "REQUESTED", ...consentRecord() } });
    await tx.clubMembershipHistory.create({ data: { membershipId: membership.id, actorId, fromStatus: current?.status ?? null, toStatus: "REQUESTED", fromRole: current?.role ?? null, toRole: "MEMBER" } });
    await tx.auditEvent.create({ data: audit(actorId, "CLUB_MEMBERSHIP_REQUESTED", clubId, { membershipId: membership.id, consentVersion: CLUB_CONSENT_VERSION }) });
    return membership;
  }, { isolationLevel: "Serializable" });
}

export async function reviewClubMembership(membershipId: string, expectedVersion: number, actorId: string, decision: "APPROVE" | "REJECT", reason?: string) {
  if (decision === "REJECT" && !reason?.trim()) throw new ClubError("REASON_REQUIRED", "Give a reason for rejection.");
  return db.$transaction(async (tx) => {
    const current = await tx.clubMembership.findUnique({ where: { id: membershipId }, include: { club: { select: { status: true } } } });
    if (!current || current.status !== "REQUESTED" || current.version !== expectedVersion) throw new ClubError("MEMBERSHIP_CONFLICT", "This request changed. Reload it before deciding.");
    if (current.club.status !== "ACTIVE") throw new ClubError("CLUB_NOT_ACTIVE", "Membership approval requires an active club.");
    if (actorId === current.userId) throw new ClubError("SELF_APPROVAL", "You cannot approve your own membership.");
    if (decision === "APPROVE" && (!current.consentAt || !current.adultAttestedAt || current.consentVersion !== CLUB_CONSENT_VERSION)) {
      throw new ClubError("CONSENT_REQUIRED", "Current adult and membership consent are required.");
    }
    const target = decision === "APPROVE" ? "ACTIVE" : "REJECTED";
    const updated = await tx.clubMembership.updateMany({ where: { id: membershipId, version: expectedVersion, status: "REQUESTED" }, data: { status: target, version: { increment: 1 }, ...(target === "ACTIVE" ? { joinedAt: new Date() } : {}) } });
    if (updated.count !== 1) throw new ClubError("MEMBERSHIP_CONFLICT", "This request changed. Reload it before deciding.");
    await tx.clubMembershipHistory.create({ data: { membershipId, actorId, fromStatus: "REQUESTED", toStatus: target, fromRole: current.role, toRole: current.role, reason: reason?.trim() || null } });
    await tx.auditEvent.create({ data: audit(actorId, `CLUB_MEMBERSHIP_${target}`, current.clubId, { membershipId, userId: current.userId, version: expectedVersion + 1 }) });
    await tx.notificationOutbox.create({ data: { dedupeKey: `club-membership:${membershipId}:v${expectedVersion + 1}`, recipientId: current.userId, templateKey: `CLUB_MEMBERSHIP_${target}`, payload: { clubId: current.clubId, membershipId } } });
    return target;
  }, { isolationLevel: "Serializable" });
}

export async function appointClubCoordinator(clubId: string, userId: string, expectedClubVersion: number, actorId: string) {
  return db.$transaction(async (tx) => {
    const club = await tx.club.findUnique({ where: { id: clubId }, select: { status: true, version: true, coordinatorId: true } });
    if (!club || club.version !== expectedClubVersion) throw new ClubError("CLUB_CONFLICT", "This club changed. Reload it before appointing a coordinator.");
    if (club.status !== "ACTIVE") throw new ClubError("CLUB_NOT_ACTIVE", "Only an active club can have a coordinator.");
    const member = await tx.clubMembership.findUnique({ where: { clubId_userId: { clubId, userId } } });
    if (!member || member.status !== "ACTIVE") throw new ClubError("APPROVED_MEMBERSHIP_REQUIRED", "Approve the account's membership before appointing a coordinator.");
    if (club.coordinatorId === userId) return;
    if (club.coordinatorId) {
      const previous = await tx.clubMembership.findUnique({ where: { clubId_userId: { clubId, userId: club.coordinatorId } } });
      if (previous) {
        await tx.clubMembership.update({ where: { id: previous.id }, data: { role: "MEMBER", version: { increment: 1 } } });
        await tx.clubMembershipHistory.create({ data: { membershipId: previous.id, actorId, fromStatus: previous.status, toStatus: previous.status, fromRole: previous.role, toRole: "MEMBER", reason: "Coordinator replaced" } });
      }
    }
    await tx.clubMembership.update({ where: { id: member.id }, data: { role: "COORDINATOR", version: { increment: 1 } } });
    await tx.clubMembershipHistory.create({ data: { membershipId: member.id, actorId, fromStatus: "ACTIVE", toStatus: "ACTIVE", fromRole: member.role, toRole: "COORDINATOR" } });
    const updated = await tx.club.updateMany({ where: { id: clubId, version: expectedClubVersion, status: "ACTIVE" }, data: { coordinatorId: userId, version: { increment: 1 } } });
    if (updated.count !== 1) throw new ClubError("CLUB_CONFLICT", "This club changed. Reload it before appointing a coordinator.");
    await tx.auditEvent.create({ data: audit(actorId, "CLUB_COORDINATOR_APPOINTED", clubId, { userId, previousUserId: club.coordinatorId }) });
  }, { isolationLevel: "Serializable" });
}

export async function closeClubMembership(membershipId: string, expectedVersion: number, actorId: string, target: "SUSPENDED" | "ENDED", reason: string) {
  if (!reason.trim()) throw new ClubError("REASON_REQUIRED", "Give a reason for this membership change.");
  return db.$transaction(async (tx) => {
    const current = await tx.clubMembership.findUnique({ where: { id: membershipId }, include: { club: { select: { coordinatorId: true } } } });
    if (!current || current.version !== expectedVersion || current.status !== "ACTIVE") throw new ClubError("MEMBERSHIP_CONFLICT", "This membership changed. Reload it before continuing.");
    const updated = await tx.clubMembership.updateMany({ where: { id: membershipId, version: expectedVersion, status: "ACTIVE" }, data: { status: target, version: { increment: 1 }, ...(target === "ENDED" ? { endedAt: new Date() } : {}) } });
    if (updated.count !== 1) throw new ClubError("MEMBERSHIP_CONFLICT", "This membership changed. Reload it before continuing.");
    if (current.club.coordinatorId === current.userId) await tx.club.update({ where: { id: current.clubId }, data: { coordinatorId: null, version: { increment: 1 } } });
    await tx.clubMembershipHistory.create({ data: { membershipId, actorId, fromStatus: "ACTIVE", toStatus: target, fromRole: current.role, toRole: current.role, reason: reason.trim() } });
    await tx.auditEvent.create({ data: audit(actorId, `CLUB_MEMBERSHIP_${target}`, current.clubId, { membershipId, userId: current.userId }) });
  }, { isolationLevel: "Serializable" });
}

/** Used by future club portal queries and mutations, never by public queries. */
export async function requireClubCoordinator(userId: string, clubId: string) {
  const membership = await db.clubMembership.findUnique({
    where: { clubId_userId: { clubId, userId } },
    select: { id: true, role: true, status: true, club: { select: { status: true, coordinatorId: true } } },
  });
  if (!membership || membership.status !== "ACTIVE" || membership.role !== "COORDINATOR" || membership.club.status !== "ACTIVE" || membership.club.coordinatorId !== userId) {
    throw new ClubError("CLUB_SCOPE_DENIED", "You do not have access to this club.");
  }
  return membership;
}
