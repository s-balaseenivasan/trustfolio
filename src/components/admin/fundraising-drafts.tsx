"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/action-state";
import { addDonationCampaignDraft, addDonationRequestDraft, saveDonationCampaignDraft, saveDonationRequestDraft } from "@/server/actions/admin/fundraising";

const initial: ActionState = { status: "idle" };
const field = "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";
const button = "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50";

function Result({ state, href }: { state: ActionState; href?: string }) {
  if (state.status === "idle") return null;
  return <div role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}><p>{state.message}</p>{state.code && <p className="text-xs">Code: {state.code}</p>}{href && state.status === "success" && <Link href={href} className="underline">Open request</Link>}{state.fieldErrors && <ul className="mt-1 list-inside list-disc">{Object.entries(state.fieldErrors).flatMap(([name, errors]) => (errors ?? []).map((error) => <li key={`${name}:${error}`}>{name}: {error}</li>))}</ul>}</div>;
}

export type RequestDraft = { id: string; version: number; purposeEn: string; purposeTa: string | null; justificationEn: string; justificationTa: string | null; targetRupees: string; neededBy: string | null };
export function RequestDraftForm({ projectId, request }: { projectId: string; request?: RequestDraft }) {
  const [state, action, pending] = useActionState(request ? saveDonationRequestDraft : addDonationRequestDraft, initial);
  return <form action={action} className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-2"><input type="hidden" name="projectId" value={projectId} />{request && <><input type="hidden" name="requestId" value={request.id} /><input type="hidden" name="version" value={request.version} /></>}<div className="sm:col-span-2"><h2 className="text-lg font-semibold">{request ? "Edit private request" : "New private donation request"}</h2><p className="mt-1 text-sm text-muted-foreground">Trust-admin planning only. Submission and approvals are disabled.</p></div><label className="text-sm">Purpose (English)<input name="purposeEn" defaultValue={request?.purposeEn} required minLength={3} maxLength={160} className={field} /></label><label className="text-sm">Purpose (Tamil)<input name="purposeTa" defaultValue={request?.purposeTa ?? ""} lang="ta" maxLength={160} className={field} /></label><label className="text-sm sm:col-span-2">Justification (English)<textarea name="justificationEn" defaultValue={request?.justificationEn} required minLength={10} maxLength={4000} rows={3} className={field} /></label><label className="text-sm sm:col-span-2">Justification (Tamil)<textarea name="justificationTa" defaultValue={request?.justificationTa ?? ""} lang="ta" maxLength={4000} rows={3} className={field} /></label><label className="text-sm">Target (INR)<input name="targetRupees" defaultValue={request?.targetRupees} type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="1000.00" required className={field} /><span className="mt-1 block text-xs text-muted-foreground">Stored exactly as integer paise; no collection is enabled.</span></label><label className="text-sm">Needed by<input name="neededBy" defaultValue={request?.neededBy ?? ""} type="date" className={field} /></label><div className="sm:col-span-2 space-y-2"><button disabled={pending} className={button}>{pending ? "Saving…" : request ? "Save request draft" : "Create request draft"}</button><Result state={state} /></div></form>;
}

export type CampaignDraft = { id: string; version: number; titleEn: string; titleTa: string | null; summaryEn: string; summaryTa: string | null; storyEn: string | null; storyTa: string | null; startsOn: string | null; endsOn: string | null };
export function CampaignDraftForm({ requestId, campaign }: { requestId: string; campaign?: CampaignDraft }) {
  const [state, action, pending] = useActionState(campaign ? saveDonationCampaignDraft : addDonationCampaignDraft, initial);
  return <form action={action} className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-2"><input type="hidden" name="requestId" value={requestId} />{campaign && <><input type="hidden" name="campaignId" value={campaign.id} /><input type="hidden" name="version" value={campaign.version} /></>}<div className="sm:col-span-2"><h2 className="text-lg font-semibold">{campaign ? "Edit campaign planning draft" : "Prepare one campaign planning draft"}</h2><p className="mt-1 text-sm text-muted-foreground">This draft is private. An approved request and separate publication review are required before release.</p></div><label className="text-sm">Title (English)<input name="titleEn" defaultValue={campaign?.titleEn} required minLength={3} maxLength={160} className={field} /></label><label className="text-sm">Title (Tamil)<input name="titleTa" defaultValue={campaign?.titleTa ?? ""} lang="ta" maxLength={160} className={field} /></label><label className="text-sm sm:col-span-2">Summary (English)<textarea name="summaryEn" defaultValue={campaign?.summaryEn} required minLength={10} maxLength={500} rows={2} className={field} /></label><label className="text-sm sm:col-span-2">Summary (Tamil)<textarea name="summaryTa" defaultValue={campaign?.summaryTa ?? ""} lang="ta" maxLength={500} rows={2} className={field} /></label><label className="text-sm sm:col-span-2">Story (English)<textarea name="storyEn" defaultValue={campaign?.storyEn ?? ""} maxLength={6000} rows={4} className={field} /></label><label className="text-sm sm:col-span-2">Story (Tamil)<textarea name="storyTa" defaultValue={campaign?.storyTa ?? ""} lang="ta" maxLength={6000} rows={4} className={field} /></label><label className="text-sm">Planned start<input name="startsOn" defaultValue={campaign?.startsOn ?? ""} type="date" className={field} /></label><label className="text-sm">Planned end<input name="endsOn" defaultValue={campaign?.endsOn ?? ""} type="date" className={field} /></label><div className="sm:col-span-2 space-y-2"><button disabled={pending} className={button}>{pending ? "Saving…" : campaign ? "Save campaign draft" : "Create campaign draft"}</button><Result state={state} /></div></form>;
}

export function RequestEvidenceUpload({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function upload(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/fundraising/requests/${requestId}/evidence`, { method: "POST", body: new FormData(form), credentials: "same-origin" });
      const body = await response.json() as { error?: string };
      if (!response.ok) { setMessage({ text: body.error ?? "Could not upload evidence.", error: true }); return; }
      form.reset(); setMessage({ text: "Private evidence uploaded.", error: false }); router.refresh();
    } catch { setMessage({ text: "Upload failed. Check your connection and try again.", error: true }); }
    finally { setPending(false); }
  }
  return <form onSubmit={upload} className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-sm">Supporting file<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf" required className="mt-1 block w-full text-sm" /></label><label className="text-sm">Evidence title<input name="title" required minLength={3} maxLength={160} className={field} /></label><div className="self-end"><button type="submit" disabled={pending} className={button}>{pending ? "Uploading…" : "Upload privately"}</button></div>{message && <p role={message.error ? "alert" : "status"} className={`sm:col-span-3 text-sm ${message.error ? "text-destructive" : "text-success"}`}>{message.text}</p>}</form>;
}
