-- Brand context versioning: stable section identity, content hashing and
-- immutable version snapshots. All changes are additive.

ALTER TABLE "BotContextDocument" ADD COLUMN "sectionKey" TEXT;
ALTER TABLE "BotContextDocument" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "BotContextDocument" ADD COLUMN "externalRevision" TEXT;
ALTER TABLE "BotContextDocument" ADD COLUMN "sourceModifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "BotContextDocument_source_externalId_sectionKey_key" ON "BotContextDocument"("source", "externalId", "sectionKey");

CREATE TABLE "BrandContextDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalRevision" TEXT,
    "changeType" TEXT NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandContextDocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandContextDocumentVersion_documentId_version_key" ON "BrandContextDocumentVersion"("documentId", "version");
CREATE INDEX "BrandContextDocumentVersion_documentId_createdAt_idx" ON "BrandContextDocumentVersion"("documentId", "createdAt");

ALTER TABLE "BrandContextDocumentVersion" ADD CONSTRAINT "BrandContextDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BotContextDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
