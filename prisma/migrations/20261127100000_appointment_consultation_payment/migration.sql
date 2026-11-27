ALTER TYPE "AppointmentStatus" ADD VALUE 'AWAITING_PAYMENT';
ALTER TYPE "AppointmentStatus" ADD VALUE 'PAYMENT_FAILED';
ALTER TABLE "Appointment"
    ADD COLUMN "consultationMethod" TEXT,
    ADD COLUMN "consultationReference" TEXT,
    ADD COLUMN "consultationCheckoutId" TEXT,
    ADD COLUMN "consultationReceipt" TEXT;
CREATE UNIQUE INDEX "Appointment_consultationReference_key" ON "Appointment"("consultationReference");
