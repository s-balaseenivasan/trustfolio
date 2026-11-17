import { z } from "zod";

const id = z.string().min(1).max(64);
const optionalId = z.union([id, z.literal("")]).transform((value) => value || null);
const optionalDate = z.union([z.iso.date(), z.literal("")]).transform((value) => value || null);
export const operationalVersionSchema = z.coerce.number().int().min(0);

export const projectPlanSchema = z.object({
  ownerId: optionalId,
  managerId: optionalId,
  operationalStartDate: optionalDate,
  operationalEndDate: optionalDate,
  beneficiaryPlan: z.string().trim().max(3000),
  budgetPlanningNote: z.string().trim().max(3000),
}).refine((value) => !value.operationalStartDate || !value.operationalEndDate || value.operationalEndDate >= value.operationalStartDate, { path: ["operationalEndDate"], message: "End date must follow start date." });
export type ProjectPlanInput = z.infer<typeof projectPlanSchema>;

export const clubAssignmentSchema = z.object({
  clubId: id,
  coordinatorId: id,
  responsibilities: z.string().trim().min(3).max(3000),
  canViewTasks: z.boolean(),
  canReportContribution: z.boolean(),
});
export type ClubAssignmentInput = z.infer<typeof clubAssignmentSchema>;

export const milestoneSchema = z.object({
  titleEn: z.string().trim().min(3).max(160),
  titleTa: z.string().trim().max(160),
  description: z.string().trim().max(2000),
  dueDate: optionalDate,
});
export type MilestoneInput = z.infer<typeof milestoneSchema>;

export const taskSchema = z.object({
  clubAssignmentId: id,
  milestoneId: optionalId,
  parentId: optionalId,
  titleEn: z.string().trim().min(3).max(160),
  titleTa: z.string().trim().max(160),
  description: z.string().trim().max(4000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  startDate: optionalDate,
  dueDate: optionalDate,
}).refine((value) => !value.startDate || !value.dueDate || value.dueDate >= value.startDate, { path: ["dueDate"], message: "Due date must follow start date." });
export type TaskInput = z.infer<typeof taskSchema>;

export const taskProgressSchema = z.object({
  progressPercent: z.coerce.number().int().min(0).max(100),
  submit: z.boolean(),
  note: z.string().trim().min(3).max(2000),
});
export type TaskProgressInput = z.infer<typeof taskProgressSchema>;
