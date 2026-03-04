-- CreateEnum
CREATE TYPE "DisbursalStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('MPESA_TILL', 'MPESA_PAYBILL', 'MPESA_MOBILE', 'BANK_TRANSFER');

-- AlterTable: Add new fields to Contribution (Payment) model
ALTER TABLE "Contribution" ADD COLUMN "paymentFrequency" "PaymentFrequency" NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "Contribution" ADD COLUMN "claimLimitsAssigned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contribution" ADD COLUMN "claimLimitsAssignedAt" TIMESTAMP(3);
ALTER TABLE "Contribution" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Contribution" ADD COLUMN "merchantRequestId" TEXT;
ALTER TABLE "Contribution" ADD COLUMN "checkoutRequestId" TEXT;
ALTER TABLE "Contribution" ADD COLUMN "mpesaReceiptNumber" TEXT;
ALTER TABLE "Contribution" ADD COLUMN "callbackUrl" TEXT;
ALTER TABLE "Contribution" ADD COLUMN "redirectUrl" TEXT;

-- CreateIndex
CREATE INDEX "Contribution_status_idx" ON "Contribution"("status");

-- CreateTable: Disbursal
CREATE TABLE "Disbursal" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "DisbursalStatus" NOT NULL DEFAULT 'PENDING',
    "paymentChannel" "PaymentChannel" NOT NULL,
    "transactionReference" TEXT NOT NULL,
    "recipientIdentifier" TEXT NOT NULL,
    "sasaPayRequestId" TEXT,
    "sasaPayCheckoutId" TEXT,
    "mpesaReceiptNumber" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,

    CONSTRAINT "Disbursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DisbursalStatusHistory
CREATE TABLE "DisbursalStatusHistory" (
    "id" TEXT NOT NULL,
    "disbursalId" TEXT NOT NULL,
    "status" "DisbursalStatus" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "DisbursalStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ClinicPaymentConfig
CREATE TABLE "ClinicPaymentConfig" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "paymentChannel" "PaymentChannel" NOT NULL,
    "tillNumber" TEXT,
    "paybillNumber" TEXT,
    "mobileNumber" TEXT,
    "bankAccountNumber" TEXT,
    "bankName" TEXT,
    "bankBranchCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicPaymentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Disbursal_claimId_key" ON "Disbursal"("claimId");
CREATE UNIQUE INDEX "Disbursal_transactionReference_key" ON "Disbursal"("transactionReference");
CREATE INDEX "Disbursal_claimId_idx" ON "Disbursal"("claimId");
CREATE INDEX "Disbursal_clinicId_idx" ON "Disbursal"("clinicId");
CREATE INDEX "Disbursal_status_idx" ON "Disbursal"("status");
CREATE INDEX "Disbursal_createdAt_idx" ON "Disbursal"("createdAt");

-- CreateIndex
CREATE INDEX "DisbursalStatusHistory_disbursalId_idx" ON "DisbursalStatusHistory"("disbursalId");
CREATE INDEX "DisbursalStatusHistory_timestamp_idx" ON "DisbursalStatusHistory"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicPaymentConfig_clinicId_key" ON "ClinicPaymentConfig"("clinicId");
CREATE INDEX "ClinicPaymentConfig_clinicId_idx" ON "ClinicPaymentConfig"("clinicId");

-- CreateIndex
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- AddForeignKey
ALTER TABLE "Disbursal" ADD CONSTRAINT "Disbursal_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Disbursal" ADD CONSTRAINT "Disbursal_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursalStatusHistory" ADD CONSTRAINT "DisbursalStatusHistory_disbursalId_fkey" FOREIGN KEY ("disbursalId") REFERENCES "Disbursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicPaymentConfig" ADD CONSTRAINT "ClinicPaymentConfig_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data Migration: Set paymentFrequency to MONTHLY for existing subscriptions
-- This is idempotent - safe to run multiple times
UPDATE "Subscription" 
SET "paymentFrequency" = 'MONTHLY' 
WHERE "paymentFrequency" IS NULL OR "paymentFrequency" = 'MONTHLY';

-- Data Migration: Set annualCapLimit based on tier for existing subscriptions
UPDATE "Subscription" 
SET "annualCapLimit" = CASE 
    WHEN "tier" = 'BRONZE' THEN 6000
    WHEN "tier" = 'SILVER' THEN 10000
    WHEN "tier" = 'GOLD' THEN 15000
    ELSE 6000
END
WHERE "annualCapLimit" = 6000; -- Only update if still at default
