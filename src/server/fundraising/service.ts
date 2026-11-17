import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { DONATION_REQUEST_EVIDENCE_STORAGE_PREFIX } from "@/lib/storage";
import { rupeesToPaise, type DonationCampaignDraftInput, type DonationRequestDraftInput } from "@/lib/validations/fundraising";

export class FundraisingError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "FundraisingError"; }
}

const date = (value: string | null) => value ? new Date(`${value}T00:00:00.000Z`) : null;
const nullable = (value: string) => value || null;
const audit = (actorId: string, eventType: string, subjectType: string, subjectId: string, details: Prisma.InputJsonValue = {}) => ({ actorId, eventType, subjectType, subjectId, correlationId: randomUUID(), details });
const requestSnapshot = (input: DonationRequestDraftInput) => ({ purposeEn: input.purposeEn, purposeTa: input.purposeTa, justificationEn: input.justificationEn, justificationTa: input.justificationTa, targetPaise: rupeesToPaise(input.targetRupees).toString(), currency: "INR", neededBy: input.neededBy });
const campaignSnapshot = (input: DonationCampaignDraftInput) => ({ titleEn: input.titleEn, titleTa: input.titleTa, summaryEn: input.summaryEn, summaryTa: input.summaryTa, storyEn: input.storyEn, storyTa: input.storyTa, startsOn: input.startsOn, endsOn: input.endsOn });
const slug = (title: string) => `${title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "campaign"}-${randomUUID().slice(0, 12)}`;

/** Private draft only. Published and demo projects are never inferred to be fundraiseable. */
export async function createDonationRequestDraft(projectId: string, input: DonationRequestDraftInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { operationalStatus: true, isDemo: true } });
    if (!project || project.isDemo || ["COMPLETED", "CANCELLED"].includes(project.operationalStatus)) throw new FundraisingError("PROJECT_UNAVAILABLE", "Choose an existing non-demo project that is still open.");
    const row = await tx.donationRequest.create({ data: { projectId, createdById: actorId, purposeEn: input.purposeEn, purposeTa: nullable(input.purposeTa), justificationEn: input.justificationEn, justificationTa: nullable(input.justificationTa), targetPaise: rupeesToPaise(input.targetRupees), neededBy: date(input.neededBy) } });
    await tx.donationRequestHistory.create({ data: { requestId: row.id, actorId, toStatus: "DRAFT", toVersion: 0, snapshot: requestSnapshot(input) } });
    await tx.auditEvent.create({ data: audit(actorId, "DONATION_REQUEST_DRAFT_CREATED", "DonationRequest", row.id, { projectId, targetPaise: row.targetPaise.toString(), currency: "INR" }) });
    return row;
  }, { isolationLevel: "Serializable" });
}

export async function updateDonationRequestDraft(requestId: string, expectedVersion: number, input: DonationRequestDraftInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const current = await tx.donationRequest.findUnique({ where: { id: requestId }, select: { version: true, status: true, project: { select: { operationalStatus: true, isDemo: true } } } });
    if (!current || current.version !== expectedVersion) throw new FundraisingError("REQUEST_CONFLICT", "This request changed. Reload it before saving.");
    if (current.status !== "DRAFT" || current.project.isDemo || ["COMPLETED", "CANCELLED"].includes(current.project.operationalStatus)) throw new FundraisingError("REQUEST_CLOSED", "This request cannot be edited.");
    const changed = await tx.donationRequest.updateMany({ where: { id: requestId, version: expectedVersion, status: "DRAFT" }, data: { purposeEn: input.purposeEn, purposeTa: nullable(input.purposeTa), justificationEn: input.justificationEn, justificationTa: nullable(input.justificationTa), targetPaise: rupeesToPaise(input.targetRupees), neededBy: date(input.neededBy), version: { increment: 1 } } });
    if (changed.count !== 1) throw new FundraisingError("REQUEST_CONFLICT", "This request changed. Reload it before saving.");
    await tx.donationRequestHistory.create({ data: { requestId, actorId, fromStatus: "DRAFT", toStatus: "DRAFT", fromVersion: expectedVersion, toVersion: expectedVersion + 1, snapshot: requestSnapshot(input) } });
    await tx.auditEvent.create({ data: audit(actorId, "DONATION_REQUEST_DRAFT_UPDATED", "DonationRequest", requestId, { version: expectedVersion + 1 }) });
  }, { isolationLevel: "Serializable" });
}

export async function createDonationCampaignDraft(requestId: string, input: DonationCampaignDraftInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const request = await tx.donationRequest.findUnique({ where: { id: requestId }, select: { status: true, project: { select: { operationalStatus: true, isDemo: true } } } });
    if (!request || request.status !== "DRAFT" || request.project.isDemo || ["COMPLETED", "CANCELLED"].includes(request.project.operationalStatus)) throw new FundraisingError("REQUEST_UNAVAILABLE", "Campaign planning requires an open private request draft.");
    const row = await tx.donationCampaign.create({ data: { requestId, createdById: actorId, slug: slug(input.titleEn), titleEn: input.titleEn, titleTa: nullable(input.titleTa), summaryEn: input.summaryEn, summaryTa: nullable(input.summaryTa), storyEn: nullable(input.storyEn), storyTa: nullable(input.storyTa), startsOn: date(input.startsOn), endsOn: date(input.endsOn) } });
    await tx.donationCampaignHistory.create({ data: { campaignId: row.id, actorId, toStatus: "DRAFT", toVersion: 0, snapshot: campaignSnapshot(input) } });
    await tx.auditEvent.create({ data: audit(actorId, "DONATION_CAMPAIGN_DRAFT_CREATED", "DonationCampaign", row.id, { requestId }) });
    return row;
  }, { isolationLevel: "Serializable" });
}

export async function updateDonationCampaignDraft(campaignId: string, expectedVersion: number, input: DonationCampaignDraftInput, actorId: string) {
  return db.$transaction(async (tx) => {
    const current = await tx.donationCampaign.findUnique({ where: { id: campaignId }, select: { version: true, status: true, publicationStatus: true, request: { select: { status: true, project: { select: { operationalStatus: true, isDemo: true } } } } } });
    if (!current || current.version !== expectedVersion) throw new FundraisingError("CAMPAIGN_CONFLICT", "This campaign draft changed. Reload it before saving.");
    if (current.status !== "DRAFT" || current.publicationStatus !== "DRAFT" || current.request.status !== "DRAFT" || current.request.project.isDemo || ["COMPLETED", "CANCELLED"].includes(current.request.project.operationalStatus)) throw new FundraisingError("CAMPAIGN_CLOSED", "This campaign draft cannot be edited.");
    const changed = await tx.donationCampaign.updateMany({ where: { id: campaignId, version: expectedVersion, status: "DRAFT", publicationStatus: "DRAFT" }, data: { titleEn: input.titleEn, titleTa: nullable(input.titleTa), summaryEn: input.summaryEn, summaryTa: nullable(input.summaryTa), storyEn: nullable(input.storyEn), storyTa: nullable(input.storyTa), startsOn: date(input.startsOn), endsOn: date(input.endsOn), version: { increment: 1 } } });
    if (changed.count !== 1) throw new FundraisingError("CAMPAIGN_CONFLICT", "This campaign draft changed. Reload it before saving.");
    await tx.donationCampaignHistory.create({ data: { campaignId, actorId, fromStatus: "DRAFT", toStatus: "DRAFT", fromVersion: expectedVersion, toVersion: expectedVersion + 1, snapshot: campaignSnapshot(input) } });
    await tx.auditEvent.create({ data: audit(actorId, "DONATION_CAMPAIGN_DRAFT_UPDATED", "DonationCampaign", campaignId, { version: expectedVersion + 1 }) });
  }, { isolationLevel: "Serializable" });
}

/** Protected transitions remain unavailable under the user's draft-only decision. */
export function submitDonationRequest(): never { throw new FundraisingError("APPROVAL_POLICY_INACTIVE", "Request submission needs an authorized active approval policy."); }
export function publishDonationCampaign(): never { throw new FundraisingError("PUBLIC_RELEASE_INACTIVE", "Campaign publication needs an approved request and authorized release policy."); }

export async function createDonationRequestEvidenceFromUpload(input: { requestId: string; title: string; filename: string; mimeType: string; size: number; url: string; storageKey: string }, actorId: string) {
  if (!input.storageKey.startsWith(DONATION_REQUEST_EVIDENCE_STORAGE_PREFIX)) throw new FundraisingError("PRIVATE_FILE_REQUIRED", "Use a dedicated private request file.");
  return db.$transaction(async (tx) => {
    const request = await tx.donationRequest.findUnique({ where: { id: input.requestId }, select: { status: true } });
    if (!request || request.status !== "DRAFT") throw new FundraisingError("REQUEST_CLOSED", "Supporting files can only be added to an open draft.");
    const media = await tx.media.create({ data: { url: input.url, storageKey: input.storageKey, filename: input.filename, mimeType: input.mimeType, size: input.size, visibility: "PRIVATE", uploadedById: actorId } });
    const evidence = await tx.donationRequestEvidence.create({ data: { requestId: input.requestId, mediaId: media.id, title: input.title, createdById: actorId } });
    await tx.auditEvent.create({ data: audit(actorId, "DONATION_REQUEST_EVIDENCE_ADDED", "DonationRequest", input.requestId, { evidenceId: evidence.id }) });
    return evidence;
  }, { isolationLevel: "Serializable" });
}
