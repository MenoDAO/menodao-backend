-- Migration: add_champion_referral_system
-- Additive only — no existing columns dropped or altered

-- Add referral fields to Member
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "referredBy" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "firstPaymentCleared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "commissionsBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "commissionsWithdrawn" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "activeReferralsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "isGoldMember" BOOLEAN NOT NULL DEFAULT false;

-- Unique constraint on referralCode
CREATE UNIQUE INDEX IF NOT EXISTS "Member_referralCode_key" ON "Member"("referralCode");

-- Indexes for referral lookups
CREATE INDEX IF NOT EXISTS "Member_referralCode_idx" ON "Member"("referralCode");
CREATE INDEX IF NOT EXISTS "Member_referredBy_idx" ON "Member"("referredBy");

-- WithdrawalStatus enum
DO $$ BEGIN
  CREATE TYPE "WithdrawalStatus" AS ENUM (
    'PENDING',
    'PENDING_ADMIN_APPROVAL',
    'APPROVED',
    'REJECTED',
    'FAILED',
    'COMPLETED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CommissionLedger table
CREATE TABLE IF NOT EXISTS "CommissionLedger" (
  "id"             TEXT NOT NULL,
  "championId"     TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL,
  "contributionId" TEXT NOT NULL,
  "amount"         INTEGER NOT NULL,
  "tier"           "PackageTier" NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommissionLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommissionLedger_championId_fkey"
    FOREIGN KEY ("championId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CommissionLedger_championId_idx" ON "CommissionLedger"("championId");
CREATE INDEX IF NOT EXISTS "CommissionLedger_createdAt_idx" ON "CommissionLedger"("createdAt");

-- WithdrawalRecord table
CREATE TABLE IF NOT EXISTS "WithdrawalRecord" (
  "id"                 TEXT NOT NULL,
  "championId"         TEXT NOT NULL,
  "amount"             INTEGER NOT NULL,
  "status"             "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
  "sasaPayRequestId"   TEXT,
  "mpesaReceiptNumber" TEXT,
  "errorMessage"       TEXT,
  "rejectionReason"    TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt"         TIMESTAMP(3),
  "completedAt"        TIMESTAMP(3),

  CONSTRAINT "WithdrawalRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WithdrawalRecord_championId_fkey"
    FOREIGN KEY ("championId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WithdrawalRecord_championId_idx" ON "WithdrawalRecord"("championId");
CREATE INDEX IF NOT EXISTS "WithdrawalRecord_status_idx" ON "WithdrawalRecord"("status");
CREATE INDEX IF NOT EXISTS "WithdrawalRecord_createdAt_idx" ON "WithdrawalRecord"("createdAt");
