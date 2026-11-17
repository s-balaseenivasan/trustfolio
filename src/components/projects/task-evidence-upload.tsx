"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TaskEvidenceUpload({ taskId, disabled = false }: { taskId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function upload(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/project-tasks/${taskId}/evidence`, { method: "POST", body: new FormData(form), credentials: "same-origin" });
      const body = await response.json() as { error?: string };
      if (!response.ok) { setMessage({ text: body.error ?? "Could not upload evidence.", error: true }); return; }
      form.reset(); setMessage({ text: "Private evidence uploaded.", error: false }); router.refresh();
    } catch { setMessage({ text: "Upload failed. Check your connection and try again.", error: true }); }
    finally { setPending(false); }
  }
  return <form onSubmit={upload} className="grid gap-3 sm:grid-cols-4"><label className="text-sm">Evidence file<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf" required className="mt-1 block w-full text-sm" /></label><label className="text-sm">Title<input name="title" required minLength={3} maxLength={160} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" /></label><label className="text-sm">Purpose<select name="kind" className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"><option value="ATTACHMENT">Attachment</option><option value="COMPLETION">Completion evidence</option></select></label><div className="self-end"><button type="submit" disabled={pending || disabled} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Uploading…" : "Upload privately"}</button></div>{message && <p role={message.error ? "alert" : "status"} className={`sm:col-span-4 text-sm ${message.error ? "text-destructive" : "text-success"}`}>{message.text}</p>}</form>;
}
