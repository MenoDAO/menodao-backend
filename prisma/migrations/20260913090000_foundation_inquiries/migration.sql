-- Foundation website intake forms

CREATE TYPE "FoundationInquiryKind" AS ENUM (
  'SCHOOL',
  'VOLUNTEER',
  'FACILITY',
  'CONTACT'
);

CREATE TABLE "FoundationInquiry" (
    "id" TEXT NOT NULL,
    "kind" "FoundationInquiryKind" NOT NULL,
    "formId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "summary" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FoundationInquiry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FoundationInquiry_kind_createdAt_idx" ON "FoundationInquiry"("kind", "createdAt");
CREATE INDEX "FoundationInquiry_createdAt_idx" ON "FoundationInquiry"("createdAt");
