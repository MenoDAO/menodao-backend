-- OTP-gated member data access from WhatsApp + append-only access audit trail.

-- Brute-force protection: burn an OTP after five wrong guesses.
ALTER TABLE "OTPCode" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "BotDataAccessSession" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotDataAccessSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BotDataAccessSession_memberId_createdAt_idx" ON "BotDataAccessSession"("memberId", "createdAt");
CREATE INDEX "BotDataAccessSession_status_expiresAt_idx" ON "BotDataAccessSession"("status", "expiresAt");
CREATE INDEX "BotDataAccessSession_memberId_status_idx" ON "BotDataAccessSession"("memberId", "status");

ALTER TABLE "BotDataAccessSession"
    ADD CONSTRAINT "BotDataAccessSession_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SensitiveDataAccessLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "memberId" TEXT,
    "scope" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensitiveDataAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SensitiveDataAccessLog_actorId_createdAt_idx" ON "SensitiveDataAccessLog"("actorId", "createdAt");
CREATE INDEX "SensitiveDataAccessLog_memberId_createdAt_idx" ON "SensitiveDataAccessLog"("memberId", "createdAt");
CREATE INDEX "SensitiveDataAccessLog_outcome_createdAt_idx" ON "SensitiveDataAccessLog"("outcome", "createdAt");
