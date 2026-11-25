-- Booking foundation: doctors, schedules, procedure/appointment durations.
-- Additive: safe to deploy before code that reads new columns.

ALTER TABLE "Procedure" ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "Appointment" ADD COLUMN "doctorId" TEXT;
ALTER TABLE "Appointment" ALTER COLUMN "durationMinutes" SET DEFAULT 20;

ALTER TABLE "BotBookingDraft" ADD COLUMN "doctorId" TEXT;

CREATE TABLE "ClinicDoctor" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "specialty" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "consultationMinutes" INTEGER NOT NULL DEFAULT 15,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 5,
    "timezone" TEXT,
    "calendarProvider" TEXT,
    "calendarId" TEXT,
    "calendarSyncToken" TEXT,
    "calendarConnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicDoctor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DoctorAvailability" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorAvailability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClinicOperatingHour" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TEXT,
    "closeTime" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicOperatingHour_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClinicDoctor_clinicId_isActive_idx" ON "ClinicDoctor"("clinicId", "isActive");
CREATE INDEX "DoctorAvailability_doctorId_dayOfWeek_isActive_idx" ON "DoctorAvailability"("doctorId", "dayOfWeek", "isActive");
CREATE UNIQUE INDEX "ClinicOperatingHour_clinicId_dayOfWeek_key" ON "ClinicOperatingHour"("clinicId", "dayOfWeek");
CREATE INDEX "ClinicOperatingHour_clinicId_idx" ON "ClinicOperatingHour"("clinicId");
CREATE INDEX "Appointment_doctorId_scheduledAt_idx" ON "Appointment"("doctorId", "scheduledAt");

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "ClinicDoctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClinicDoctor" ADD CONSTRAINT "ClinicDoctor_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DoctorAvailability" ADD CONSTRAINT "DoctorAvailability_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "ClinicDoctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClinicOperatingHour" ADD CONSTRAINT "ClinicOperatingHour_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
