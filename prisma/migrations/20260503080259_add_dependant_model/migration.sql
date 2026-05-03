-- CreateTable
CREATE TABLE "Dependant" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dependant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dependant_memberId_idx" ON "Dependant"("memberId");

-- AddForeignKey
ALTER TABLE "Dependant" ADD CONSTRAINT "Dependant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
