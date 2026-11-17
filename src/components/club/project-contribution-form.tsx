"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { reportClubContribution } from "@/server/actions/projects/tasks";

const initial: ActionState = { status: "idle" };

export function ProjectContributionForm({ assignmentId }: { assignmentId: string }) {
  const [state, action, pending] = useActionState(reportClubContribution, initial);
  return <form action={action} className="mt-4 space-y-3">
    <input type="hidden" name="assignmentId" value={assignmentId} />
    <label className="block text-sm">Date of contribution<input name="occurredDate" type="date" required max={new Date().toISOString().slice(0, 10)} defaultValue={new Date().toISOString().slice(0, 10)} className="mt-1 block w-full rounded-lg border bg-background px-3 py-2" /></label>
    <label className="block text-sm">Contribution note<textarea name="description" required minLength={3} maxLength={2000} rows={3} className="mt-1 block w-full rounded-lg border bg-background px-3 py-2" /></label>
    {state.status !== "idle" && <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>{state.message}</p>}
    <button disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : "Record contribution"}</button>
  </form>;
}
