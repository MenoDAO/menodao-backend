-- Restricted WhatsApp field-data collection for doctors and health personnel.
-- Raw media is stored in the existing encrypted S3 bucket; this table holds
-- extraction/review metadata only, so the rollout is purely additive.

CREATE TYPE "FieldContributorRole" AS ENUM ('DOCTOR', 'PHYSICIAN', 'HEALTH_PERSONNEL', 'NURSE');
CREATE TYPE "FieldMediaKind" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO');
CREATE TYPE "FieldSubmissionStatus" AS ENUM ('PENDING', 'PARSED', 'NEEDS_REVIEW', 'PROCESSED', 'REJECTED');

CREATE TABLE "FieldContributor" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "FieldContributorRole" NOT NULL DEFAULT 'HEALTH_PERSONNEL',
    "organization" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldContributor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FieldContributor_phoneNumber_key" ON "FieldContributor"("phoneNumber");
CREATE INDEX "FieldContributor_isActive_idx" ON "FieldContributor"("isActive");
CREATE INDEX "FieldContributor_role_isActive_idx" ON "FieldContributor"("role", "isActive");

CREATE TABLE "FieldSubmission" (
    "id" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "memberId" TEXT,
    "providerMessageId" TEXT,
    "whatsappId" TEXT,
    "kind" "FieldMediaKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "originalFilename" TEXT,
    "caption" TEXT,
    "status" "FieldSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "extracted" JSONB,
    "summary" TEXT,
    "parseError" TEXT,
    "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "needsAdminReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "reviewerAdminId" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FieldSubmission_providerMessageId_key" ON "FieldSubmission"("providerMessageId");
CREATE INDEX "FieldSubmission_status_createdAt_idx" ON "FieldSubmission"("status", "createdAt");
CREATE INDEX "FieldSubmission_contributorId_createdAt_idx" ON "FieldSubmission"("contributorId", "createdAt");
CREATE INDEX "FieldSubmission_needsAdminReview_status_idx" ON "FieldSubmission"("needsAdminReview", "status");

ALTER TABLE "FieldSubmission" ADD CONSTRAINT "FieldSubmission_contributorId_fkey"
  FOREIGN KEY ("contributorId") REFERENCES "FieldContributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FieldSubmission" ADD CONSTRAINT "FieldSubmission_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
