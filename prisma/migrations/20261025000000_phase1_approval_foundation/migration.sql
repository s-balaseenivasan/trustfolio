-- CreateEnum
CREATE TYPE "AccessGrantStatus" AS ENUM ('DRAFT', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "AccessScopeType" AS ENUM ('GLOBAL', 'CLUB', 'PROJECT');

-- CreateEnum
CREATE TYPE "ApprovalPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ApprovalInstanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecisionKind" AS ENUM ('APPROVE', 'REJECT', 'RETURN');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "PermissionEffect" AS ENUM ('READ', 'WRITE', 'APPROVE');

-- CreateTable
CREATE TABLE "AccessGroup" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "effect" "PermissionEffect" NOT NULL DEFAULT 'READ',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGroupPermission" (
    "groupId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessGroupPermission_pkey" PRIMARY KEY ("groupId","permissionId")
);

-- CreateTable
CREATE TABLE "AccessGroupMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "scopeType" "AccessScopeType" NOT NULL DEFAULT 'GLOBAL',
    "scopeId" TEXT NOT NULL DEFAULT '',
    "status" "AccessGrantStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessGroupMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "status" "ApprovalPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalInstance" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "amount" DECIMAL(30,8),
    "currency" TEXT,
    "scopeType" "AccessScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "status" "ApprovalInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" "ApprovalDecisionKind" NOT NULL,
    "reason" TEXT,
    "delegatedFromId" TEXT,
    "policyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDelegation" (
    "id" TEXT NOT NULL,
    "grantorId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "scopeType" "AccessScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AccessGrantStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "correlationId" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessGroup_key_key" ON "AccessGroup"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "AccessGroupPermission_permissionId_idx" ON "AccessGroupPermission"("permissionId");

-- CreateIndex
CREATE INDEX "AccessGroupMembership_userId_status_scopeType_scopeId_idx" ON "AccessGroupMembership"("userId", "status", "scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGroupMembership_userId_groupId_scopeType_scopeId_key" ON "AccessGroupMembership"("userId", "groupId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_subjectType_status_idx" ON "ApprovalPolicy"("subjectType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPolicy_key_version_key" ON "ApprovalPolicy"("key", "version");

-- CreateIndex
CREATE INDEX "ApprovalInstance_subjectType_subjectId_status_idx" ON "ApprovalInstance"("subjectType", "subjectId", "status");

-- CreateIndex
CREATE INDEX "ApprovalInstance_status_createdAt_idx" ON "ApprovalInstance"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalDecision_actorId_createdAt_idx" ON "ApprovalDecision"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_instanceId_stepIndex_actorId_key" ON "ApprovalDecision"("instanceId", "stepIndex", "actorId");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_recipientId_status_endsAt_idx" ON "ApprovalDelegation"("recipientId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectType_subjectId_createdAt_idx" ON "AuditEvent"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_dedupeKey_key" ON "NotificationOutbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_createdAt_idx" ON "NotificationOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_recipientId_createdAt_idx" ON "NotificationOutbox"("recipientId", "createdAt");

-- AddForeignKey
ALTER TABLE "AccessGroupPermission" ADD CONSTRAINT "AccessGroupPermission_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccessGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGroupPermission" ADD CONSTRAINT "AccessGroupPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGroupMembership" ADD CONSTRAINT "AccessGroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGroupMembership" ADD CONSTRAINT "AccessGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccessGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalInstance" ADD CONSTRAINT "ApprovalInstance_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalInstance" ADD CONSTRAINT "ApprovalInstance_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ApprovalInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_grantorId_fkey" FOREIGN KEY ("grantorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccessGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Proposed group catalog only. No memberships, permission grants, or active policies are created.
INSERT INTO "AccessGroup" ("id", "key", "name", "description", "updatedAt") VALUES
  ('group_trust_admin', 'TRUST_ADMIN', 'Trust Admin', 'System administration and governance configuration', CURRENT_TIMESTAMP),
  ('group_trustee_approver', 'TRUSTEE_APPROVER', 'Trustee Approver', 'Proposed trustee-level approvals', CURRENT_TIMESTAMP),
  ('group_finance_manager', 'FINANCE_MANAGER', 'Finance Manager', 'Proposed financial oversight and review', CURRENT_TIMESTAMP),
  ('group_finance_officer', 'FINANCE_OFFICER', 'Finance Officer', 'Proposed donation verification and processing', CURRENT_TIMESTAMP),
  ('group_project_manager', 'PROJECT_MANAGER', 'Project Manager', 'Proposed project and donation request initiation', CURRENT_TIMESTAMP),
  ('group_club_coordinator', 'CLUB_COORDINATOR', 'Club Coordinator', 'Proposed club operational verification', CURRENT_TIMESTAMP),
  ('group_content_approver', 'CONTENT_APPROVER', 'Content Approver', 'Proposed public release approval', CURRENT_TIMESTAMP),
  ('group_auditor', 'AUDITOR', 'Auditor', 'Read-only oversight; cannot approve transactions', CURRENT_TIMESTAMP);

-- Decision and audit history is append-only, including for direct SQL clients.
CREATE FUNCTION "rejectApprovalHistoryMutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ApprovalDecision_immutable" BEFORE UPDATE OR DELETE ON "ApprovalDecision"
  FOR EACH ROW EXECUTE FUNCTION "rejectApprovalHistoryMutation"();
CREATE TRIGGER "AuditEvent_immutable" BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "rejectApprovalHistoryMutation"();

CREATE FUNCTION "protectApprovalSnapshot"() RETURNS trigger AS $$
BEGIN
  IF NEW."policySnapshot" IS DISTINCT FROM OLD."policySnapshot"
     OR NEW."policyId" IS DISTINCT FROM OLD."policyId"
     OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion"
     OR NEW."makerId" IS DISTINCT FROM OLD."makerId"
     OR NEW."subjectType" IS DISTINCT FROM OLD."subjectType"
     OR NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."scopeType" IS DISTINCT FROM OLD."scopeType"
     OR NEW."scopeId" IS DISTINCT FROM OLD."scopeId" THEN
    RAISE EXCEPTION 'approval instance snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ApprovalInstance_snapshot_immutable" BEFORE UPDATE ON "ApprovalInstance"
  FOR EACH ROW EXECUTE FUNCTION "protectApprovalSnapshot"();

CREATE FUNCTION "protectApprovalPolicyVersion"() RETURNS trigger AS $$
BEGIN
  IF NEW."key" IS DISTINCT FROM OLD."key"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."name" IS DISTINCT FROM OLD."name"
     OR NEW."subjectType" IS DISTINCT FROM OLD."subjectType"
     OR NEW."definition" IS DISTINCT FROM OLD."definition"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById" THEN
    RAISE EXCEPTION 'approval policy versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ApprovalPolicy_version_immutable" BEFORE UPDATE ON "ApprovalPolicy"
  FOR EACH ROW EXECUTE FUNCTION "protectApprovalPolicyVersion"();

-- PostgreSQL constraints Prisma cannot express as partial indexes or cross-field checks.
CREATE UNIQUE INDEX "ApprovalInstance_one_pending_per_subject"
  ON "ApprovalInstance" ("subjectType", "subjectId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "ApprovalPolicy_one_active_version_per_key"
  ON "ApprovalPolicy" ("key") WHERE "status" = 'ACTIVE';
ALTER TABLE "AccessGroupMembership" ADD CONSTRAINT "AccessGroupMembership_scope_shape"
  CHECK (("scopeType" = 'GLOBAL' AND "scopeId" = '') OR ("scopeType" <> 'GLOBAL' AND "scopeId" <> ''));
ALTER TABLE "ApprovalInstance" ADD CONSTRAINT "ApprovalInstance_scope_shape"
  CHECK (("scopeType" = 'GLOBAL' AND "scopeId" = '') OR ("scopeType" <> 'GLOBAL' AND "scopeId" <> ''));
ALTER TABLE "ApprovalInstance" ADD CONSTRAINT "ApprovalInstance_amount_currency_pair"
  CHECK (("amount" IS NULL AND "currency" IS NULL) OR ("amount" IS NOT NULL AND "currency" ~ '^[A-Z]{3}$'));
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_valid_window"
  CHECK ("endsAt" > "startsAt");
