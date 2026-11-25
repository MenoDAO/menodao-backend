-- Calendar sync plumbing: OAuth connections to Google Calendar / Microsoft 365
-- plus external-event tracking on appointments.

ALTER TABLE "Appointment" ADD COLUMN "externalCalendarProvider" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Appointment" ADD COLUMN "externalEventId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "calendarSyncedAt" TIMESTAMP(3);

CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "calendarId" TEXT,
    "accountEmail" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarConnection_ownerType_ownerId_provider_key" ON "CalendarConnection"("ownerType", "ownerId", "provider");
CREATE INDEX "CalendarConnection_ownerType_ownerId_idx" ON "CalendarConnection"("ownerType", "ownerId");
