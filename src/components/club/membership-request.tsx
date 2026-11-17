"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";
import { CLUB_CONSENT_TEXT } from "@/lib/validations/club";
import { requestMyClubMembership } from "@/server/actions/club/membership";

const idle: ActionState = { status: "idle" };

export function MembershipRequest({ clubId }: { clubId: string }) {
  const [state, action, pending] = useActionState(requestMyClubMembership, idle);
  return <form action={action} className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-4 text-sm">
    <input type="hidden" name="clubId" value={clubId} />
    <label className="flex gap-2"><input type="checkbox" name="adult" value="yes" required className="mt-1" /><span>I confirm that I am 18 or older.</span></label>
    <label className="flex gap-2"><input type="checkbox" name="consent" value="yes" required className="mt-1" /><span>{CLUB_CONSENT_TEXT}</span></label>
    {state.status !== "idle" && <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-destructive" : "text-success"}>{state.message}</p>}
    <Button type="submit" size="sm" disabled={pending}>{pending ? "Submitting…" : "Request membership"}</Button>
  </form>;
}
