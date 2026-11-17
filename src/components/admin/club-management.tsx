"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/lib/action-state";
import { addClub, decideMembership, editClub, endMembership, inviteMember, removeClubDocument, setClubStatus, setCoordinator } from "@/server/actions/admin/clubs";

const idle: ActionState = { status: "idle" };
const selectClass = "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";

function Result({ state }: { state: ActionState }) {
  if (state.status === "idle") return null;
  return <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>{state.message}</p>;
}

function ProfileFields({ club }: { club?: ClubDetail }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div><Label htmlFor="club-name-en">Name (English)</Label><Input id="club-name-en" name="nameEn" required maxLength={120} defaultValue={club?.nameEn ?? ""} /></div>
      <div><Label htmlFor="club-name-ta">Name (Tamil)</Label><Input id="club-name-ta" name="nameTa" maxLength={120} defaultValue={club?.nameTa ?? ""} lang="ta" /></div>
      <div><Label htmlFor="club-summary-en">Summary (English)</Label><Input id="club-summary-en" name="summaryEn" maxLength={300} defaultValue={club?.summaryEn ?? ""} /></div>
      <div><Label htmlFor="club-summary-ta">Summary (Tamil)</Label><Input id="club-summary-ta" name="summaryTa" maxLength={300} defaultValue={club?.summaryTa ?? ""} lang="ta" /></div>
      <div><Label htmlFor="club-description-en">Description (English)</Label><textarea id="club-description-en" name="descriptionEn" maxLength={4000} defaultValue={club?.descriptionEn ?? ""} rows={4} className={selectClass} /></div>
      <div><Label htmlFor="club-description-ta">Description (Tamil)</Label><textarea id="club-description-ta" name="descriptionTa" maxLength={4000} defaultValue={club?.descriptionTa ?? ""} rows={4} lang="ta" className={selectClass} /></div>
    </div>
  );
}

export function CreateClubForm() {
  const [state, action, pending] = useActionState(addClub, idle);
  return (
    <Card>
      <CardHeader><CardTitle>Create a club</CardTitle><CardDescription>A generated code identifies the draft. No public club page is created.</CardDescription></CardHeader>
      <CardContent>
        <form action={action} className="space-y-5">
          <ProfileFields />
          <Result state={state} />
          {state.status === "success" && state.id && <Link className="text-sm text-brand underline" href={`/admin/clubs/${state.id}`}>Open the new club</Link>}
          <div><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create draft club"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

export type ClubDetail = {
  id: string; code: string; nameEn: string; nameTa: string | null; summaryEn: string | null; summaryTa: string | null;
  descriptionEn: string | null; descriptionTa: string | null; status: "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  publicationStatus: string; version: number; coordinatorId: string | null;
};
export type Member = { id: string; userId: string; userName: string | null; userEmail: string; role: string; status: string; version: number; consentAt: string | null; adultAttestedAt: string | null; history: { id: string; toStatus: string; toRole: string; reason: string | null; createdAt: string; actor: string }[] };
export type PrivateFile = { id: string; titleEn: string; titleTa: string | null; mediaId: string; filename: string; createdAt: string; archivedAt: string | null };
export type UserOption = { id: string; email: string; name: string | null };

function ClubDocumentUploader({ clubId, disabled }: { clubId: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function upload(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/clubs/${clubId}/documents`, { method: "POST", body: new FormData(form), credentials: "same-origin" });
      const body = await response.json() as { id?: string; error?: string };
      if (!response.ok) { setMessage({ text: body.error ?? "Could not upload this document.", error: true }); return; }
      form.reset();
      setMessage({ text: "Private club document uploaded.", error: false });
      router.refresh();
    } catch {
      setMessage({ text: "Upload failed. Check your connection and try again.", error: true });
    } finally { setPending(false); }
  }
  return <form onSubmit={upload} className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="club-file">Private file</Label><Input id="club-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf" required /></div><div><Label htmlFor="club-document-title">Title (English)</Label><Input id="club-document-title" name="titleEn" required maxLength={160} /></div><div><Label htmlFor="club-document-title-ta">Title (Tamil)</Label><Input id="club-document-title-ta" name="titleTa" lang="ta" maxLength={160} /></div><div className="self-end"><Button type="submit" disabled={pending || disabled}>{pending ? "Uploading…" : "Upload document"}</Button></div>{message && <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-destructive" : "text-sm text-success"}>{message.text}</p>}</form>;
}

export function ClubAdminEditor({ club, members, files, users }: { club: ClubDetail; members: Member[]; files: PrivateFile[]; users: UserOption[] }) {
  const [profileState, profileAction, profilePending] = useActionState(editClub, idle);
  const [statusState, statusAction, statusPending] = useActionState(setClubStatus, idle);
  const [inviteState, inviteAction, invitePending] = useActionState(inviteMember, idle);
  const [decisionState, decisionAction, decisionPending] = useActionState(decideMembership, idle);
  const [coordinatorState, coordinatorAction, coordinatorPending] = useActionState(setCoordinator, idle);
  const [membershipState, membershipAction, membershipPending] = useActionState(endMembership, idle);
  const [archiveState, archiveAction, archivePending] = useActionState(removeClubDocument, idle);
  const inviteCandidates = users.filter((user) => !members.some((member) => member.userId === user.id && !["REJECTED", "ENDED"].includes(member.status)));
  const activeMembers = members.filter((member) => member.status === "ACTIVE");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2"><Badge variant="outline">{club.code}</Badge><Badge variant={club.status === "ACTIVE" ? "success" : club.status === "SUSPENDED" ? "warning" : "secondary"}>{club.status}</Badge><Badge variant="outline">Public: {club.publicationStatus}</Badge></div>
      <Card>
        <CardHeader><CardTitle>Club profile</CardTitle><CardDescription>Operational club details. Public release remains separate.</CardDescription></CardHeader>
        <CardContent>
          <form action={profileAction} className="space-y-5">
            <input type="hidden" name="clubId" value={club.id} /><input type="hidden" name="version" value={club.version} />
            <ProfileFields key={club.version} club={club} />
            <Result state={profileState} />
            <Button type="submit" disabled={profilePending || club.status === "ARCHIVED"}>Save profile</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Operational status</CardTitle><CardDescription>Suspension blocks membership changes and coordinator access. History remains available to admins.</CardDescription></CardHeader>
        <CardContent>
          <form action={statusAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="clubId" value={club.id} /><input type="hidden" name="version" value={club.version} />
            <div><Label htmlFor="club-status">Change to</Label><select id="club-status" name="target" className={selectClass} disabled={club.status === "ARCHIVED"}>
              {club.status === "DRAFT" && <><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></>}
              {club.status === "ACTIVE" && <><option value="SUSPENDED">Suspended</option><option value="ARCHIVED">Archived</option></>}
              {club.status === "SUSPENDED" && <><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></>}
            </select></div>
            <Button type="submit" variant="outline" disabled={statusPending || club.status === "ARCHIVED"}>Apply status</Button>
          </form>
          <div className="mt-3"><Result state={statusState} /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Membership</CardTitle><CardDescription>Invitations go to existing accounts. Adult consent and independent trust-admin approval are required before access.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          {club.status === "ACTIVE" && <form action={inviteAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="clubId" value={club.id} />
            <div className="min-w-60 flex-1"><Label htmlFor="invite-user">Invite account</Label><select id="invite-user" name="userId" className={selectClass} required><option value="">Select an account</option>{inviteCandidates.map((user) => <option key={user.id} value={user.id}>{user.name ?? user.email} ({user.email})</option>)}</select></div>
            <Button type="submit" disabled={invitePending || inviteCandidates.length === 0}>Invite</Button>
          </form>}
          <Result state={inviteState} />
          {members.length === 0 ? <p className="text-sm text-muted-foreground">No memberships yet.</p> : <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><caption className="sr-only">Club memberships</caption><thead className="bg-muted/50 text-left"><tr><th scope="col" className="px-4 py-3">Account</th><th scope="col" className="px-4 py-3">Role</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y">{members.map((member) => <tr key={member.id}>
            <td className="px-4 py-3"><span className="font-medium">{member.userName ?? member.userEmail}</span><span className="block text-xs text-muted-foreground">{member.userEmail}</span><details className="mt-2 text-xs"><summary className="cursor-pointer text-brand">Decision history</summary><ol className="mt-2 space-y-2">{member.history.map((event) => <li key={event.id}><span className="font-medium">{event.toStatus} · {event.toRole}</span><span className="block text-muted-foreground">{event.actor} · {new Date(event.createdAt).toLocaleString("en-IN")}</span>{event.reason && <span className="block">{event.reason}</span>}</li>)}</ol></details></td>
            <td className="px-4 py-3">{member.role}</td><td className="px-4 py-3"><Badge variant={member.status === "ACTIVE" ? "success" : "outline"}>{member.status}</Badge></td>
            <td className="px-4 py-3">
              {member.status === "REQUESTED" && <div className="grid gap-2"><form action={decisionAction} className="flex flex-wrap gap-2"><input type="hidden" name="clubId" value={club.id} /><input type="hidden" name="membershipId" value={member.id} /><input type="hidden" name="version" value={member.version} /><input type="hidden" name="decision" value="APPROVE" /><Button size="sm" disabled={decisionPending || club.status !== "ACTIVE" || !member.consentAt || !member.adultAttestedAt}>Approve</Button></form><form action={decisionAction} className="flex flex-wrap gap-2"><input type="hidden" name="clubId" value={club.id} /><input type="hidden" name="membershipId" value={member.id} /><input type="hidden" name="version" value={member.version} /><input type="hidden" name="decision" value="REJECT" /><Input name="reason" aria-label={`Reason to reject ${member.userEmail}`} placeholder="Reason" required maxLength={1000} className="max-w-40" /><Button size="sm" variant="outline" disabled={decisionPending}>Reject</Button></form></div>}
              {member.status === "ACTIVE" && <form action={membershipAction} className="flex flex-wrap gap-2"><input type="hidden" name="clubId" value={club.id} /><input type="hidden" name="membershipId" value={member.id} /><input type="hidden" name="version" value={member.version} /><Input name="reason" aria-label={`Reason to close ${member.userEmail}`} placeholder="Reason" required maxLength={1000} className="max-w-40" /><select name="target" aria-label="Membership action" className="rounded-lg border bg-background px-2 text-sm"><option value="SUSPENDED">Suspend</option><option value="ENDED">End</option></select><Button size="sm" variant="outline" disabled={membershipPending}>Apply</Button></form>}
            </td>
          </tr>)}</tbody></table></div>}
          <Result state={decisionState} /><Result state={membershipState} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Coordinator</CardTitle><CardDescription>Choose an approved member. One coordinator has operational access to this club only.</CardDescription></CardHeader>
        <CardContent><form action={coordinatorAction} className="flex flex-wrap items-end gap-3"><input type="hidden" name="clubId" value={club.id} /><input type="hidden" name="version" value={club.version} /><div className="min-w-60 flex-1"><Label htmlFor="coordinator">Approved member</Label><select id="coordinator" name="userId" className={selectClass} required><option value="">Select a member</option>{activeMembers.map((member) => <option key={member.id} value={member.userId}>{member.userName ?? member.userEmail}</option>)}</select></div><Button type="submit" disabled={coordinatorPending || activeMembers.length === 0 || club.status !== "ACTIVE"}>Appoint</Button></form><div className="mt-3"><Result state={coordinatorState} /></div></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Private documents</CardTitle><CardDescription>Dedicated club uploads remain private. Club coordinators can view active documents after approval.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <ClubDocumentUploader clubId={club.id} disabled={club.status === "SUSPENDED" || club.status === "ARCHIVED"} />
          {files.length === 0 ? <p className="text-sm text-muted-foreground">No private documents linked.</p> : <ul className="space-y-2">{files.map((file) => <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><p className="font-medium">{file.titleEn}</p><p className="text-xs text-muted-foreground">{file.filename}{file.archivedAt ? " · archived" : ""}</p></div><div className="flex gap-2">{!file.archivedAt && <Link href={`/api/club/documents/${file.id}/file`} target="_blank" className="text-sm text-brand underline">View</Link>}{!file.archivedAt && <form action={archiveAction}><input type="hidden" name="clubId" value={club.id} /><input type="hidden" name="documentId" value={file.id} /><Button type="submit" size="sm" variant="outline" disabled={archivePending}>Archive</Button></form>}</div></li>)}</ul>}
          <Result state={archiveState} />
        </CardContent>
      </Card>
    </div>
  );
}
