-- Appointment booking

CREATE TYPE "AppointmentStatus" AS ENUM (
  'BOOKED',
  'RESCHEDULED',
  'CANCELLED_BY_MEMBER',
  'CANCELLED_BY_CLINIC',
  'ATTENDED',
  'NO_SHOW'
);

CREATE TYPE "AppointmentActor" AS ENUM ('MEMBER', 'STAFF', 'SYSTEM');
CREATE TYPE "AppointmentReminderKind" AS ENUM ('DAY_BEFORE', 'HOUR_BEFORE');
CREATE TYPE "AppointmentChannel" AS ENUM ('SMS', 'EMAIL');

CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "staffId" TEXT,
    "visitId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "intakeReason" TEXT NOT NULL,
    "painLevel" INTEGER,
    "allergies" TEXT,
    "currentMedications" TEXT,
    "medicalConditions" TEXT,
    "hasConsent" BOOLEAN NOT NULL DEFAULT false,
    "memberNotes" TEXT,
    "clinicNotes" TEXT,
    "cancelReason" TEXT,
    "rescheduleReason" TEXT,
    "dayBeforeReminderSentAt" TIMESTAMP(3),
    "hourBeforeReminderSentAt" TIMESTAMP(3),
    "noShowNotedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Appointment_visitId_key" ON "Appointment"("visitId");
CREATE INDEX "Appointment_memberId_scheduledAt_idx" ON "Appointment"("memberId", "scheduledAt");
CREATE INDEX "Appointment_clinicId_scheduledAt_idx" ON "Appointment"("clinicId", "scheduledAt");
CREATE INDEX "Appointment_status_scheduledAt_idx" ON "Appointment"("status", "scheduledAt");
CREATE INDEX "Appointment_staffId_idx" ON "Appointment"("staffId");

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AppointmentEvent" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor" "AppointmentActor" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "fromScheduledAt" TIMESTAMP(3),
    "toScheduledAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppointmentEvent_appointmentId_createdAt_idx"
  ON "AppointmentEvent"("appointmentId", "createdAt");

ALTER TABLE "AppointmentEvent" ADD CONSTRAINT "AppointmentEvent_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AppointmentReminder" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "kind" "AppointmentReminderKind" NOT NULL,
    "channel" "AppointmentChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentReminder_appointmentId_kind_channel_key"
  ON "AppointmentReminder"("appointmentId", "kind", "channel");
CREATE INDEX "AppointmentReminder_appointmentId_idx" ON "AppointmentReminder"("appointmentId");

ALTER TABLE "AppointmentReminder" ADD CONSTRAINT "AppointmentReminder_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
