CREATE TYPE "DonorType" AS ENUM ('INDIVIDUAL', 'ORGANIZATION');
CREATE TYPE "DonationMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI');
CREATE TYPE "DonationStatus" AS ENUM ('PENDING_VERIFICATION');

CREATE TABLE "DonorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "type" "DonorType" NOT NULL DEFAULT 'INDIVIDUAL',
    "organizationName" TEXT,
    "anonymousByDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DonorProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Donation" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "donorProfileId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "campaignId" TEXT,
    "createdById" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "method" "DonationMethod" NOT NULL,
    "status" "DonationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "privateNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DonationHistory" (
    "id" TEXT NOT NULL,
    "donationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "toStatus" "DonationStatus" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DonationHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DonationEvidence" (
    "id" TEXT NOT NULL,
    "donationId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "DonationEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DonorProfile_userId_key" ON "DonorProfile"("userId");
CREATE UNIQUE INDEX "Donation_idempotencyKey_key" ON "Donation"("idempotencyKey");
CREATE INDEX "DonorProfile_createdAt_idx" ON "DonorProfile"("createdAt");
CREATE INDEX "Donation_status_receivedAt_idx" ON "Donation"("status", "receivedAt");
CREATE INDEX "Donation_donorProfileId_createdAt_idx" ON "Donation"("donorProfileId", "createdAt");
CREATE INDEX "Donation_projectId_status_receivedAt_idx" ON "Donation"("projectId", "status", "receivedAt");
CREATE INDEX "Donation_campaignId_idx" ON "Donation"("campaignId");
CREATE INDEX "DonationHistory_donationId_createdAt_idx" ON "DonationHistory"("donationId", "createdAt");
CREATE UNIQUE INDEX "DonationEvidence_mediaId_key" ON "DonationEvidence"("mediaId");
CREATE INDEX "DonationEvidence_donationId_createdAt_idx" ON "DonationEvidence"("donationId", "createdAt");

ALTER TABLE "DonorProfile" ADD CONSTRAINT "DonorProfile_positive_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DonorProfile" ADD CONSTRAINT "DonorProfile_creator_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_donorProfileId_fkey" FOREIGN KEY ("donorProfileId") REFERENCES "DonorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "DonationCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_creator_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DonationHistory" ADD CONSTRAINT "DonationHistory_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DonationHistory" ADD CONSTRAINT "DonationHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DonationEvidence" ADD CONSTRAINT "DonationEvidence_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DonationEvidence" ADD CONSTRAINT "DonationEvidence_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DonationEvidence" ADD CONSTRAINT "DonationEvidence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DonorProfile" ADD CONSTRAINT "DonorProfile_organization_name" CHECK (("type" = 'ORGANIZATION' AND "organizationName" IS NOT NULL AND length(trim("organizationName")) > 0) OR ("type" = 'INDIVIDUAL'));
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_pending_intake_gate" CHECK ("amountPaise" > 0 AND "currency" = 'INR' AND "status" = 'PENDING_VERIFICATION');
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_campaign_project_match" CHECK ("campaignId" IS NULL OR "projectId" IS NOT NULL);

CREATE FUNCTION "trustfolio_reject_donation_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Donation history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "DonationHistory_no_update" BEFORE UPDATE OR DELETE ON "DonationHistory" FOR EACH ROW EXECUTE FUNCTION "trustfolio_reject_donation_history_mutation"();

CREATE FUNCTION "trustfolio_reject_confirmed_donation"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" <> 'PENDING_VERIFICATION' OR NEW."currency" <> 'INR' THEN
    RAISE EXCEPTION 'Donation verification and other currencies are gated until finance policy activation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Donation_pending_only" BEFORE INSERT OR UPDATE ON "Donation" FOR EACH ROW EXECUTE FUNCTION "trustfolio_reject_confirmed_donation"();
