-- CreateTable
CREATE TABLE "BotWhatsappInstance" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'flaresend',
    "providerId" TEXT NOT NULL,
    "label" TEXT,
    "phoneNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "apiKeyCipher" TEXT,
    "webhookUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotWhatsappInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotChatThread" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT,
    "memberId" TEXT,
    "contactId" TEXT NOT NULL,
    "contactName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "consentBasis" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "erasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "direction" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'TEXT',
    "deliveryStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotWhatsappInstance_isActive_idx" ON "BotWhatsappInstance"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BotWhatsappInstance_provider_providerId_key" ON "BotWhatsappInstance"("provider", "providerId");

-- CreateIndex
CREATE INDEX "BotChatThread_instanceId_lastMessageAt_idx" ON "BotChatThread"("instanceId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "BotChatThread_memberId_idx" ON "BotChatThread"("memberId");

-- CreateIndex
CREATE INDEX "BotChatThread_contactId_idx" ON "BotChatThread"("contactId");

-- CreateIndex
CREATE INDEX "BotChatThread_retentionUntil_idx" ON "BotChatThread"("retentionUntil");

-- CreateIndex
CREATE INDEX "BotChatMessage_threadId_sentAt_idx" ON "BotChatMessage"("threadId", "sentAt");

-- CreateIndex
CREATE INDEX "BotChatMessage_providerMessageId_idx" ON "BotChatMessage"("providerMessageId");

-- AddForeignKey
ALTER TABLE "BotChatThread" ADD CONSTRAINT "BotChatThread_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "BotWhatsappInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotChatThread" ADD CONSTRAINT "BotChatThread_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotChatMessage" ADD CONSTRAINT "BotChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "BotChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

