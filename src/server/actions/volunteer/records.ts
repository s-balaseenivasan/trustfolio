"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsFrom, formValues } from "@/lib/action-state";
import { rateLimit } from "@/lib/rate-limit";
import { attendanceSchema, availabilitySchema, serviceLogSchema, volunteerProfileSchema, volunteerVersionSchema } from "@/lib/validations/volunteer";
import { getAdminUser } from "@/server/auth-guard";
import { addAvailability, removeAvailability, saveVolunteerProfile, submitAttendance, submitServiceLog, VolunteerError } from "@/server/volunteers/service";

async function run(formData: FormData, work: (userId: string) => Promise<string>): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const user = await getAdminUser();
    if (!user) return { status: "error", message: "Sign in to continue.", values };
    const limit = await rateLimit(`volunteer-write:${user.id}`, { limit: 30, windowMs: 60 * 60 * 1000 });
    if (!limit.success) return { status: "error", message: "Too many changes. Try again later.", values };
    const message = await work(user.id);
    revalidatePath("/volunteer");
    revalidatePath("/admin/volunteers");
    return { status: "success", message };
  } catch (error) {
    if (error instanceof VolunteerError) return { status: "error", message: error.message, values };
    if (error instanceof z.ZodError) return { status: "error", message: "Correct the highlighted values.", fieldErrors: fieldErrorsFrom(error), values };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "error", message: "This record already exists.", values };
    console.error("[volunteers] portal action failed", error);
    return { status: "error", message: "Could not save this change. Try again later.", values };
  }
}

export async function saveMyVolunteerProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (userId) => {
    const input = volunteerProfileSchema.parse({
      about: formData.get("about"), skills: formData.get("skills"), interests: formData.get("interests"),
      shareSkillsWithClubs: formData.get("shareSkillsWithClubs") === "yes",
    });
    const version = formData.get("version") ? volunteerVersionSchema.parse(formData.get("version")) : null;
    await saveVolunteerProfile(userId, input, version, formData.get("consent") === "yes", formData.get("adult") === "yes");
    return "Volunteer profile saved.";
  });
}

export async function addMyAvailability(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (userId) => {
    const minuteOfDay = (value: FormDataEntryValue | null) => {
      if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new VolunteerError("INVALID_TIME", "Choose valid start and end times.");
      const [hour, minute] = value.split(":").map(Number);
      return hour * 60 + minute;
    };
    const input = availabilitySchema.parse({ weekday: formData.get("weekday"), startMinute: minuteOfDay(formData.get("startTime")), endMinute: minuteOfDay(formData.get("endTime")), timeZone: formData.get("timeZone") });
    await addAvailability(userId, input);
    return "Availability saved.";
  });
}

export async function removeMyAvailability(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (userId) => {
    await removeAvailability(userId, z.string().min(1).max(64).parse(formData.get("id")));
    return "Availability removed.";
  });
}

export async function submitMyAttendance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (userId) => {
    const input = attendanceSchema.parse(Object.fromEntries(formData));
    await submitAttendance(userId, input);
    return "Attendance submitted for trust-admin review.";
  });
}

export async function submitMyServiceLog(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async (userId) => {
    const input = serviceLogSchema.parse(Object.fromEntries(formData));
    await submitServiceLog(userId, input);
    return "Service hours submitted for trust-admin review.";
  });
}
