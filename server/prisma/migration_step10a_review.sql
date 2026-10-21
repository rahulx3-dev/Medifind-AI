-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "activeImageId" TEXT,
ADD COLUMN     "sampleId" TEXT,
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'IMAGE_UPLOAD',
ADD COLUMN     "verificationSource" TEXT NOT NULL DEFAULT 'LEGACY_DETECTED';

-- CreateTable
CREATE TABLE "PrescriptionImage" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "parentImageId" TEXT,
    "cropCoordinates" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionOcrRun" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "imageId" TEXT,
    "engineName" TEXT NOT NULL DEFAULT 'TESSERACT_OCR',
    "engineVersion" TEXT,
    "executionTimeMs" INTEGER,
    "rawOcrText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionOcrRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionOcrCandidate" (
    "id" TEXT NOT NULL,
    "ocrRunId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "normalizedName" TEXT,
    "matchedMedicineId" TEXT,
    "matchedMedicineName" TEXT,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "boundingBox" TEXT,
    "dosage" TEXT,
    "frequency" TEXT,
    "duration" TEXT,
    "extractedQuantity" INTEGER,
    "suggestedInstruction" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionOcrCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionItem" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "sourceCandidateId" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
    "prescribedName" TEXT NOT NULL,
    "dosage" TEXT,
    "frequency" TEXT,
    "duration" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "instructions" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionClarification" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "pharmacistId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "response" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionClarification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionAuditLog" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "prescriptionIdSnapshot" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrescriptionImage_prescriptionId_idx" ON "PrescriptionImage"("prescriptionId");

-- CreateIndex
CREATE INDEX "PrescriptionImage_fileSha256_idx" ON "PrescriptionImage"("fileSha256");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionImage_prescriptionId_versionNumber_key" ON "PrescriptionImage"("prescriptionId", "versionNumber");

-- CreateIndex
CREATE INDEX "PrescriptionOcrRun_prescriptionId_idx" ON "PrescriptionOcrRun"("prescriptionId");

-- CreateIndex
CREATE INDEX "PrescriptionOcrRun_imageId_idx" ON "PrescriptionOcrRun"("imageId");

-- CreateIndex
CREATE INDEX "PrescriptionOcrRun_status_idx" ON "PrescriptionOcrRun"("status");

-- CreateIndex
CREATE INDEX "PrescriptionOcrCandidate_ocrRunId_idx" ON "PrescriptionOcrCandidate"("ocrRunId");

-- CreateIndex
CREATE INDEX "PrescriptionOcrCandidate_matchedMedicineId_idx" ON "PrescriptionOcrCandidate"("matchedMedicineId");

-- CreateIndex
CREATE INDEX "PrescriptionItem_prescriptionId_idx" ON "PrescriptionItem"("prescriptionId");

-- CreateIndex
CREATE INDEX "PrescriptionItem_medicineId_idx" ON "PrescriptionItem"("medicineId");

-- CreateIndex
CREATE INDEX "PrescriptionItem_sourceCandidateId_idx" ON "PrescriptionItem"("sourceCandidateId");

-- CreateIndex
CREATE INDEX "PrescriptionItem_sourceType_idx" ON "PrescriptionItem"("sourceType");

-- CreateIndex
CREATE INDEX "PrescriptionClarification_orderId_idx" ON "PrescriptionClarification"("orderId");

-- CreateIndex
CREATE INDEX "PrescriptionClarification_prescriptionId_idx" ON "PrescriptionClarification"("prescriptionId");

-- CreateIndex
CREATE INDEX "PrescriptionClarification_pharmacyId_idx" ON "PrescriptionClarification"("pharmacyId");

-- CreateIndex
CREATE INDEX "PrescriptionClarification_patientId_idx" ON "PrescriptionClarification"("patientId");

-- CreateIndex
CREATE INDEX "PrescriptionClarification_pharmacistId_idx" ON "PrescriptionClarification"("pharmacistId");

-- CreateIndex
CREATE INDEX "PrescriptionClarification_status_idx" ON "PrescriptionClarification"("status");

-- CreateIndex
CREATE INDEX "PrescriptionAuditLog_prescriptionId_idx" ON "PrescriptionAuditLog"("prescriptionId");

-- CreateIndex
CREATE INDEX "PrescriptionAuditLog_prescriptionIdSnapshot_idx" ON "PrescriptionAuditLog"("prescriptionIdSnapshot");

-- CreateIndex
CREATE INDEX "PrescriptionAuditLog_actorId_idx" ON "PrescriptionAuditLog"("actorId");

-- CreateIndex
CREATE INDEX "PrescriptionAuditLog_action_idx" ON "PrescriptionAuditLog"("action");

-- CreateIndex
CREATE INDEX "PrescriptionAuditLog_createdAt_idx" ON "PrescriptionAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_activeImageId_key" ON "Prescription"("activeImageId");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_activeImageId_fkey" FOREIGN KEY ("activeImageId") REFERENCES "PrescriptionImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionImage" ADD CONSTRAINT "PrescriptionImage_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionImage" ADD CONSTRAINT "PrescriptionImage_parentImageId_fkey" FOREIGN KEY ("parentImageId") REFERENCES "PrescriptionImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionOcrRun" ADD CONSTRAINT "PrescriptionOcrRun_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionOcrRun" ADD CONSTRAINT "PrescriptionOcrRun_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "PrescriptionImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionOcrCandidate" ADD CONSTRAINT "PrescriptionOcrCandidate_ocrRunId_fkey" FOREIGN KEY ("ocrRunId") REFERENCES "PrescriptionOcrRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_sourceCandidateId_fkey" FOREIGN KEY ("sourceCandidateId") REFERENCES "PrescriptionOcrCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionClarification" ADD CONSTRAINT "PrescriptionClarification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionClarification" ADD CONSTRAINT "PrescriptionClarification_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionClarification" ADD CONSTRAINT "PrescriptionClarification_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionClarification" ADD CONSTRAINT "PrescriptionClarification_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionClarification" ADD CONSTRAINT "PrescriptionClarification_pharmacistId_fkey" FOREIGN KEY ("pharmacistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionAuditLog" ADD CONSTRAINT "PrescriptionAuditLog_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionAuditLog" ADD CONSTRAINT "PrescriptionAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
