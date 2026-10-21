-- AlterTable
ALTER TABLE "PrescriptionOcrCandidate" ADD COLUMN     "isRejected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "PrescriptionItem" ADD COLUMN     "patientNotes" TEXT;

-- CreateIndex
CREATE INDEX "PrescriptionOcrCandidate_isRejected_idx" ON "PrescriptionOcrCandidate"("isRejected");
