-- Admin roles and dashboard-driven admin account management.

ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'JUNIOR_ADMIN';

ALTER TABLE "AdminUser"
    ADD COLUMN "phoneNumber" TEXT,
    ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "inviteTokenHash" TEXT,
    ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "AdminUser_phoneNumber_key" ON "AdminUser"("phoneNumber");
