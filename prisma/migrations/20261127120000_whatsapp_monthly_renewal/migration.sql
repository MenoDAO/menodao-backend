ALTER TABLE "Member"
    ADD COLUMN "whatsappRenewalOptIn" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "whatsappRenewalPeriod" TEXT;
