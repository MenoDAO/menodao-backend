-- Protocol v5.0 Updates for March 20th Launch
-- BACKWARD COMPATIBLE: All changes are additive, no breaking changes
-- 1. Add subscription tracking fields (optional, with defaults)
-- 2. Make KMPDC registration required for NEW clinics only
-- 3. Procedure costs updated via service, not migration

-- Add new fields to Subscription model for tracking (all optional with safe defaults)
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "paymentFrequency" TEXT DEFAULT 'MONTHLY';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "subscriptionStartDate" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "annualCapUsed" INTEGER DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "annualCapLimit" INTEGER DEFAULT 6000;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "procedureUsageCount" JSONB DEFAULT '{}';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "lastResetDate" TIMESTAMP(3);

-- KMPDC: Keep it optional for now to avoid breaking existing clinics
-- Will be enforced for NEW registrations only via validation
-- DO NOT make it NOT NULL to preserve existing functionality

-- Add indexes for performance (safe operation)
CREATE INDEX IF NOT EXISTS "Subscription_subscriptionStartDate_idx" ON "Subscription"("subscriptionStartDate");
CREATE INDEX IF NOT EXISTS "Subscription_paymentFrequency_idx" ON "Subscription"("paymentFrequency");
CREATE INDEX IF NOT EXISTS "Clinic_kmpdcRegNumber_idx" ON "Clinic"("kmpdcRegNumber");

-- Update existing subscriptions with safe defaults
-- Set annual cap based on tier (backward compatible)
UPDATE "Subscription" SET "annualCapLimit" = 6000 WHERE "tier" = 'BRONZE' AND "annualCapLimit" = 0;
UPDATE "Subscription" SET "annualCapLimit" = 10000 WHERE "tier" = 'SILVER' AND "annualCapLimit" = 0;
UPDATE "Subscription" SET "annualCapLimit" = 15000 WHERE "tier" = 'GOLD' AND "annualCapLimit" = 0;

-- Set subscriptionStartDate to startDate for existing subscriptions (backward compatible)
-- This grandfathers existing members (no waiting period)
UPDATE "Subscription" SET "subscriptionStartDate" = "startDate" WHERE "subscriptionStartDate" IS NULL;

-- Set lastResetDate to current date for existing subscriptions
UPDATE "Subscription" SET "lastResetDate" = CURRENT_TIMESTAMP WHERE "lastResetDate" IS NULL;

