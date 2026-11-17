-- CreateEnum
CREATE TYPE "VolunteerReviewStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'VOIDED');

-- CreateTable
CREATE TABLE "VolunteerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "about" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shareSkillsWithClubs" BOOLEAN NOT NULL DEFAULT false,
    "consentVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "adultAttestedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerAvailability" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "timeZone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerAttendance" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "activityTitle" TEXT NOT NULL,
    "status" "VolunteerReviewStatus" NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerAttendanceHistory" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" "VolunteerReviewStatus",
    "toStatus" "VolunteerReviewStatus" NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerAttendanceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerServiceLog" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "status" "VolunteerReviewStatus" NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerServiceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerServiceLogHistory" (
    "id" TEXT NOT NULL,
    "serviceLogId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" "VolunteerReviewStatus",
    "toStatus" "VolunteerReviewStatus" NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerServiceLogHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerProfile_userId_key" ON "VolunteerProfile"("userId");

-- CreateIndex
CREATE INDEX "VolunteerAvailability_profileId_weekday_idx" ON "VolunteerAvailability"("profileId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerAvailability_profileId_weekday_startMinute_endMinu_key" ON "VolunteerAvailability"("profileId", "weekday", "startMinute", "endMinute", "timeZone");

-- CreateIndex
CREATE INDEX "VolunteerAttendance_profileId_status_serviceDate_idx" ON "VolunteerAttendance"("profileId", "status", "serviceDate");

-- CreateIndex
CREATE INDEX "VolunteerAttendance_clubId_status_serviceDate_idx" ON "VolunteerAttendance"("clubId", "status", "serviceDate");

-- One open/approved claim for an activity on a day. Rejected or voided claims retain history and allow correction.
CREATE UNIQUE INDEX "VolunteerAttendance_open_event_key" ON "VolunteerAttendance"("profileId", "clubId", "serviceDate", lower(trim("activityTitle")))
  WHERE "status" IN ('SUBMITTED', 'APPROVED');

-- CreateIndex
CREATE INDEX "VolunteerAttendanceHistory_attendanceId_createdAt_idx" ON "VolunteerAttendanceHistory"("attendanceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerServiceLog_attendanceId_key" ON "VolunteerServiceLog"("attendanceId");

-- CreateIndex
CREATE INDEX "VolunteerServiceLog_profileId_status_createdAt_idx" ON "VolunteerServiceLog"("profileId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VolunteerServiceLogHistory_serviceLogId_createdAt_idx" ON "VolunteerServiceLogHistory"("serviceLogId", "createdAt");

-- AddForeignKey
ALTER TABLE "VolunteerProfile" ADD CONSTRAINT "VolunteerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerAvailability" ADD CONSTRAINT "VolunteerAvailability_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "VolunteerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerAttendance" ADD CONSTRAINT "VolunteerAttendance_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "VolunteerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerAttendance" ADD CONSTRAINT "VolunteerAttendance_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerAttendance" ADD CONSTRAINT "VolunteerAttendance_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerAttendanceHistory" ADD CONSTRAINT "VolunteerAttendanceHistory_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "VolunteerAttendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerAttendanceHistory" ADD CONSTRAINT "VolunteerAttendanceHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerServiceLog" ADD CONSTRAINT "VolunteerServiceLog_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "VolunteerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerServiceLog" ADD CONSTRAINT "VolunteerServiceLog_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "VolunteerAttendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerServiceLog" ADD CONSTRAINT "VolunteerServiceLog_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerServiceLogHistory" ADD CONSTRAINT "VolunteerServiceLogHistory_serviceLogId_fkey" FOREIGN KEY ("serviceLogId") REFERENCES "VolunteerServiceLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerServiceLogHistory" ADD CONSTRAINT "VolunteerServiceLogHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VolunteerAvailability" ADD CONSTRAINT "VolunteerAvailability_valid_window"
  CHECK ("weekday" BETWEEN 0 AND 6 AND "startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 1 AND 1440 AND "endMinute" > "startMinute");
ALTER TABLE "VolunteerServiceLog" ADD CONSTRAINT "VolunteerServiceLog_valid_minutes"
  CHECK ("minutes" BETWEEN 1 AND 1440);
ALTER TABLE "VolunteerAttendance" ADD CONSTRAINT "VolunteerAttendance_reviewed_state"
  CHECK ("status" NOT IN ('APPROVED', 'REJECTED', 'VOIDED') OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL));
ALTER TABLE "VolunteerServiceLog" ADD CONSTRAINT "VolunteerServiceLog_reviewed_state"
  CHECK ("status" NOT IN ('APPROVED', 'REJECTED', 'VOIDED') OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL));
CREATE TRIGGER "VolunteerAttendanceHistory_immutable" BEFORE UPDATE OR DELETE ON "VolunteerAttendanceHistory"
  FOR EACH ROW EXECUTE FUNCTION "rejectApprovalHistoryMutation"();
CREATE TRIGGER "VolunteerServiceLogHistory_immutable" BEFORE UPDATE OR DELETE ON "VolunteerServiceLogHistory"
  FOR EACH ROW EXECUTE FUNCTION "rejectApprovalHistoryMutation"();
