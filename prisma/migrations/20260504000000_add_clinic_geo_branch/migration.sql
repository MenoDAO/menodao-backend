-- AlterTable: Add geo and branch fields to Clinic
ALTER TABLE "Clinic" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "Clinic" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Clinic" ADD COLUMN "parentClinicId" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "branchName" TEXT;

-- AddForeignKey: Self-referential relation for clinic branches
ALTER TABLE "Clinic" ADD CONSTRAINT "Clinic_parentClinicId_fkey" FOREIGN KEY ("parentClinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Clinic_parentClinicId_idx" ON "Clinic"("parentClinicId");
