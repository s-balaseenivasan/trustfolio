import { z } from "zod";

const optionalDate = z.union([z.iso.date(), z.literal("")]).transform((value) => value || null);
const inrAmount = z.string().trim().regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/, "Enter INR with at most two decimal places.");

/** Parse a displayed rupee amount exactly; all stored draft targets are integer paise. */
export function rupeesToPaise(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid INR amount");
  const [whole, fraction = ""] = value.split(".");
  const paise = BigInt(whole!) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (paise <= BigInt(0)) throw new Error("Target must be greater than zero");
  return paise;
}

export function formatPaise(value: bigint): string {
  const sign = value < BigInt(0) ? "-" : "";
  const absolute = value < BigInt(0) ? -value : value;
  return `${sign}₹${new Intl.NumberFormat("en-IN").format(absolute / BigInt(100))}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}

export function paiseToRupeesInput(value: bigint): string {
  return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, "0")}`;
}

export const fundraisingVersionSchema = z.coerce.number().int().min(0);

export const donationRequestDraftSchema = z.object({
  purposeEn: z.string().trim().min(3).max(160),
  purposeTa: z.string().trim().max(160),
  justificationEn: z.string().trim().min(10).max(4000),
  justificationTa: z.string().trim().max(4000),
  targetRupees: inrAmount.refine((value) => { try { return rupeesToPaise(value) > BigInt(0); } catch { return false; } }, "Target must be greater than zero."),
  neededBy: optionalDate,
});
export type DonationRequestDraftInput = z.infer<typeof donationRequestDraftSchema>;

export const donationCampaignDraftSchema = z.object({
  titleEn: z.string().trim().min(3).max(160),
  titleTa: z.string().trim().max(160),
  summaryEn: z.string().trim().min(10).max(500),
  summaryTa: z.string().trim().max(500),
  storyEn: z.string().trim().max(6000),
  storyTa: z.string().trim().max(6000),
  startsOn: optionalDate,
  endsOn: optionalDate,
}).refine((value) => !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn, { path: ["endsOn"], message: "End date must follow start date." });
export type DonationCampaignDraftInput = z.infer<typeof donationCampaignDraftSchema>;
