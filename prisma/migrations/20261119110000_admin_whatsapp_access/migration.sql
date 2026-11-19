-- Admin record access from WhatsApp: one member at a time, SMS second factor,
-- separate OTP table so member auth cannot invalidate an admin challenge.

CREATE TABLE "AdminWhatsappSession" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminPhone" TEXT NOT NULL,
    "memberId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_MEMBER',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "verifiedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminWhatsappSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminWhatsappSession_adminId_createdAt_idx" ON "AdminWhatsappSession"("adminId", "createdAt");
CREATE INDEX "AdminWhatsappSession_adminId_status_idx" ON "AdminWhatsappSession"("adminId", "status");
CREATE INDEX "AdminWhatsappSession_status_expiresAt_idx" ON "AdminWhatsappSession"("status", "expiresAt");

CREATE TABLE "AdminOtpCode" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminOtpCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminOtpCode_adminId_createdAt_idx" ON "AdminOtpCode"("adminId", "createdAt");
CREATE INDEX "AdminOtpCode_phoneNumber_code_idx" ON "AdminOtpCode"("phoneNumber", "code");
