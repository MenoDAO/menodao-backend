-- Add Web3/Filecoin/Hypercert fields to Visit table
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "beforeCID" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "afterCID" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "web3VerificationStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "caseOnChainId" INTEGER;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "onChainTxHash" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "payoutTxHash" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "hypercertData" JSONB;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "aiVerificationResult" JSONB;

-- Index for quick lookup of pending web3 cases
CREATE INDEX IF NOT EXISTS "Visit_web3VerificationStatus_idx" ON "Visit"("web3VerificationStatus");
