"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { TaskEvidenceUpload } from "@/components/projects/task-evidence-upload";
import { updateAssignedTask } from "@/server/actions/projects/tasks";

const idle: ActionState = { status: "idle" };
export function TaskProgress({ taskId, version, status, progressPercent, dependenciesOpen }: { taskId: string; version: number; status: string; progressPercent: number; dependenciesOpen: boolean }) {
  const [state, action, pending] = useActionState(updateAssignedTask, idle);
  const editable = ["TODO", "IN_PROGRESS"].includes(status) && !dependenciesOpen;
  return <div className="space-y-5"><form action={action} className="space-y-4 rounded-2xl border bg-card p-5"><h2 className="text-lg font-semibold">Update my task</h2><input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="version" value={version} /><label className="block text-sm">Progress (%)<input name="progressPercent" type="number" min={0} max={100} required defaultValue={progressPercent} disabled={!editable} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" /></label><label className="block text-sm">Work update or completion evidence note<textarea name="note" required minLength={3} maxLength={2000} rows={3} disabled={!editable} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" /></label><label className="flex gap-2 text-sm"><input type="checkbox" name="submit" value="yes" disabled={!editable} />Submit completed work for trust-admin review (requires 100%)</label><p className="text-xs text-muted-foreground">A completion note is retained as evidence. Upload a supporting private file below when available.</p>{dependenciesOpen && <p className="text-sm text-warning">Complete predecessor tasks before updating this task.</p>}{state.status !== "idle" && <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>{state.message}</p>}<button disabled={pending || !editable} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : "Save task update"}</button></form>{editable && <section className="rounded-2xl border bg-card p-5"><h2 className="mb-3 font-semibold">Private attachment or completion evidence</h2><TaskEvidenceUpload taskId={taskId} /></section>}</div>;
}
