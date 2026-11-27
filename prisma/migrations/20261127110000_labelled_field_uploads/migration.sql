ALTER TABLE "FieldSubmission"
    ADD COLUMN "captionRequestedAt" TIMESTAMP(3),
    ADD COLUMN "clinicalImage" BOOLEAN NOT NULL DEFAULT false;
