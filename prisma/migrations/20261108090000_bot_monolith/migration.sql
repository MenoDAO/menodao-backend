-- Bot monolith (ported from menobot)
-- Adds whatsapp link columns to Member and Bot* conversation tables.

ALTER TABLE "Member" ADD COLUMN "whatsappId" TEXT;
ALTER TABLE "Member" ADD COLUMN "whatsappLinkedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Member_whatsappId_key" ON "Member"("whatsappId");

CREATE TABLE "BotMessageLog" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotMessageLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BotMessageLog_memberId_idx" ON "BotMessageLog"("memberId");
CREATE INDEX "BotMessageLog_createdAt_idx" ON "BotMessageLog"("createdAt");
ALTER TABLE "BotMessageLog" ADD CONSTRAINT "BotMessageLog_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BotLead" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotLead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BotLead_memberId_idx" ON "BotLead"("memberId");
ALTER TABLE "BotLead" ADD CONSTRAINT "BotLead_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BotBookingDraft" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "clinicId" TEXT,
    "service" TEXT,
    "date" TEXT,
    "time" TEXT,
    "clientName" TEXT,
    "rawDateMentioned" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'COLLECTING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BotBookingDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BotBookingDraft_memberId_key" ON "BotBookingDraft"("memberId");
ALTER TABLE "BotBookingDraft" ADD CONSTRAINT "BotBookingDraft_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BotLlmCallLog" (
    "id" TEXT NOT NULL,
    "memberId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "responseFormat" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "userPrompt" TEXT NOT NULL,
    "history" TEXT NOT NULL,
    "response" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotLlmCallLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BotLlmCallLog_createdAt_idx" ON "BotLlmCallLog"("createdAt");
CREATE INDEX "BotLlmCallLog_memberId_idx" ON "BotLlmCallLog"("memberId");
ALTER TABLE "BotLlmCallLog" ADD CONSTRAINT "BotLlmCallLog_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
