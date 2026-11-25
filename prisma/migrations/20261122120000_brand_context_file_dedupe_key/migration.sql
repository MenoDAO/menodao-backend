-- Prevent duplicate brand-context uploads with the same title and extracted
-- content. Existing rows stay NULL (Postgres permits many NULLs in a unique
-- index); new uploads carry a sha256 of normalized title + extracted text.

ALTER TABLE "BotContextFile" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "BotContextFile_dedupeKey_key" ON "BotContextFile"("dedupeKey");
