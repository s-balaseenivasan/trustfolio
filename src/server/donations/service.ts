import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { DONATION_EVIDENCE_STORAGE_PREFIX } from "@/lib/storage";
import { rupeesToPaise } from "@/lib/validations/fundraising";
import type { DonorProfileInput, ManualDonationIntakeInput } from "@/lib/validations/donations";

export class DonationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "DonationError"; }
}

const audit = (actorId: string, eventType: string, subjectType: string, subjectId: string, details: Prisma.InputJsonValue = {}) => ({
  actorId, eventType, subjectType, subjectId, correlationId: randomUUID(), details,
});

export async function createDonorProfile(input: DonorProfileInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email: input.email }, select: { id: true, role: true } });
    if (!user || user.role !== "PORTAL_USER") throw new DonationError("EXISTING_PORTAL_ACCOUNT_REQUIRED", "Link a donor to an existing portal account.");
    const profile = await tx.donorProfile.create({ data: {
      userId: user.id, createdById: actorId, type: input.type,
      organizationName: input.type === "ORGANIZATION" ? input.organizationName : null,
    } });
    await tx.auditEvent.create({ data: audit(actorId, "DONOR_PROFILE_LINKED", "DonorProfile", profile.id, { userId: user.id, type: profile.type }) });
    return profile;
  }, { isolationLevel: "Serializable" });
}

/** Records an offline receipt for independent review. This function cannot verify or post funds. */
export async function createPendingManualDonation(input: ManualDonationIntakeInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const amountPaise = rupeesToPaise(input.amountRupees);
    const campaignId = input.campaignId || null;
    const fingerprint = createHash("sha256").update(JSON.stringify([input.donorProfileId, input.projectId, campaignId, amountPaise.toString(), input.method, input.receivedAt, input.reference, input.privateNote])).digest("hex");
    const previous = await tx.donation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (previous) {
      if (previous.requestFingerprint !== fingerprint) throw new DonationError("IDEMPOTENCY_CONFLICT", "This submission key was already used for different donation details.");
      return previous;
    }
    const [profile, project] = await Promise.all([
      tx.donorProfile.findUnique({ where: { id: input.donorProfileId }, select: { id: true, user: { select: { role: true } } } }),
      tx.project.findUnique({ where: { id: input.projectId }, select: { id: true, status: true, isDemo: true } }),
    ]);
    if (!profile || profile.user.role !== "PORTAL_USER") throw new DonationError("DONOR_UNAVAILABLE", "Choose an existing portal donor profile.");
    if (!project || project.status !== "PUBLISHED" || project.isDemo) throw new DonationError("PROJECT_UNAVAILABLE", "Choose a published, non-demo project.");
    if (campaignId) {
      const campaign = await tx.donationCampaign.findUnique({ where: { id: campaignId }, select: { request: { select: { projectId: true } } } });
      if (!campaign || campaign.request.projectId !== project.id) throw new DonationError("CAMPAIGN_PROJECT_MISMATCH", "Choose a campaign belonging to this project.");
    }
    const row = await tx.donation.create({ data: {
      idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
      donorProfileId: profile.id, projectId: project.id, campaignId, createdById: actorId,
      amountPaise, currency: "INR", method: input.method, receivedAt: new Date(`${input.receivedAt}T00:00:00.000Z`),
      reference: input.reference || null, privateNote: input.privateNote || null, status: "PENDING_VERIFICATION",
    } });
    await tx.donationHistory.create({ data: {
      donationId: row.id, actorId, toStatus: "PENDING_VERIFICATION",
      snapshot: { amountPaise: amountPaise.toString(), currency: "INR", method: input.method, receivedAt: input.receivedAt, projectId: project.id, campaignId },
    } });
    await tx.auditEvent.create({ data: audit(actorId, "MANUAL_DONATION_INTAKE_CREATED", "Donation", row.id, { status: row.status, method: row.method, currency: row.currency, amountPaise: amountPaise.toString() }) });
    return row;
  }, { isolationLevel: "Serializable" });
}

export async function createDonationEvidenceFromUpload(input: { donationId: string; title: string; filename: string; mimeType: string; size: number; url: string; storageKey: string }, actorId: string) {
  if (!input.storageKey.startsWith(DONATION_EVIDENCE_STORAGE_PREFIX)) throw new DonationError("PRIVATE_FILE_REQUIRED", "Use the private donation evidence upload.");
  return db.$transaction(async (tx) => {
    const donation = await tx.donation.findUnique({ where: { id: input.donationId }, select: { status: true } });
    if (!donation || donation.status !== "PENDING_VERIFICATION") throw new DonationError("DONATION_UNAVAILABLE", "This intake record is unavailable.");
    const media = await tx.media.create({ data: { url: input.url, storageKey: input.storageKey, filename: input.filename, mimeType: input.mimeType, size: input.size, visibility: "PRIVATE", uploadedById: actorId } });
    const evidence = await tx.donationEvidence.create({ data: { donationId: input.donationId, mediaId: media.id, title: input.title, createdById: actorId } });
    await tx.auditEvent.create({ data: audit(actorId, "DONATION_INTAKE_EVIDENCE_ADDED", "Donation", input.donationId, { evidenceId: evidence.id }) });
    return evidence;
  });
}
