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

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireData_visitId_key" ON "QuestionnaireData"("visitId");

-- CreateIndex
CREATE INDEX "QuestionnaireData_visitId_idx" ON "QuestionnaireData"("visitId");

-- CreateIndex
CREATE INDEX "QuestionnaireData_dateOfVisit_idx" ON "QuestionnaireData"("dateOfVisit");

-- AddForeignKey
ALTER TABLE "QuestionnaireData" ADD CONSTRAINT "QuestionnaireData_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
