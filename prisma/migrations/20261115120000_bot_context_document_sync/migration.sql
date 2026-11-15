-- Context document sync metadata: Google Drive source tracking + versioning.

ALTER TABLE "BotContextDocument" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "BotContextDocument" ADD COLUMN "externalId" TEXT;
ALTER TABLE "BotContextDocument" ADD COLUMN "externalUrl" TEXT;
ALTER TABLE "BotContextDocument" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "BotContextDocument" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "BotContextDocument_kind_idx";
CREATE INDEX "BotContextDocument_kind_active_idx" ON "BotContextDocument"("kind", "active");
CREATE INDEX "BotContextDocument_source_externalId_idx" ON "BotContextDocument"("source", "externalId");
