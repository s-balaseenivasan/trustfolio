-- CreateEnum
CREATE TYPE "ClubStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClubMembershipStatus" AS ENUM ('DRAFT', 'INVITED', 'REQUESTED', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "ClubMembershipRole" AS ENUM ('MEMBER', 'COORDINATOR');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PORTAL_USER';

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameTa" TEXT,
    "summaryEn" TEXT,
    "summaryTa" TEXT,
    "descriptionEn" TEXT,
    "descriptionTa" TEXT,
    "status" "ClubStatus" NOT NULL DEFAULT 'DRAFT',
    "publicationStatus" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "coordinatorId" TEXT,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubMembership" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ClubMembershipRole" NOT NULL DEFAULT 'MEMBER',
    "status" "ClubMembershipStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "consentAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "adultAttestedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubMembershipHistory" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" "ClubMembershipStatus",
    "toStatus" "ClubMembershipStatus" NOT NULL,
    "fromRole" "ClubMembershipRole",
    "toRole" "ClubMembershipRole" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubMembershipHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubDocument" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleTa" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ClubDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Club_code_key" ON "Club"("code");

-- CreateIndex
CREATE INDEX "Club_status_updatedAt_idx" ON "Club"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Club_coordinatorId_status_idx" ON "Club"("coordinatorId", "status");

-- CreateIndex
CREATE INDEX "ClubMembership_userId_status_idx" ON "ClubMembership"("userId", "status");

-- CreateIndex
CREATE INDEX "ClubMembership_clubId_status_role_idx" ON "ClubMembership"("clubId", "status", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ClubMembership_clubId_userId_key" ON "ClubMembership"("clubId", "userId");

-- CreateIndex
CREATE INDEX "ClubMembershipHistory_membershipId_createdAt_idx" ON "ClubMembershipHistory"("membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "ClubDocument_clubId_createdAt_idx" ON "ClubDocument"("clubId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClubDocument_clubId_mediaId_key" ON "ClubDocument"("clubId", "mediaId");

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMembership" ADD CONSTRAINT "ClubMembership_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMembership" ADD CONSTRAINT "ClubMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMembershipHistory" ADD CONSTRAINT "ClubMembershipHistory_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "ClubMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMembershipHistory" ADD CONSTRAINT "ClubMembershipHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubDocument" ADD CONSTRAINT "ClubDocument_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubDocument" ADD CONSTRAINT "ClubDocument_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubDocument" ADD CONSTRAINT "ClubDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An active membership always has recorded adult and data-use attestations.
ALTER TABLE "ClubMembership" ADD CONSTRAINT "ClubMembership_active_consent"
  CHECK ("status" <> 'ACTIVE' OR ("consentAt" IS NOT NULL AND "adultAttestedAt" IS NOT NULL AND "consentVersion" IS NOT NULL AND "joinedAt" IS NOT NULL));

-- Membership decision history remains immutable even for direct SQL clients.
CREATE TRIGGER "ClubMembershipHistory_immutable" BEFORE UPDATE OR DELETE ON "ClubMembershipHistory"
  FOR EACH ROW EXECUTE FUNCTION "rejectApprovalHistoryMutation"();
