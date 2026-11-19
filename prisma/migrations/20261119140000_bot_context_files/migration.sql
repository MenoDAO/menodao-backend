-- Context document file uploads: original bytes live in S3, the extracted
-- text is stored beside them, and the retrievable sections point back at the
-- upload that produced them.

CREATE TABLE "BotContextFile" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "textStorageKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "extractError" TEXT,
    "extractedAt" TIMESTAMP(3),
    "sectionCount" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'BIBLE',
    "title" TEXT,
    "uploadedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotContextFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BotContextFile_sha256_idx" ON "BotContextFile"("sha256");
CREATE INDEX "BotContextFile_status_idx" ON "BotContextFile"("status");
CREATE INDEX "BotContextFile_createdAt_idx" ON "BotContextFile"("createdAt");

ALTER TABLE "BotContextDocument" ADD COLUMN "fileId" TEXT;

CREATE INDEX "BotContextDocument_fileId_idx" ON "BotContextDocument"("fileId");

ALTER TABLE "BotContextDocument" ADD CONSTRAINT "BotContextDocument_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "BotContextFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
