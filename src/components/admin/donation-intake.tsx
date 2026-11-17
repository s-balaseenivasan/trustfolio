"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { idleState } from "@/lib/action-state";
import { linkDonorAccount, recordManualDonationIntake } from "@/server/actions/admin/donations";

type Choice = { id: string; label: string };
function Result({ state }: { state: ActionState }) {
  if (state.status === "idle") return null;
  return <p role="status" className={state.status === "error" ? "mt-3 text-sm text-destructive" : "mt-3 text-sm text-emerald-700"}>{state.message}</p>;
}
const inputClass = "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";

export function DonorLinkForm() {
  const [state, action, pending] = useActionState(linkDonorAccount, idleState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [state.status, router]);
  return <form action={action} className="rounded-2xl border bg-card p-5">
    <h2 className="font-semibold">Link existing portal account</h2>
    <p className="mt-1 text-sm text-muted-foreground">No donor sign-up is enabled. The account must already have the PORTAL_USER role.</p>
    <label className="mt-4 block text-sm">Account email<input required type="email" name="email" autoComplete="email" className={inputClass} /></label>
    <label className="mt-3 block text-sm">Donor type<select name="type" className={inputClass}><option value="INDIVIDUAL">Individual</option><option value="ORGANIZATION">Organization</option></select></label>
    <label className="mt-3 block text-sm">Organization name (required for organizations)<input name="organizationName" maxLength={180} className={inputClass} /></label>
    <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" name="anonymousByDefault" defaultChecked disabled /><span>Public display defaults to anonymous. Public campaign and donor display are not enabled.</span></label>
    <button disabled={pending} className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "Saving…" : "Link account"}</button><Result state={state} />
  </form>;
}

export function ManualDonationIntakeForm({ donors, projects, today, idempotencyKey }: { donors: Choice[]; projects: Choice[]; today: string; idempotencyKey: string }) {
  const [state, action, pending] = useActionState(recordManualDonationIntake, idleState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [state.status, router]);
  return <form action={action} className="rounded-2xl border bg-card p-5">
    <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    <input type="hidden" name="campaignId" value="" />
    <h2 className="font-semibold">Record offline donation intake</h2>
    <p className="mt-1 text-sm text-muted-foreground">Pending only: no verification, receipt, fund allocation, confirmed total, or ledger posting is available in this phase.</p>
    <label className="mt-4 block text-sm">Existing donor profile<select name="donorProfileId" required className={inputClass}><option value="">Choose a donor</option>{donors.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
    <label className="mt-3 block text-sm">Published project<select name="projectId" required className={inputClass}><option value="">Choose a project</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
    <label className="mt-3 block text-sm">Amount (INR)<input required name="amountRupees" inputMode="decimal" placeholder="0.00" className={inputClass} /></label>
    <label className="mt-3 block text-sm">Payment method<select name="method" className={inputClass}><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="UPI">UPI</option></select></label>
    <label className="mt-3 block text-sm">Received date<input required name="receivedAt" type="date" max={today} defaultValue={today} className={inputClass} /></label>
    <label className="mt-3 block text-sm">Reference number (optional)<input name="reference" maxLength={160} className={inputClass} /></label>
    <label className="mt-3 block text-sm">Private intake note (optional)<textarea name="privateNote" maxLength={1000} rows={2} className={inputClass} /></label>
    <button disabled={pending || donors.length === 0 || projects.length === 0} className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "Recording…" : "Record pending intake"}</button><Result state={state} />
  </form>;
}

export function DonationEvidenceUpload({ donationId }: { donationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function upload(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/donations/${donationId}/evidence`, { method: "POST", body: new FormData(form), credentials: "same-origin" });
      const body = await response.json() as { error?: string };
      if (!response.ok) { setMessage({ text: body.error ?? "Could not upload evidence.", error: true }); return; }
      form.reset(); setMessage({ text: "Private evidence uploaded.", error: false }); router.refresh();
    } catch { setMessage({ text: "Upload failed. Check your connection and try again.", error: true }); }
    finally { setPending(false); }
  }
  return <form onSubmit={upload} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs">Evidence file<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf" required className="mt-1 block w-full text-xs" /></label><label className="text-xs">Title<input name="title" required minLength={3} maxLength={160} className={inputClass} /></label><button type="submit" disabled={pending} className="self-end rounded-lg border px-3 py-2 text-xs disabled:opacity-60">{pending ? "Uploading…" : "Upload privately"}</button>{message && <p role={message.error ? "alert" : "status"} className={`sm:col-span-3 text-xs ${message.error ? "text-destructive" : "text-emerald-700"}`}>{message.text}</p>}</form>;
}
