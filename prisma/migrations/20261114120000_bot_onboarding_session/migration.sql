-- Bot onboarding state machine
-- Adds BotOnboardingSession so new/inbound bot users can be guided through a
-- step-based onboarding flow before/while operating their MenoDAO account.

CREATE TABLE "BotOnboardingSession" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "step" TEXT NOT NULL DEFAULT 'WELCOME',
    "language" TEXT NOT NULL DEFAULT 'en',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotOnboardingSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BotOnboardingSession_memberId_idx" ON "BotOnboardingSession"("memberId");
CREATE UNIQUE INDEX "BotOnboardingSession_memberId_key" ON "BotOnboardingSession"("memberId");
ALTER TABLE "BotOnboardingSession" ADD CONSTRAINT "BotOnboardingSession_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
