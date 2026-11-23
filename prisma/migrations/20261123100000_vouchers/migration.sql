-- Foundation voucher batches and individual voucher codes.
-- Purely additive: no existing table or column is altered.

CREATE TYPE "VoucherStatus" AS ENUM ('ISSUED', 'REDEEMED', 'EXPIRED', 'VOID');

CREATE TABLE "VoucherBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "codePrefix" TEXT NOT NULL,
    "note" TEXT,
    "totalInt" INTEGER NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VoucherBatch_createdAt_idx" ON "VoucherBatch"("createdAt");

CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedToName" TEXT,
    "issuedToPhone" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "redeemedByAdminId" TEXT,
    "redemptionNotes" TEXT,
    "sharedChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Voucher_code_key" ON "Voucher"("code");
CREATE INDEX "Voucher_status_createdAt_idx" ON "Voucher"("status", "createdAt");
CREATE INDEX "Voucher_batchId_idx" ON "Voucher"("batchId");
CREATE INDEX "Voucher_code_idx" ON "Voucher"("code");

ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "VoucherBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
