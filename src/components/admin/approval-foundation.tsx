"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/lib/action-state";
import { SUBJECT_TYPES } from "@/lib/approval/definition";
import {
  addApprovalGroup,
  addApprovalPermission,
  addDraftDelegation,
  addDraftPolicy,
  configureGroupPermissions,
  editApprovalGroup,
  editApprovalPermission,
  simulateApprovalPolicy,
} from "@/server/actions/admin/approvals";

type Group = { id: string; key: string; name: string; description: string | null; permissionIds: string[]; memberCount: number };
type PermissionItem = { id: string; key: string; description: string; effect: "READ" | "WRITE" | "APPROVE" };
type Policy = { id: string; key: string; name: string; subjectType: string; version: number; status: string; createdAt: string };
type AuditItem = { id: string; eventType: string; subjectType: string; subjectId: string | null; createdAt: string };
type InboxItem = { id: string; templateKey: string; status: string; createdAt: string };
type InstanceItem = { id: string; subjectType: string; subjectId: string; status: string; createdAt: string; decisions: { actorId: string; kind: string; reason: string | null; policyVersion: number; createdAt: string }[] };
type UserItem = { id: string; email: string; name: string | null };
type DelegationItem = { id: string; groupId: string; grantorId: string; recipientId: string; status: string; startsAt: string; endsAt: string };
type Step = { mode: "ANY" | "ALL"; groupKeys: string[] };
const idle: ActionState = { status: "idle" };
const fieldClass = "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";

function Result({ state }: { state: ActionState }) {
  if (state.status === "idle") return null;
  return <p role="status" className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-emerald-700 dark:text-emerald-300"}>{state.message}</p>;
}

function CatalogForms() {
  const [groupState, groupAction, groupPending] = useActionState(addApprovalGroup, idle);
  const [permissionState, permissionAction, permissionPending] = useActionState(addApprovalPermission, idle);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Add draft group</CardTitle><CardDescription>Creating a group grants no user authority.</CardDescription></CardHeader>
        <CardContent>
          <form action={groupAction} className="space-y-4">
            <div><Label htmlFor="group-key">Key</Label><Input id="group-key" name="key" required maxLength={64} placeholder="REGIONAL_REVIEWER" /></div>
            <div><Label htmlFor="group-name">Name</Label><Input id="group-name" name="name" required maxLength={100} /></div>
            <div><Label htmlFor="group-description">Description</Label><Input id="group-description" name="description" maxLength={500} /></div>
            <Result state={groupState} />
            <Button type="submit" disabled={groupPending}>Add group</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Add permission</CardTitle><CardDescription>Permissions are inert until an approved active grant exists.</CardDescription></CardHeader>
        <CardContent>
          <form action={permissionAction} className="space-y-4">
            <div><Label htmlFor="permission-key">Key</Label><Input id="permission-key" name="key" required maxLength={64} placeholder="EXPENSE_REVIEW" /></div>
            <div><Label htmlFor="permission-description">Description</Label><Input id="permission-description" name="description" required maxLength={300} /></div>
            <div><Label htmlFor="permission-effect">Effect</Label><select id="permission-effect" name="effect" className={fieldClass}><option value="READ">Read</option><option value="WRITE">Write</option><option value="APPROVE">Approve</option></select></div>
            <Result state={permissionState} />
            <Button type="submit" disabled={permissionPending}>Add permission</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function CatalogEditors({ groups, permissions }: { groups: Group[]; permissions: PermissionItem[] }) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [permissionId, setPermissionId] = useState(permissions[0]?.id ?? "");
  const [groupState, groupAction, groupPending] = useActionState(editApprovalGroup, idle);
  const [permissionState, permissionAction, permissionPending] = useActionState(editApprovalPermission, idle);
  const group = groups.find((item) => item.id === groupId);
  const permission = permissions.find((item) => item.id === permissionId);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Edit group details</CardTitle><CardDescription>Group keys and memberships are not changed here.</CardDescription></CardHeader>
        <CardContent>
          {group ? <form action={groupAction} className="space-y-4">
            <div><Label htmlFor="edit-group">Group</Label><select id="edit-group" name="groupId" value={groupId} onChange={(event) => setGroupId(event.target.value)} className={fieldClass}>{groups.map((item) => <option key={item.id} value={item.id}>{item.key}</option>)}</select></div>
            <div key={groupId} className="space-y-4">
              <div><Label htmlFor="edit-group-name">Name</Label><Input id="edit-group-name" name="name" defaultValue={group.name} required maxLength={100} /></div>
              <div><Label htmlFor="edit-group-description">Description</Label><Input id="edit-group-description" name="description" defaultValue={group.description ?? ""} maxLength={500} /></div>
            </div>
            <Result state={groupState} /><Button type="submit" variant="outline" disabled={groupPending}>Save group details</Button>
          </form> : <p className="text-sm text-muted-foreground">No groups available.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Edit permission details</CardTitle><CardDescription>Active grants lock permission changes; auditors remain read-only.</CardDescription></CardHeader>
        <CardContent>
          {permission ? <form action={permissionAction} className="space-y-4">
            <div><Label htmlFor="edit-permission">Permission</Label><select id="edit-permission" name="permissionId" value={permissionId} onChange={(event) => setPermissionId(event.target.value)} className={fieldClass}>{permissions.map((item) => <option key={item.id} value={item.id}>{item.key}</option>)}</select></div>
            <div key={permissionId} className="space-y-4">
              <div><Label htmlFor="edit-permission-description">Description</Label><Input id="edit-permission-description" name="description" defaultValue={permission.description} required maxLength={300} /></div>
              <div><Label htmlFor="edit-permission-effect">Effect</Label><select id="edit-permission-effect" name="effect" defaultValue={permission.effect} className={fieldClass}><option value="READ">Read</option><option value="WRITE">Write</option><option value="APPROVE">Approve</option></select></div>
            </div>
            <Result state={permissionState} /><Button type="submit" variant="outline" disabled={permissionPending}>Save permission details</Button>
          </form> : <p className="text-sm text-muted-foreground">No permissions available.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function GroupPermissions({ groups, permissions }: { groups: Group[]; permissions: PermissionItem[] }) {
  const [selectedId, setSelectedId] = useState(groups[0]?.id ?? "");
  const [state, action, pending] = useActionState(configureGroupPermissions, idle);
  const selected = groups.find((group) => group.id === selectedId);
  return (
    <Card>
      <CardHeader><CardTitle>Permission configuration</CardTitle><CardDescription>Group memberships remain unassigned. An active group is locked against draft permission edits.</CardDescription></CardHeader>
      <CardContent>
        {groups.length === 0 ? <p className="text-sm text-muted-foreground">Add a group to configure permissions.</p> : (
          <form action={action} className="space-y-4">
            <div><Label htmlFor="permission-group">Group</Label>
              <select id="permission-group" name="groupId" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className={fieldClass}>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.key})</option>)}
              </select>
            </div>
            <div key={selectedId} className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Permissions">
              {permissions.length === 0 ? <p className="text-sm text-muted-foreground">No permissions configured yet.</p> : permissions.map((permission) => (
                <label key={permission.id} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                  <input type="checkbox" name="permissionIds" value={permission.id} disabled={selected?.key === "AUDITOR" && permission.effect !== "READ"} defaultChecked={selected?.permissionIds.includes(permission.id)} className="mt-1" />
                  <span><span className="block font-medium">{permission.key} · {permission.effect}</span><span className="text-muted-foreground">{permission.description}</span></span>
                </label>
              ))}
            </div>
            <Result state={state} />
            <Button type="submit" disabled={pending || !selected || selected.memberCount > 0}>Save draft permissions</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function PolicyBuilder({ groups }: { groups: Group[] }) {
  const [state, action, pending] = useActionState(addDraftPolicy, idle);
  const [steps, setSteps] = useState<Step[]>([{ mode: "ANY", groupKeys: [] }]);
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [projectId, setProjectId] = useState("");
  const [delegationAllowed, setDelegationAllowed] = useState(false);
  const updateStep = (index: number, next: Step) => setSteps((current) => current.map((item, at) => at === index ? next : item));
  const definition = {
    conditions: { minAmount: minAmount || null, maxAmount: maxAmount || null, currency: currency || null, projectId: projectId || null },
    steps,
    noSelfApproval: true,
    delegationAllowed,
  };
  return (
    <Card>
      <CardHeader><CardTitle>Policy builder</CardTitle><CardDescription>Save a new draft version. Sequential steps run in order; ANY or ALL applies within each step. Activation is disabled.</CardDescription></CardHeader>
      <CardContent>
        <form action={action} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div><Label htmlFor="policy-key">Policy key</Label><Input id="policy-key" name="key" required placeholder="EXPENSE_APPROVAL" maxLength={64} /></div>
            <div><Label htmlFor="policy-name">Name</Label><Input id="policy-name" name="name" required maxLength={120} /></div>
            <div><Label htmlFor="policy-subject">Operation</Label>
              <select id="policy-subject" name="subjectType" className={fieldClass}>{SUBJECT_TYPES.map((subject) => <option key={subject} value={subject}>{subject.replaceAll("_", " ")}</option>)}</select>
            </div>
          </div>
          <fieldset className="rounded-xl border p-4">
            <legend className="px-1 text-sm font-semibold">Optional conditions</legend>
            <div className="grid gap-4 sm:grid-cols-4">
              <div><Label htmlFor="min-amount">Minimum amount</Label><Input id="min-amount" inputMode="decimal" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="0.00" /></div>
              <div><Label htmlFor="max-amount">Maximum amount</Label><Input id="max-amount" inputMode="decimal" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="No maximum" /></div>
              <div><Label htmlFor="currency">Currency</Label><Input id="currency" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} placeholder="INR" /></div>
              <div><Label htmlFor="project-id">Project ID</Label><Input id="project-id" value={projectId} onChange={(event) => setProjectId(event.target.value)} maxLength={64} placeholder="All projects" /></div>
            </div>
          </fieldset>
          <div className="space-y-3">
            {steps.map((step, index) => (
              <fieldset key={index} className="rounded-xl border p-4">
                <legend className="px-1 text-sm font-semibold">Step {index + 1}</legend>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><Label htmlFor={`step-mode-${index}`}>Approval mode</Label>
                    <select id={`step-mode-${index}`} className={fieldClass} value={step.mode} onChange={(event) => updateStep(index, { ...step, mode: event.target.value as Step["mode"] })}>
                      <option value="ANY">Any one eligible actor</option><option value="ALL">All eligible actors</option>
                    </select>
                  </div>
                  {steps.length > 1 && <Button type="button" variant="outline" size="sm" onClick={() => setSteps((current) => current.filter((_, at) => at !== index))}>Remove step</Button>}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label={`Groups for step ${index + 1}`}>
                  {groups.map((group) => (
                    <label key={group.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" disabled={group.key === "AUDITOR"} checked={step.groupKeys.includes(group.key)} onChange={(event) => updateStep(index, { ...step, groupKeys: event.target.checked ? [...step.groupKeys, group.key] : step.groupKeys.filter((key) => key !== group.key) })} />
                      {group.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <Button type="button" variant="outline" size="sm" disabled={steps.length >= 10} onClick={() => setSteps((current) => [...current, { mode: "ANY", groupKeys: [] }])}>Add sequential step</Button>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={delegationAllowed} onChange={(event) => setDelegationAllowed(event.target.checked)} className="mt-1" /><span>Model delegation in this draft. Actual delegation remains disabled pending authorization.</span></label>
          <input type="hidden" name="definition" value={JSON.stringify(definition)} />
          <Result state={state} />
          <Button type="submit" disabled={pending || groups.length === 0}>Save draft policy version</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DelegationDrafts({ groups, users, delegations }: { groups: Group[]; users: UserItem[]; delegations: DelegationItem[] }) {
  const [state, action, pending] = useActionState(addDraftDelegation, idle);
  const [scopeType, setScopeType] = useState<"GLOBAL" | "CLUB" | "PROJECT">("GLOBAL");
  const userLabel = (id: string) => users.find((user) => user.id === id)?.name ?? users.find((user) => user.id === id)?.email ?? id;
  return (
    <Card>
      <CardHeader><CardTitle>Delegation framework</CardTitle><CardDescription>Draft a proposed scope and time window. Delegation cannot be activated or used in Phase 1.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {users.length < 2 || groups.length === 0 ? <p className="text-sm text-muted-foreground">At least two users and one group are needed to draft a delegation.</p> : (
          <form action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><Label htmlFor="delegation-from">Grantor</Label><select id="delegation-from" name="grantorId" className={fieldClass}>{users.map((user) => <option key={user.id} value={user.id}>{user.name ?? user.email}</option>)}</select></div>
            <div><Label htmlFor="delegation-to">Recipient</Label><select id="delegation-to" name="recipientId" className={fieldClass}>{users.map((user) => <option key={user.id} value={user.id}>{user.name ?? user.email}</option>)}</select></div>
            <div><Label htmlFor="delegation-group">Group</Label><select id="delegation-group" name="groupId" className={fieldClass}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div>
            <div><Label htmlFor="delegation-scope">Scope</Label><select id="delegation-scope" name="scopeType" value={scopeType} onChange={(event) => setScopeType(event.target.value as typeof scopeType)} className={fieldClass}><option value="GLOBAL">Global</option><option value="CLUB">Club</option><option value="PROJECT">Project</option></select></div>
            <div><Label htmlFor="delegation-scope-id">Scope ID</Label><Input id="delegation-scope-id" name="scopeId" disabled={scopeType === "GLOBAL"} defaultValue="" placeholder={scopeType === "GLOBAL" ? "Not needed" : "Required"} required={scopeType !== "GLOBAL"} /></div>
            <div><Label htmlFor="delegation-start">Starts</Label><Input id="delegation-start" name="startsAt" type="datetime-local" required /></div>
            <div><Label htmlFor="delegation-end">Ends</Label><Input id="delegation-end" name="endsAt" type="datetime-local" required /></div>
            <div className="self-end"><Button type="submit" disabled={pending}>Save delegation draft</Button></div>
            <div className="sm:col-span-2 lg:col-span-3"><Result state={state} /></div>
          </form>
        )}
        <div className="space-y-2">
          {delegations.length === 0 ? <p className="text-sm text-muted-foreground">No delegation drafts.</p> : delegations.map((item) => <p key={item.id} className="rounded-lg border p-3 text-sm">{userLabel(item.grantorId)} → {userLabel(item.recipientId)} · {groups.find((group) => group.id === item.groupId)?.key ?? "Group"} · {item.status} · {new Date(item.startsAt).toLocaleString()} to {new Date(item.endsAt).toLocaleString()}</p>)}
        </div>
      </CardContent>
    </Card>
  );
}

function SimulationForm({ policy }: { policy: Policy }) {
  const [state, action, pending] = useActionState(simulateApprovalPolicy, idle);
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="policyId" value={policy.id} /><input type="hidden" name="subjectType" value={policy.subjectType} />
      <div><Label htmlFor={`amount-${policy.id}`}>Amount</Label><Input id={`amount-${policy.id}`} name="amount" inputMode="decimal" className="w-32" placeholder="Optional" /></div>
      <div><Label htmlFor={`currency-${policy.id}`}>Currency</Label><Input id={`currency-${policy.id}`} name="currency" className="w-24" maxLength={3} placeholder="Optional" /></div>
      <div><Label htmlFor={`project-${policy.id}`}>Project ID</Label><Input id={`project-${policy.id}`} name="projectId" className="w-40" placeholder="Optional" /></div>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>Simulate</Button>
      <div className="w-full"><Result state={state} /></div>
    </form>
  );
}

export function ApprovalFoundation({ groups, permissions, policies, auditCount, history, inbox, instances, users, delegations }: { groups: Group[]; permissions: PermissionItem[]; policies: Policy[]; auditCount: number; history: AuditItem[]; inbox: InboxItem[]; instances: InstanceItem[]; users: UserItem[]; delegations: DelegationItem[] }) {
  return (
    <div className="space-y-6">
      <div role="status" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm">
        <p className="font-semibold">Draft engine only</p>
        <p className="mt-1 text-muted-foreground">No approval group has been assigned to a user. No policy can be activated, no delegation can be used, and protected operations fail closed. Existing content publication is unchanged.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardDescription>Proposed groups</CardDescription><CardTitle>{groups.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Draft policy versions</CardDescription><CardTitle>{policies.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Framework audit events</CardDescription><CardTitle>{auditCount}</CardTitle></CardHeader></Card>
      </div>
      <CatalogForms />
      <CatalogEditors groups={groups} permissions={permissions} />
      <GroupPermissions groups={groups} permissions={permissions} />
      <PolicyBuilder groups={groups} />
      <DelegationDrafts groups={groups} users={users} delegations={delegations} />
      <Card>
        <CardHeader><CardTitle>Policy versions and simulation</CardTitle><CardDescription>Simulation reads a draft and records no approval decision.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {policies.length === 0 ? <p className="text-sm text-muted-foreground">No policy drafts yet. Create one above to simulate its conditions.</p> : policies.map((policy) => (
            <div key={policy.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{policy.name}</span><Badge variant="secondary">{policy.key} v{policy.version}</Badge><Badge variant="outline">{policy.status}</Badge></div>
              <p className="mt-1 text-xs text-muted-foreground">{policy.subjectType.replaceAll("_", " ")} · Created {new Date(policy.createdAt).toLocaleDateString()}</p>
              <SimulationForm policy={policy} />
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Approval history</CardTitle><CardDescription>Live approval execution is disabled, so no decisions are expected yet.</CardDescription></CardHeader><CardContent className="space-y-3">
          {instances.length === 0 ? <p className="text-sm text-muted-foreground">No approval instances.</p> : instances.map((instance) => <div key={instance.id} className="rounded-lg border p-3 text-sm"><p className="font-medium">{instance.subjectType} · {instance.status}</p><p className="text-muted-foreground">{instance.subjectId} · {instance.decisions.length} decisions</p>{instance.decisions.map((decision) => <p key={`${decision.actorId}-${decision.createdAt}`} className="mt-1 text-xs">{decision.kind} · policy v{decision.policyVersion} · {new Date(decision.createdAt).toLocaleString()}{decision.reason ? ` · ${decision.reason}` : ""}</p>)}</div>)}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Notifications</CardTitle><CardDescription>Outbox records are retained independently of workflow state.</CardDescription></CardHeader><CardContent className="space-y-2">
          {inbox.length === 0 ? <p className="text-sm text-muted-foreground">No approval notifications.</p> : inbox.map((item) => <p key={item.id} className="rounded-lg border p-3 text-sm">{item.templateKey} · {item.status} · {new Date(item.createdAt).toLocaleString()}</p>)}
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Framework audit</CardTitle><CardDescription>Recent immutable configuration and decision events.</CardDescription></CardHeader><CardContent className="space-y-2">
        {history.length === 0 ? <p className="text-sm text-muted-foreground">No framework audit events.</p> : history.map((event) => <p key={event.id} className="rounded-lg border p-3 text-sm"><span className="font-medium">{event.eventType}</span> · {event.subjectType}{event.subjectId ? ` ${event.subjectId}` : ""} · {new Date(event.createdAt).toLocaleString()}</p>)}
      </CardContent></Card>
    </div>
  );
}
