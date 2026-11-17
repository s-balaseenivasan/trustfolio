import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { VOLUNTEER_CONSENT_VERSION, type VolunteerProfileInput } from "@/lib/validations/volunteer";

export class VolunteerError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "VolunteerError"; }
}

const audit = (actorId: string, eventType: string, subjectType: string, subjectId: string, details: Prisma.InputJsonValue = {}) => ({
  actorId, eventType, subjectType, subjectId, correlationId: randomUUID(), details,
});

export async function saveVolunteerProfile(userId: string, input: VolunteerProfileInput, expectedVersion: number | null, consent: boolean, adult: boolean) {
  return db.$transaction(async (tx) => {
    const current = await tx.volunteerProfile.findUnique({ where: { userId } });
    if (!current) {
      if (!consent || !adult || expectedVersion !== null) throw new VolunteerError("VOLUNTEER_CONSENT_REQUIRED", "Confirm the adult declaration and volunteer data use.");
      const now = new Date();
      const profile = await tx.volunteerProfile.create({ data: { userId, ...input, consentVersion: VOLUNTEER_CONSENT_VERSION, consentAt: now, adultAttestedAt: now } });
      await tx.auditEvent.create({ data: audit(userId, "VOLUNTEER_PROFILE_CREATED", "VolunteerProfile", profile.id, { consentVersion: VOLUNTEER_CONSENT_VERSION }) });
      return profile;
    }
    if (current.version !== expectedVersion) throw new VolunteerError("VOLUNTEER_CONFLICT", "Your profile changed. Reload it before saving.");
    if (current.consentVersion !== VOLUNTEER_CONSENT_VERSION && (!consent || !adult)) throw new VolunteerError("VOLUNTEER_CONSENT_REQUIRED", "Confirm the current adult declaration and volunteer data use.");
    const update = await tx.volunteerProfile.updateMany({ where: { id: current.id, version: expectedVersion }, data: { ...input, version: { increment: 1 }, ...(consent && adult ? { consentAt: new Date(), adultAttestedAt: new Date(), consentVersion: VOLUNTEER_CONSENT_VERSION } : {}) } });
    if (update.count !== 1) throw new VolunteerError("VOLUNTEER_CONFLICT", "Your profile changed. Reload it before saving.");
    await tx.auditEvent.create({ data: audit(userId, "VOLUNTEER_PROFILE_UPDATED", "VolunteerProfile", current.id, { version: expectedVersion + 1 }) });
    if (consent && adult) await tx.auditEvent.create({ data: audit(userId, "VOLUNTEER_CONSENT_RECORDED", "VolunteerProfile", current.id, { fromVersion: current.consentVersion, toVersion: VOLUNTEER_CONSENT_VERSION }) });
    return tx.volunteerProfile.findUniqueOrThrow({ where: { id: current.id } });
  }, { isolationLevel: "Serializable" });
}

export async function addAvailability(userId: string, input: { weekday: number; startMinute: number; endMinute: number; timeZone: string }) {
  try { new Intl.DateTimeFormat("en", { timeZone: input.timeZone }); } catch { throw new VolunteerError("INVALID_TIME_ZONE", "Choose a valid time zone."); }
  return db.$transaction(async (tx) => {
    const profile = await tx.volunteerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new VolunteerError("PROFILE_REQUIRED", "Create your volunteer profile first.");
    const row = await tx.volunteerAvailability.create({ data: { ...input, profileId: profile.id } });
    await tx.auditEvent.create({ data: audit(userId, "VOLUNTEER_AVAILABILITY_ADDED", "VolunteerProfile", profile.id, { availabilityId: row.id }) });
    return row;
  });
}

export async function removeAvailability(userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const row = await tx.volunteerAvailability.findUnique({ where: { id }, select: { profile: { select: { id: true, userId: true } } } });
    if (!row || row.profile.userId !== userId) throw new VolunteerError("VOLUNTEER_SCOPE_DENIED", "That availability is unavailable.");
    await tx.volunteerAvailability.delete({ where: { id } });
    await tx.auditEvent.create({ data: audit(userId, "VOLUNTEER_AVAILABILITY_REMOVED", "VolunteerProfile", row.profile.id, { availabilityId: id }) });
  });
}

export async function submitAttendance(userId: string, input: { clubId: string; serviceDate: string; activityTitle: string }) {
  const date = new Date(`${input.serviceDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.serviceDate || date.getTime() > Date.now()) throw new VolunteerError("INVALID_SERVICE_DATE", "Choose a past or current service date.");
  return db.$transaction(async (tx) => {
    const [profile, membership] = await Promise.all([
      tx.volunteerProfile.findUnique({ where: { userId } }),
      tx.clubMembership.findUnique({ where: { clubId_userId: { clubId: input.clubId, userId } }, select: { status: true, club: { select: { status: true } } } }),
    ]);
    if (!profile || profile.consentVersion !== VOLUNTEER_CONSENT_VERSION) throw new VolunteerError("PROFILE_REQUIRED", "Create a current volunteer profile first.");
    if (membership?.status !== "ACTIVE" || membership.club.status !== "ACTIVE") throw new VolunteerError("VOLUNTEER_CLUB_DENIED", "An active approved club membership is required.");
    const row = await tx.volunteerAttendance.create({ data: { profileId: profile.id, clubId: input.clubId, serviceDate: date, activityTitle: input.activityTitle } });
    await tx.volunteerAttendanceHistory.create({ data: { attendanceId: row.id, actorId: userId, toStatus: "SUBMITTED", snapshot: { serviceDate: input.serviceDate, activityTitle: input.activityTitle } } });
    await tx.auditEvent.create({ data: audit(userId, "VOLUNTEER_ATTENDANCE_SUBMITTED", "VolunteerAttendance", row.id, { clubId: input.clubId }) });
    return row;
  }, { isolationLevel: "Serializable" });
}

export async function submitServiceLog(userId: string, input: { attendanceId: string; minutes: number; description: string }) {
  return db.$transaction(async (tx) => {
    const attendance = await tx.volunteerAttendance.findUnique({ where: { id: input.attendanceId }, include: { profile: { select: { id: true, userId: true } }, club: { select: { status: true } }, serviceLog: { select: { id: true } } } });
    if (!attendance || attendance.profile.userId !== userId || attendance.status !== "APPROVED" || attendance.club.status !== "ACTIVE" || attendance.serviceLog) throw new VolunteerError("ATTENDANCE_REQUIRED", "Choose your approved attendance without an existing hours record.");
    const membership = await tx.clubMembership.findUnique({ where: { clubId_userId: { clubId: attendance.clubId, userId } }, select: { status: true } });
    if (membership?.status !== "ACTIVE") throw new VolunteerError("VOLUNTEER_CLUB_DENIED", "An active approved club membership is required.");
    const row = await tx.volunteerServiceLog.create({ data: { profileId: attendance.profile.id, attendanceId: attendance.id, minutes: input.minutes, description: input.description } });
    await tx.volunteerServiceLogHistory.create({ data: { serviceLogId: row.id, actorId: userId, toStatus: "SUBMITTED", snapshot: { minutes: input.minutes, description: input.description } } });
    await tx.auditEvent.create({ data: audit(userId, "VOLUNTEER_HOURS_SUBMITTED", "VolunteerServiceLog", row.id, { attendanceId: attendance.id }) });
    return row;
  }, { isolationLevel: "Serializable" });
}

export async function reviewVolunteerRecord(kind: "ATTENDANCE" | "SERVICE", id: string, expectedVersion: number, actorId: string, decision: "APPROVED" | "REJECTED" | "VOIDED", reason: string) {
  if (decision !== "APPROVED" && reason.trim().length < 3) throw new VolunteerError("REASON_REQUIRED", "Give a reason for rejection or correction.");
  return db.$transaction(async (tx) => {
    const now = new Date();
    if (kind === "ATTENDANCE") {
      const row = await tx.volunteerAttendance.findUnique({ where: { id }, include: { profile: { select: { userId: true } }, serviceLog: { select: { id: true, status: true, version: true } } } });
      if (!row || row.version !== expectedVersion || (decision === "VOIDED" ? row.status !== "APPROVED" : row.status !== "SUBMITTED")) throw new VolunteerError("VOLUNTEER_CONFLICT", "This attendance changed. Reload it before deciding.");
      if (row.profile.userId === actorId) throw new VolunteerError("SELF_APPROVAL", "You cannot review your own record.");
      const updated = await tx.volunteerAttendance.updateMany({ where: { id, version: expectedVersion, status: row.status }, data: { status: decision, version: { increment: 1 }, reviewedById: actorId, reviewedAt: now } });
      if (updated.count !== 1) throw new VolunteerError("VOLUNTEER_CONFLICT", "This attendance changed. Reload it before deciding.");
      await tx.volunteerAttendanceHistory.create({ data: { attendanceId: id, actorId, fromStatus: row.status, toStatus: decision, reason: reason.trim() || null, snapshot: { serviceDate: row.serviceDate.toISOString().slice(0, 10), activityTitle: row.activityTitle } } });
      if (decision === "VOIDED" && row.serviceLog && row.serviceLog.status !== "VOIDED") {
        await tx.volunteerServiceLog.update({ where: { id: row.serviceLog.id }, data: { status: "VOIDED", version: { increment: 1 }, reviewedById: actorId, reviewedAt: now } });
        await tx.volunteerServiceLogHistory.create({ data: { serviceLogId: row.serviceLog.id, actorId, fromStatus: row.serviceLog.status, toStatus: "VOIDED", reason: `Attendance voided: ${reason.trim()}`, snapshot: { attendanceId: id } } });
      }
      await tx.auditEvent.create({ data: audit(actorId, `VOLUNTEER_ATTENDANCE_${decision}`, "VolunteerAttendance", id, { version: expectedVersion + 1 }) });
      await tx.notificationOutbox.create({ data: { dedupeKey: `volunteer-attendance:${id}:v${expectedVersion + 1}`, recipientId: row.profile.userId, templateKey: `VOLUNTEER_ATTENDANCE_${decision}`, payload: { attendanceId: id } } });
      return;
    }
    const row = await tx.volunteerServiceLog.findUnique({ where: { id }, include: { profile: { select: { userId: true } }, attendance: { select: { status: true } } } });
    if (!row || row.version !== expectedVersion || (decision === "VOIDED" ? row.status !== "APPROVED" : row.status !== "SUBMITTED")) throw new VolunteerError("VOLUNTEER_CONFLICT", "This service log changed. Reload it before deciding.");
    if (row.profile.userId === actorId) throw new VolunteerError("SELF_APPROVAL", "You cannot review your own record.");
    if (decision === "APPROVED" && row.attendance.status !== "APPROVED") throw new VolunteerError("ATTENDANCE_REQUIRED", "Attendance approval is required before hours count.");
    const updated = await tx.volunteerServiceLog.updateMany({ where: { id, version: expectedVersion, status: row.status }, data: { status: decision, version: { increment: 1 }, reviewedById: actorId, reviewedAt: now } });
    if (updated.count !== 1) throw new VolunteerError("VOLUNTEER_CONFLICT", "This service log changed. Reload it before deciding.");
    await tx.volunteerServiceLogHistory.create({ data: { serviceLogId: id, actorId, fromStatus: row.status, toStatus: decision, reason: reason.trim() || null, snapshot: { minutes: row.minutes, description: row.description, attendanceId: row.attendanceId } } });
    await tx.auditEvent.create({ data: audit(actorId, `VOLUNTEER_HOURS_${decision}`, "VolunteerServiceLog", id, { version: expectedVersion + 1 }) });
    await tx.notificationOutbox.create({ data: { dedupeKey: `volunteer-hours:${id}:v${expectedVersion + 1}`, recipientId: row.profile.userId, templateKey: `VOLUNTEER_HOURS_${decision}`, payload: { serviceLogId: id } } });
  }, { isolationLevel: "Serializable" });
}
