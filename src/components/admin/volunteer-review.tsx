"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { decideVolunteerRecord } from "@/server/actions/admin/volunteers";

const idle: ActionState = { status: "idle" };
export function VolunteerReview({ kind, id, version, status }: { kind: "ATTENDANCE" | "SERVICE"; id: string; version: number; status: string }) {
  const [state, action, pending] = useActionState(decideVolunteerRecord, idle);
  return <div className="space-y-2"><form action={action} className="flex flex-wrap gap-2"><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={version} /><select name="decision" aria-label="Review decision" className="rounded-lg border bg-background px-2 py-1 text-sm">{status === "SUBMITTED" ? <><option value="APPROVED">Approve</option><option value="REJECTED">Reject</option></> : <option value="VOIDED">Void approved record</option>}</select><input name="reason" aria-label="Review reason" placeholder={status === "APPROVED" ? "Correction reason required" : "Reason if rejecting"} maxLength={1000} className="min-w-40 flex-1 rounded-lg border bg-background px-2 py-1 text-sm" /><button disabled={pending} className="rounded-lg bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : "Decide"}</button></form>{state.status !== "idle" && <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>{state.message}</p>}</div>;
}
