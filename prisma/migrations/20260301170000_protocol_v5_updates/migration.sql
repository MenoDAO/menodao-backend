-- Protocol v5.0 Updates for March 20th Launch
-- 1. Add subscription tracking fields
-- 2. Make KMPDC registration required for clinics
-- 3. Update procedure costs to match new rate card

-- Add new fields to Subscription model for tracking
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "paymentFrequency" TEXT DEFAULT 'MONTHLY';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "subscriptionStartDate" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "annualCapUsed" INTEGER DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "annualCapLimit" INTEGER DEFAULT 6000;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "procedureUsageCount" JSONB DEFAULT '{}';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "lastResetDate" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- Make KMPDC registration number required for clinics (legal requirement)
-- First, update any NULL values to a placeholder
UPDATE "Clinic" SET "kmpdcRegNumber" = 'PENDING_VERIFICATION' WHERE "kmpdcRegNumber" IS NULL;

-- Now make it NOT NULL
ALTER TABLE "Clinic" ALTER COLUMN "kmpdcRegNumber" SET NOT NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS "Subscription_subscriptionStartDate_idx" ON "Subscription"("subscriptionStartDate");
CREATE INDEX IF NOT EXISTS "Subscription_paymentFrequency_idx" ON "Subscription"("paymentFrequency");
CREATE INDEX IF NOT EXISTS "Clinic_kmpdcRegNumber_idx" ON "Clinic"("kmpdcRegNumber");

-- Update existing subscriptions to set proper annual cap based on tier
UPDATE "Subscription" SET "annualCapLimit" = 6000 WHERE "tier" = 'BRONZE';
UPDATE "Subscription" SET "annualCapLimit" = 10000 WHERE "tier" = 'SILVER';
UPDATE "Subscription" SET "annualCapLimit" = 15000 WHERE "tier" = 'GOLD';

-- Set subscriptionStartDate to startDate for existing subscriptions
UPDATE "Subscription" SET "subscriptionStartDate" = "startDate" WHERE "subscriptionStartDate" IS NULL;

