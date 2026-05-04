-- Add subCounty and county to Member
ALTER TABLE "Member" ADD COLUMN "subCounty" TEXT;
ALTER TABLE "Member" ADD COLUMN "county" TEXT;
CREATE INDEX "Member_subCounty_idx" ON "Member"("subCounty");

-- Add ReminderLogStatus enum
CREATE TYPE "ReminderLogStatus" AS ENUM ('SENT', 'FAILED');

-- Create SmsReminderLog table
CREATE TABLE "SmsReminderLog" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryStatus" "ReminderLogStatus" NOT NULL,
    "providerMessageId" TEXT,

    CONSTRAINT "SmsReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SmsReminderLog_memberId_templateKey_sentAt_idx" ON "SmsReminderLog"("memberId", "templateKey", "sentAt");
CREATE INDEX "SmsReminderLog_sentAt_idx" ON "SmsReminderLog"("sentAt");
