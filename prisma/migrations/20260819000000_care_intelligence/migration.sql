-- Care Intelligence indexes on operational tables
CREATE INDEX IF NOT EXISTS "Member_county_idx" ON "Member"("county");
CREATE INDEX IF NOT EXISTS "Member_createdAt_idx" ON "Member"("createdAt");
CREATE INDEX IF NOT EXISTS "Visit_checkedInAt_idx" ON "Visit"("checkedInAt");
CREATE INDEX IF NOT EXISTS "Visit_dischargedAt_idx" ON "Visit"("dischargedAt");

-- Enums
CREATE TYPE "CareEventType" AS ENUM (
  'MEMBER_REGISTERED',
  'MEMBERSHIP_VIEWED',
  'MEMBERSHIP_STARTED',
  'MEMBERSHIP_PAYMENT_ATTEMPTED',
  'MEMBERSHIP_PAYMENT_SUCCESS',
  'MEMBERSHIP_PAYMENT_FAILED',
  'MEMBERSHIP_CANCELLED',
  'APPOINTMENT_REQUESTED',
  'APPOINTMENT_BOOKED',
  'APPOINTMENT_RESCHEDULED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_ATTENDED',
  'APPOINTMENT_NO_SHOW',
  'TREATMENT_STARTED',
  'TREATMENT_COMPLETED',
  'FOLLOWUP_REQUIRED',
  'FOLLOWUP_COMPLETED',
  'REFERRAL_CREATED',
  'REFERRAL_CONVERTED',
  'AI_CONVERSATION_STARTED',
  'AI_INTAKE_COMPLETED',
  'AI_ESCALATED',
  'AI_HANDOFF_COMPLETED'
);

CREATE TYPE "CarePrivacyClass" AS ENUM ('OPERATIONAL', 'ANALYTICS', 'CLINICAL', 'AGGREGATE');
CREATE TYPE "CareInsightKind" AS ENUM ('OBSERVED', 'INTERPRETED', 'ACTION');
CREATE TYPE "CareInsightStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'ACTED', 'DISMISSED');
CREATE TYPE "CareExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'KILLED', 'KEPT', 'MODIFIED');
CREATE TYPE "CareAlertSeverity" AS ENUM ('CRITICAL', 'WARNING', 'OPPORTUNITY', 'FOLLOW_UP');
CREATE TYPE "CareRecommendationStatus" AS ENUM ('RECOMMENDED', 'VIEWED', 'IN_PROGRESS', 'DONE', 'DISMISSED');

CREATE TABLE "CareEvent" (
    "id" TEXT NOT NULL,
    "type" "CareEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memberId" TEXT,
    "sessionId" TEXT,
    "conversationId" TEXT,
    "source" TEXT,
    "county" TEXT,
    "subCounty" TEXT,
    "metadata" JSONB,
    "privacyClass" "CarePrivacyClass" NOT NULL DEFAULT 'ANALYTICS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CareEvent_type_occurredAt_idx" ON "CareEvent"("type", "occurredAt");
CREATE INDEX "CareEvent_occurredAt_idx" ON "CareEvent"("occurredAt");
CREATE INDEX "CareEvent_memberId_occurredAt_idx" ON "CareEvent"("memberId", "occurredAt");
CREATE INDEX "CareEvent_source_idx" ON "CareEvent"("source");
CREATE INDEX "CareEvent_county_idx" ON "CareEvent"("county");

CREATE TABLE "CareMetricSnapshot" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "geography" TEXT NOT NULL DEFAULT 'ALL',
    "value" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CareMetricSnapshot_metricId_period_periodStart_geography_key"
  ON "CareMetricSnapshot"("metricId", "period", "periodStart", "geography");
CREATE INDEX "CareMetricSnapshot_metricId_periodStart_idx"
  ON "CareMetricSnapshot"("metricId", "periodStart");

CREATE TABLE "CareLoopTarget" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "minSampleSize" INTEGER NOT NULL DEFAULT 10,
    "impactWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "controllability" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "CareLoopTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CareLoopTarget_metricId_key" ON "CareLoopTarget"("metricId");

CREATE TABLE "CareInsight" (
    "id" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metricId" TEXT NOT NULL,
    "kind" "CareInsightKind" NOT NULL,
    "observation" TEXT NOT NULL,
    "interpretation" TEXT,
    "recommendation" TEXT,
    "evidence" JSONB NOT NULL,
    "confidence" TEXT NOT NULL,
    "actionTaken" TEXT,
    "outcome" TEXT,
    "owner" TEXT,
    "status" "CareInsightStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareInsight_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CareInsight_generatedAt_idx" ON "CareInsight"("generatedAt");
CREATE INDEX "CareInsight_metricId_idx" ON "CareInsight"("metricId");
CREATE INDEX "CareInsight_status_idx" ON "CareInsight"("status");

CREATE TABLE "CareExperiment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "baseline" DOUBLE PRECISION,
    "target" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "owner" TEXT,
    "status" "CareExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "result" TEXT,
    "decision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareExperiment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CareExperiment_status_idx" ON "CareExperiment"("status");
CREATE INDEX "CareExperiment_metricId_idx" ON "CareExperiment"("metricId");

CREATE TABLE "CareAlert" (
    "id" TEXT NOT NULL,
    "severity" "CareAlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metricId" TEXT,
    "cohortKey" TEXT,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "CareAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CareAlert_firedAt_idx" ON "CareAlert"("firedAt");
CREATE INDEX "CareAlert_severity_resolvedAt_idx" ON "CareAlert"("severity", "resolvedAt");

CREATE TABLE "CareRecommendation" (
    "id" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "suggestedAction" TEXT NOT NULL,
    "expectedImpact" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "status" "CareRecommendationStatus" NOT NULL DEFAULT 'RECOMMENDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CareRecommendation_status_idx" ON "CareRecommendation"("status");
CREATE INDEX "CareRecommendation_createdAt_idx" ON "CareRecommendation"("createdAt");

CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageTemplate_key_key" ON "MessageTemplate"("key");

-- Default care-loop targets (admins can change these in the dashboard)
INSERT INTO "CareLoopTarget" ("id", "metricId", "targetValue", "minSampleSize", "impactWeight", "controllability", "notes", "updatedAt")
VALUES
  ('clt_completed_treatments', 'completed_treatments_monthly', 175, 1, 1.0, 0.7, 'Monthly completed treatment episodes (discharged visits).', CURRENT_TIMESTAMP),
  ('clt_paid_conversion', 'registration_to_paid', 0.15, 20, 0.7, 0.85, 'Paid members / registered members.', CURRENT_TIMESTAMP),
  ('clt_paid_to_booked', 'paid_to_booking', 0.70, 10, 0.8, 0.6, 'Members who enter care / paid members. Booking is not yet a distinct event.', CURRENT_TIMESTAMP),
  ('clt_booking_to_attendance', 'booking_to_attendance', 0.85, 10, 0.9, 0.7, 'Attended / booked. Requires appointment booking data.', CURRENT_TIMESTAMP),
  ('clt_attendance_to_treatment', 'attendance_to_treatment', 0.90, 10, 1.0, 0.8, 'Patients treated / patients who attended.', CURRENT_TIMESTAMP),
  ('clt_treatment_completion', 'treatment_completion', 0.85, 10, 1.0, 0.85, 'Discharged visits / visits with at least one procedure.', CURRENT_TIMESTAMP),
  ('clt_followup', 'treatment_to_followup', 0.80, 10, 0.8, 0.75, 'Recommended follow-up completed / follow-up required.', CURRENT_TIMESTAMP),
  ('clt_retention', 'retention_90d', 0.35, 15, 0.85, 0.6, 'Prior-90-day treated patients who return in the current window.', CURRENT_TIMESTAMP),
  ('clt_referral', 'referral_rate', 0.15, 15, 0.7, 0.7, 'New members acquired through existing members / new members.', CURRENT_TIMESTAMP),
  ('clt_demand_registration', 'demand_to_registration', 0.40, 20, 0.5, 0.5, 'Registered / qualified leads. Qualified leads are not independently tracked yet.', CURRENT_TIMESTAMP);
