-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PackageTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD');

-- CreateEnum
CREATE TYPE "PaymentFrequency" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('DENTAL_CHECKUP', 'DENTAL_CLEANING', 'DENTAL_FILLING', 'DENTAL_EXTRACTION', 'ROOT_CANAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'PROCESSING', 'DISBURSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('REGISTERED', 'ATTENDED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('NFT_MINT', 'CONTRIBUTION', 'CLAIM_DISBURSEMENT', 'UPGRADE');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('OPEN', 'DISCHARGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ClinicStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "XRayCapability" AS ENUM ('NONE', 'PERIAPICAL', 'OPG');

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "fullName" TEXT,
    "location" TEXT,
    "walletAddress" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "branch" TEXT,
    "preferredChain" TEXT DEFAULT 'celo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OTPCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memberId" TEXT,

    CONSTRAINT "OTPCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tier" "PackageTier" NOT NULL,
    "monthlyAmount" INTEGER NOT NULL,
    "paymentFrequency" "PaymentFrequency" NOT NULL DEFAULT 'MONTHLY',
    "subscriptionStartDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "annualCapUsed" INTEGER NOT NULL DEFAULT 0,
    "annualCapLimit" INTEGER NOT NULL DEFAULT 6000,
    "procedureUsageCount" JSONB NOT NULL DEFAULT '{}',
    "lastResetDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contribution" (
    "id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "paymentRef" TEXT,
    "txHash" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "Contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "claimType" "ClaimType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "txHash" TEXT,
    "campId" TEXT,
    "visitId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NFT" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "tier" "PackageTier" NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "mintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "NFT_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Camp" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "venue" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Camp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampRegistration" (
    "id" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "CampRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockchainTransaction" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "txType" "TransactionType" NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amount" TEXT,
    "tokenId" TEXT,
    "network" TEXT NOT NULL DEFAULT 'polygon',
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "blockNumber" INTEGER,
    "gasUsed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "memberId" TEXT,

    CONSTRAINT "BlockchainTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "branch" TEXT,
    "clinicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'OPEN',
    "totalCost" INTEGER NOT NULL DEFAULT 0,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dischargedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chiefComplaint" TEXT,
    "medicalHistory" TEXT,
    "vitals" JSONB,
    "clinicalNotes" TEXT,
    "hasConsent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireData" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "dateOfVisit" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "age" INTEGER,
    "gender" TEXT,
    "education" TEXT,
    "occupation" TEXT,
    "residenceVillage" TEXT,
    "residenceCounty" TEXT,
    "researchConsent" BOOLEAN NOT NULL DEFAULT false,
    "lastDentalVisit" TEXT,
    "drugAllergies" TEXT,
    "currentMedications" TEXT,
    "medicalConditions" JSONB,
    "familyHistory" JSONB,
    "chiefComplaint" TEXT,
    "painLevel" INTEGER,
    "recentSymptoms" JSONB,
    "brushingFrequency" TEXT,
    "flossingFrequency" TEXT,
    "sugarIntake" TEXT,
    "smokesTobacco" BOOLEAN NOT NULL DEFAULT false,
    "alcoholUse" TEXT,
    "substanceUse" BOOLEAN NOT NULL DEFAULT false,
    "oralHygieneIndex" TEXT,
    "softTissueFindings" TEXT,
    "periodontalStatus" TEXT,
    "decayedTeeth" INTEGER,
    "missingTeeth" INTEGER,
    "filledTeeth" INTEGER,
    "dmftScore" INTEGER,
    "occlusionStatus" TEXT,
    "cariesRisk" TEXT,
    "periodontalRisk" TEXT,
    "oralCancerRisk" TEXT,
    "smileSatisfaction" TEXT,
    "careConfidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Procedure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cost" INTEGER NOT NULL,
    "allowedTiers" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Procedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitProcedure" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy" TEXT NOT NULL,

    CONSTRAINT "VisitProcedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentBy" TEXT NOT NULL,
    "filterCriteria" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsLog" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "SmsStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'textsms',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteVisit" (
    "id" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clinic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subCounty" TEXT NOT NULL,
    "physicalLocation" TEXT NOT NULL,
    "googleMapsLink" TEXT,
    "operatingHours" TEXT NOT NULL,
    "operatesOnWeekends" BOOLEAN NOT NULL DEFAULT false,
    "leadDentistName" TEXT NOT NULL,
    "ownerPhone" TEXT NOT NULL,
    "managerName" TEXT,
    "whatsappNumber" TEXT NOT NULL,
    "email" TEXT,
    "mpesaTillOrPaybill" TEXT NOT NULL,
    "tillPaybillName" TEXT NOT NULL,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "kmpdcRegNumber" TEXT,
    "activeDentalChairs" INTEGER NOT NULL DEFAULT 1,
    "xrayCapability" "XRayCapability" NOT NULL DEFAULT 'NONE',
    "specializedServices" JSONB,
    "agreedToRateCard" BOOLEAN NOT NULL DEFAULT false,
    "agreedToNoChargePolicy" BOOLEAN NOT NULL DEFAULT false,
    "status" "ClinicStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clinic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_phoneNumber_key" ON "Member"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Member_walletAddress_key" ON "Member"("walletAddress");

-- CreateIndex
CREATE INDEX "OTPCode_phoneNumber_code_idx" ON "OTPCode"("phoneNumber", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_memberId_key" ON "Subscription"("memberId");

-- CreateIndex
CREATE INDEX "Subscription_subscriptionStartDate_idx" ON "Subscription"("subscriptionStartDate");

-- CreateIndex
CREATE INDEX "Subscription_paymentFrequency_idx" ON "Subscription"("paymentFrequency");

-- CreateIndex
CREATE INDEX "Contribution_memberId_month_idx" ON "Contribution"("memberId", "month");

-- CreateIndex
CREATE INDEX "Contribution_paymentRef_idx" ON "Contribution"("paymentRef");

-- CreateIndex
CREATE UNIQUE INDEX "NFT_tokenId_key" ON "NFT"("tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "CampRegistration_campId_memberId_key" ON "CampRegistration"("campId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainTransaction_txHash_key" ON "BlockchainTransaction"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_username_key" ON "StaffUser"("username");

-- CreateIndex
CREATE INDEX "Visit_memberId_idx" ON "Visit"("memberId");

-- CreateIndex
CREATE INDEX "Visit_staffId_idx" ON "Visit"("staffId");

-- CreateIndex
CREATE INDEX "Visit_status_idx" ON "Visit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireData_visitId_key" ON "QuestionnaireData"("visitId");

-- CreateIndex
CREATE INDEX "QuestionnaireData_visitId_idx" ON "QuestionnaireData"("visitId");

-- CreateIndex
CREATE INDEX "QuestionnaireData_dateOfVisit_idx" ON "QuestionnaireData"("dateOfVisit");

-- CreateIndex
CREATE UNIQUE INDEX "Procedure_code_key" ON "Procedure"("code");

-- CreateIndex
CREATE INDEX "VisitProcedure_visitId_idx" ON "VisitProcedure"("visitId");

-- CreateIndex
CREATE INDEX "VisitProcedure_procedureId_idx" ON "VisitProcedure"("procedureId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_memberId_idx" ON "DeviceToken"("memberId");

-- CreateIndex
CREATE INDEX "Notification_type_sentAt_idx" ON "Notification"("type", "sentAt");

-- CreateIndex
CREATE INDEX "Notification_sentBy_idx" ON "Notification"("sentBy");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "SmsLog_createdAt_idx" ON "SmsLog"("createdAt");

-- CreateIndex
CREATE INDEX "SmsLog_phoneNumber_idx" ON "SmsLog"("phoneNumber");

-- CreateIndex
CREATE INDEX "SiteVisit_createdAt_idx" ON "SiteVisit"("createdAt");

-- CreateIndex
CREATE INDEX "SiteVisit_utmSource_idx" ON "SiteVisit"("utmSource");

-- CreateIndex
CREATE INDEX "SiteVisit_sessionId_idx" ON "SiteVisit"("sessionId");

-- CreateIndex
CREATE INDEX "Clinic_status_idx" ON "Clinic"("status");

-- CreateIndex
CREATE INDEX "Clinic_subCounty_idx" ON "Clinic"("subCounty");

-- AddForeignKey
ALTER TABLE "OTPCode" ADD CONSTRAINT "OTPCode_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_campId_fkey" FOREIGN KEY ("campId") REFERENCES "Camp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NFT" ADD CONSTRAINT "NFT_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampRegistration" ADD CONSTRAINT "CampRegistration_campId_fkey" FOREIGN KEY ("campId") REFERENCES "Camp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampRegistration" ADD CONSTRAINT "CampRegistration_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockchainTransaction" ADD CONSTRAINT "BlockchainTransaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffUser" ADD CONSTRAINT "StaffUser_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireData" ADD CONSTRAINT "QuestionnaireData_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitProcedure" ADD CONSTRAINT "VisitProcedure_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitProcedure" ADD CONSTRAINT "VisitProcedure_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_sentBy_fkey" FOREIGN KEY ("sentBy") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

