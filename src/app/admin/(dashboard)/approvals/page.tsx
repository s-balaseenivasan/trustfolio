import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { ApprovalFoundation } from "@/components/admin/approval-foundation";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/server/auth-guard";

export const metadata: Metadata = { title: "Approval framework" };

export default async function ApprovalsPage() {
  const actor = await requireAdminPage("ADMIN");
  const [groups, permissions, policies, auditCount, history, inbox, instances, users, delegations] = await Promise.all([
    db.accessGroup.findMany({
      orderBy: { key: "asc" },
      include: { permissions: { select: { permissionId: true } }, _count: { select: { memberships: true } } },
    }),
    db.permission.findMany({ orderBy: { key: "asc" } }),
    db.approvalPolicy.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }], take: 100, select: { id: true, key: true, name: true, subjectType: true, version: true, status: true, createdAt: true } }),
    db.auditEvent.count(),
    db.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 25, select: { id: true, eventType: true, subjectType: true, subjectId: true, createdAt: true } }),
    db.notificationOutbox.findMany({ where: { recipientId: actor.id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, templateKey: true, status: true, createdAt: true } }),
    db.approvalInstance.findMany({ orderBy: { createdAt: "desc" }, take: 25, select: { id: true, subjectType: true, subjectId: true, status: true, createdAt: true, decisions: { select: { actorId: true, kind: true, reason: true, policyVersion: true, createdAt: true } } } }),
    db.user.findMany({ orderBy: { email: "asc" }, select: { id: true, email: true, name: true } }),
    db.approvalDelegation.findMany({ orderBy: { createdAt: "desc" }, take: 25, select: { id: true, groupId: true, grantorId: true, recipientId: true, status: true, startsAt: true, endsAt: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Approval framework"
        description="Configure and simulate draft groups and policies. Live approvals, delegation and authority assignments are disabled."
      />
      <ApprovalFoundation
        groups={groups.map((group) => ({ id: group.id, key: group.key, name: group.name, description: group.description, permissionIds: group.permissions.map((item) => item.permissionId), memberCount: group._count.memberships }))}
        permissions={permissions.map((permission) => ({ id: permission.id, key: permission.key, description: permission.description, effect: permission.effect }))}
        policies={policies.map((policy) => ({ ...policy, createdAt: policy.createdAt.toISOString() }))}
        auditCount={auditCount}
        history={history.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() }))}
        inbox={inbox.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))}
        instances={instances.map((instance) => ({ ...instance, createdAt: instance.createdAt.toISOString(), decisions: instance.decisions.map((decision) => ({ ...decision, createdAt: decision.createdAt.toISOString() })) }))}
        users={users}
        delegations={delegations.map((delegation) => ({ ...delegation, startsAt: delegation.startsAt.toISOString(), endsAt: delegation.endsAt.toISOString() }))}
      />
    </>
  );
}
