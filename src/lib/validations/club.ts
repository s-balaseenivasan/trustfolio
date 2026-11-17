import { z } from "zod";

export const CLUB_CONSENT_VERSION = "club-membership-v1";
export const CLUB_CONSENT_TEXT = "I agree that Trustfolio staff and the club coordinator may use my account name and email to review and manage my club membership.";

const text = (max: number) => z.string().trim().max(max);

export const clubProfileSchema = z.object({
  nameEn: z.string().trim().min(3, "Enter an English club name.").max(120),
  nameTa: text(120),
  summaryEn: text(300),
  summaryTa: text(300),
  descriptionEn: text(4000),
  descriptionTa: text(4000),
});

export type ClubProfileInput = z.infer<typeof clubProfileSchema>;

export const clubVersionSchema = z.coerce.number().int().min(0);
