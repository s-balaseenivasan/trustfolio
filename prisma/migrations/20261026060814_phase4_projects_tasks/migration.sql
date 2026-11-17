-- CreateEnum
CREATE TYPE "ProjectOperationalStatus" AS ENUM ('DRAFT', 'PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectClubAssignmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "ProjectMilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ProjectTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectTaskEvidenceKind" AS ENUM ('ATTACHMENT', 'COMPLETION');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "beneficiaryPlan" TEXT,
ADD COLUMN     "budgetPlanningNote" TEXT,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "operationalEndDate" TIMESTAMP(3),
ADD COLUMN     "operationalStartDate" TIMESTAMP(3),
ADD COLUMN     "operationalStatus" "ProjectOperationalStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "operationalVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ownerId" TEXT;

-- CreateTable
CREATE TABLE "ProjectClubAssignment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "responsibilities" TEXT NOT NULL,
    "status" "ProjectClubAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "canViewTasks" BOOLEAN NOT NULL DEFAULT true,
    "canReportContribution" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectClubAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectClubAssignmentHistory" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" "ProjectClubAssignmentStatus",
    "toStatus" "ProjectClubAssignmentStatus" NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectClubAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectClubActivity" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectClubActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleTa" TEXT,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "ProjectMilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clubAssignmentId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "parentId" TEXT,
    "titleEn" TEXT NOT NULL,
    "titleTa" TEXT,
    "description" TEXT,
    "priority" "ProjectTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "ProjectTaskStatus" NOT NULL DEFAULT 'TODO',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTaskDependency" (
    "taskId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTaskDependency_pkey" PRIMARY KEY ("taskId","predecessorId")
);

-- CreateTable
CREATE TABLE "ProjectTaskHistory" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" "ProjectTaskStatus",
    "toStatus" "ProjectTaskStatus" NOT NULL,
    "fromProgress" INTEGER,
    "toProgress" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTaskHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTaskEvidence" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "kind" "ProjectTaskEvidenceKind" NOT NULL DEFAULT 'ATTACHMENT',
    "title" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectTaskEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectClubAssignment_clubId_status_idx" ON "ProjectClubAssignment"("clubId", "status");

-- CreateIndex
CREATE INDEX "ProjectClubAssignment_coordinatorId_status_idx" ON "ProjectClubAssignment"("coordinatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectClubAssignment_projectId_clubId_key" ON "ProjectClubAssignment"("projectId", "clubId");

-- CreateIndex
CREATE INDEX "ProjectClubAssignmentHistory_assignmentId_createdAt_idx" ON "ProjectClubAssignmentHistory"("assignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectClubActivity_assignmentId_occurredAt_idx" ON "ProjectClubActivity"("assignmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectMilestone_projectId_status_dueDate_idx" ON "ProjectMilestone"("projectId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "ProjectTask_projectId_status_dueDate_idx" ON "ProjectTask"("projectId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "ProjectTask_clubAssignmentId_status_dueDate_idx" ON "ProjectTask"("clubAssignmentId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "ProjectTask_parentId_idx" ON "ProjectTask"("parentId");

-- CreateIndex
CREATE INDEX "TaskAssignment_profileId_active_idx" ON "TaskAssignment"("profileId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_taskId_profileId_key" ON "TaskAssignment"("taskId", "profileId");

-- CreateIndex
CREATE INDEX "ProjectTaskDependency_predecessorId_idx" ON "ProjectTaskDependency"("predecessorId");

-- CreateIndex
CREATE INDEX "ProjectTaskHistory_taskId_createdAt_idx" ON "ProjectTaskHistory"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectTaskEvidence_taskId_createdAt_idx" ON "ProjectTaskEvidence"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTaskEvidence_taskId_mediaId_key" ON "ProjectTaskEvidence"("taskId", "mediaId");

-- CreateIndex
CREATE INDEX "Project_operationalStatus_managerId_idx" ON "Project"("operationalStatus", "managerId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectClubAssignment" ADD CONSTRAINT "ProjectClubAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectClubAssignment" ADD CONSTRAINT "ProjectClubAssignment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectClubAssignment" ADD CONSTRAINT "ProjectClubAssignment_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectClubAssignment" ADD CONSTRAINT "ProjectClubAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectClubAssignmentHistory" ADD CONSTRAINT "ProjectClubAssignmentHistory_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ProjectClubAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectClubAssignmentHistory" ADD CONSTRAINT "ProjectClubAssignmentHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectClubActivity" ADD CONSTRAINT "ProjectClubActivity_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ProjectClubAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectClubActivity" ADD CONSTRAINT "ProjectClubActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_clubAssignmentId_fkey" FOREIGN KEY ("clubAssignmentId") REFERENCES "ProjectClubAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "ProjectMilestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "VolunteerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskDependency" ADD CONSTRAINT "ProjectTaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskDependency" ADD CONSTRAINT "ProjectTaskDependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskHistory" ADD CONSTRAINT "ProjectTaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskHistory" ADD CONSTRAINT "ProjectTaskHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskEvidence" ADD CONSTRAINT "ProjectTaskEvidence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskEvidence" ADD CONSTRAINT "ProjectTaskEvidence_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskEvidence" ADD CONSTRAINT "ProjectTaskEvidence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Project" ADD CONSTRAINT "Project_operational_schedule" CHECK ("operationalStartDate" IS NULL OR "operationalEndDate" IS NULL OR "operationalEndDate" >= "operationalStartDate");
ALTER TABLE "ProjectClubAssignment" ADD CONSTRAINT "ProjectClubAssignment_ended_state" CHECK ("status" <> 'ENDED' OR "endedAt" IS NOT NULL);
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_progress_range" CHECK ("progressPercent" BETWEEN 0 AND 100);
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_finished_progress" CHECK ("status" NOT IN ('SUBMITTED', 'APPROVED') OR "progressPercent" = 100);
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_approved_time" CHECK ("status" <> 'APPROVED' OR "completedAt" IS NOT NULL);
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_schedule" CHECK ("startDate" IS NULL OR "dueDate" IS NULL OR "dueDate" >= "startDate");
ALTER TABLE "ProjectTaskDependency" ADD CONSTRAINT "ProjectTaskDependency_no_self" CHECK ("taskId" <> "predecessorId");
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_end_state" CHECK (("active" AND "endedAt" IS NULL) OR (NOT "active" AND "endedAt" IS NOT NULL));
CREATE TRIGGER "ProjectClubAssignmentHistory_immutable" BEFORE UPDATE OR DELETE ON "ProjectClubAssignmentHistory" FOR EACH ROW EXECUTE FUNCTION "rejectApprovalHistoryMutation"();
CREATE TRIGGER "ProjectClubActivity_immutable" BEFORE UPDATE OR DELETE ON "ProjectClubActivity" FOR EACH ROW EXECUTE FUNCTION "rejectApprovalHistoryMutation"();
CREATE TRIGGER "ProjectTaskHistory_immutable" BEFORE UPDATE OR DELETE ON "ProjectTaskHistory" FOR EACH ROW EXECUTE FUNCTION "rejectApprovalHistoryMutation"();
