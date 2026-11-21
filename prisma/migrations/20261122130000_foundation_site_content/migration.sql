-- Durable admin-editable content for the public Foundation site. The old
-- settings.json in uploads/ stayed inside the API container and disappeared on
-- every deploy. This additive table lets an old container keep serving while
-- the new one migrates; the service imports the legacy file on first read.

CREATE TABLE "FoundationSiteContent" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoundationSiteContent_pkey" PRIMARY KEY ("id")
);
