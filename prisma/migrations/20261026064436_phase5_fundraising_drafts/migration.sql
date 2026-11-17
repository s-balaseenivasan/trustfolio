-- CreateEnum
CREATE TYPE "DonationRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'REJECTED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DonationCampaignStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'PAUSED', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "DonationRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "purposeEn" TEXT NOT NULL,
    "purposeTa" TEXT,
    "justificationEn" TEXT NOT NULL,
    "justificationTa" TEXT,
    "targetPaise" BIGINT NOT NULL,
    "neededBy" TIMESTAMP(3),
    "status" "DonationRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "approvalInstanceId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonationRequestHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" "DonationRequestStatus",
    "toStatus" "DonationRequestStatus" NOT NULL,
    "fromVersion" INTEGER,
    "toVersion" INTEGER NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DonationRequestHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonationRequestEvidence" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "DonationRequestEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonationCampaign" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleTa" TEXT,
    "summaryEn" TEXT NOT NULL,
    "summaryTa" TEXT,
    "storyEn" TEXT,
    "storyTa" TEXT,
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "status" "DonationCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "publicationStatus" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "releaseApprovalInstanceId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonationCampaignHistory" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" "DonationCampaignStatus",
    "toStatus" "DonationCampaignStatus" NOT NULL,
    "fromVersion" INTEGER,
    "toVersion" INTEGER NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DonationCampaignHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DonationRequest_approvalInstanceId_key" ON "DonationRequest"("approvalInstanceId");

-- CreateIndex
CREATE INDEX "DonationRequest_projectId_status_createdAt_idx" ON "DonationRequest"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DonationRequest_status_neededBy_idx" ON "DonationRequest"("status", "neededBy");

-- CreateIndex
CREATE INDEX "DonationRequestHistory_requestId_createdAt_idx" ON "DonationRequestHistory"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DonationRequestEvidence_mediaId_key" ON "DonationRequestEvidence"("mediaId");

-- CreateIndex
CREATE INDEX "DonationRequestEvidence_requestId_createdAt_idx" ON "DonationRequestEvidence"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DonationCampaign_requestId_key" ON "DonationCampaign"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "DonationCampaign_slug_key" ON "DonationCampaign"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "DonationCampaign_releaseApprovalInstanceId_key" ON "DonationCampaign"("releaseApprovalInstanceId");

-- CreateIndex
CREATE INDEX "DonationCampaign_status_publicationStatus_startsOn_idx" ON "DonationCampaign"("status", "publicationStatus", "startsOn");

-- CreateIndex
CREATE INDEX "DonationCampaignHistory_campaignId_createdAt_idx" ON "DonationCampaignHistory"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "DonationRequest" ADD CONSTRAINT "DonationRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationRequest" ADD CONSTRAINT "DonationRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationRequest" ADD CONSTRAINT "DonationRequest_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "ApprovalInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationRequestHistory" ADD CONSTRAINT "DonationRequestHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DonationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationRequestHistory" ADD CONSTRAINT "DonationRequestHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationRequestEvidence" ADD CONSTRAINT "DonationRequestEvidence_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DonationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationRequestEvidence" ADD CONSTRAINT "DonationRequestEvidence_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationRequestEvidence" ADD CONSTRAINT "DonationRequestEvidence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationCampaign" ADD CONSTRAINT "DonationCampaign_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DonationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationCampaign" ADD CONSTRAINT "DonationCampaign_releaseApprovalInstanceId_fkey" FOREIGN KEY ("releaseApprovalInstanceId") REFERENCES "ApprovalInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationCampaign" ADD CONSTRAINT "DonationCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationCampaignHistory" ADD CONSTRAINT "DonationCampaignHistory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "DonationCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationCampaignHistory" ADD CONSTRAINT "DonationCampaignHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 5 is explicitly private-draft-only. A future approved policy activation
-- needs a reviewed migration that opens these states and wires approval snapshots.
ALTER TABLE "DonationRequest" ADD CONSTRAINT "DonationRequest_positive_target" CHECK ("targetPaise" > 0);
ALTER TABLE "DonationRequest" ADD CONSTRAINT "DonationRequest_draft_gate" CHECK ("status" = 'DRAFT' AND "approvalInstanceId" IS NULL AND "submittedAt" IS NULL AND "decidedAt" IS NULL);
ALTER TABLE "DonationRequest" ADD CONSTRAINT "DonationRequest_version_nonnegative" CHECK ("version" >= 0);
ALTER TABLE "DonationCampaign" ADD CONSTRAINT "DonationCampaign_private_draft_gate" CHECK ("status" = 'DRAFT' AND "publicationStatus" = 'DRAFT' AND "publishedAt" IS NULL AND "releaseApprovalInstanceId" IS NULL);
ALTER TABLE "DonationCampaign" ADD CONSTRAINT "DonationCampaign_schedule" CHECK ("startsOn" IS NULL OR "endsOn" IS NULL OR "endsOn" >= "startsOn");
ALTER TABLE "DonationCampaign" ADD CONSTRAINT "DonationCampaign_version_nonnegative" CHECK ("version" >= 0);
ALTER TABLE "DonationRequestHistory" ADD CONSTRAINT "DonationRequestHistory_version_order" CHECK (("fromVersion" IS NULL AND "toVersion" = 0) OR ("fromVersion" IS NOT NULL AND "toVersion" = "fromVersion" + 1));
ALTER TABLE "DonationCampaignHistory" ADD CONSTRAINT "DonationCampaignHistory_version_order" CHECK (("fromVersion" IS NULL AND "toVersion" = 0) OR ("fromVersion" IS NOT NULL AND "toVersion" = "fromVersion" + 1));
CREATE TRIGGER "DonationRequestHistory_immutable" BEFORE UPDATE OR DELETE ON "DonationRequestHistory" FOR EACH ROW EXECUTE FUNCTION "rejectApprovalHistoryMutation"();
CREATE TRIGGER "DonationCampaignHistory_immutable" BEFORE UPDATE OR DELETE ON "DonationCampaignHistory" FOR EACH ROW EXECUTE FUNCTION "rejectApprovalHistoryMutation"();
