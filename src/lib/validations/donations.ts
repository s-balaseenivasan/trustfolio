import { z } from "zod";
import { rupeesToPaise } from "@/lib/validations/fundraising";

const rupees = z.string().trim().regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/, "Enter INR with at most two decimal places.")
  .refine((value) => { try { return rupeesToPaise(value) > BigInt(0); } catch { return false; } }, "Amount must be greater than zero.");

export const donorProfileSchema = z.object({
  email: z.email().trim().toLowerCase(),
  type: z.enum(["INDIVIDUAL", "ORGANIZATION"]),
  organizationName: z.string().trim().max(180),
}).superRefine((value, ctx) => {
  if (value.type === "ORGANIZATION" && !value.organizationName) ctx.addIssue({ code: "custom", path: ["organizationName"], message: "Enter the organization name." });
});

export const manualDonationIntakeSchema = z.object({
  idempotencyKey: z.uuid(),
  donorProfileId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
  campaignId: z.string().max(64),
  amountRupees: rupees,
  method: z.enum(["CASH", "BANK_TRANSFER", "UPI"]),
  receivedAt: z.iso.date().refine((value) => value <= new Date().toISOString().slice(0, 10), "Received date cannot be in the future."),
  reference: z.string().trim().max(160),
  privateNote: z.string().trim().max(1000),
});

export type DonorProfileInput = z.infer<typeof donorProfileSchema>;
export type ManualDonationIntakeInput = z.infer<typeof manualDonationIntakeSchema>;
