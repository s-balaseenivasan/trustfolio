-- Align explicitly authored Phase 6 FK names with Prisma's physical naming convention.
ALTER TABLE "DonorProfile" RENAME CONSTRAINT "DonorProfile_positive_id_fkey" TO "DonorProfile_userId_fkey";
ALTER TABLE "DonorProfile" RENAME CONSTRAINT "DonorProfile_creator_fkey" TO "DonorProfile_createdById_fkey";
ALTER TABLE "Donation" RENAME CONSTRAINT "Donation_creator_fkey" TO "Donation_createdById_fkey";
