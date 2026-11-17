import { z } from "zod";

export const VOLUNTEER_CONSENT_VERSION = "volunteer-profile-2026-10-v1";
export const VOLUNTEER_CONSENT_TEXT = "I confirm I am an adult and consent to Trustfolio storing my volunteer profile, availability, attendance and service records for trust operations. My skills are private unless I choose to share them with coordinators of clubs I join.";

const tags = z.string().trim().max(400).transform((value) => [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 12));
export const volunteerProfileSchema = z.object({
  about: z.string().trim().max(1000),
  skills: tags,
  interests: tags,
  shareSkillsWithClubs: z.boolean(),
});
export type VolunteerProfileInput = z.infer<typeof volunteerProfileSchema>;

export const availabilitySchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  startMinute: z.coerce.number().int().min(0).max(1439),
  endMinute: z.coerce.number().int().min(1).max(1440),
  timeZone: z.string().trim().min(1).max(64),
}).refine((value) => value.endMinute > value.startMinute, { message: "End time must follow start time." });

export const attendanceSchema = z.object({
  clubId: z.string().min(1).max(64),
  serviceDate: z.iso.date(),
  activityTitle: z.string().trim().min(3).max(160),
});
export const serviceLogSchema = z.object({
  attendanceId: z.string().min(1).max(64),
  minutes: z.coerce.number().int().min(1).max(1440),
  description: z.string().trim().min(3).max(1000),
});
export const volunteerVersionSchema = z.coerce.number().int().min(0);
