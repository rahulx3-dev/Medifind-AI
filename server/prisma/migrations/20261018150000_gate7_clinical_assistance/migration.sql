-- CreateTable: Gate 7 Human Clinical Assistance Requests (Additive)
CREATE TABLE "ClinicalAssistanceRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "translatedText" TEXT,
    "inputMethod" TEXT NOT NULL DEFAULT 'TEXT',
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "emergencyGuidance" TEXT,
    "clinicianResponse" TEXT,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalAssistanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalAssistanceRequest_requestNumber_key" ON "ClinicalAssistanceRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "ClinicalAssistanceRequest_patientId_idx" ON "ClinicalAssistanceRequest"("patientId");

-- CreateIndex
CREATE INDEX "ClinicalAssistanceRequest_status_idx" ON "ClinicalAssistanceRequest"("status");

-- CreateIndex
CREATE INDEX "ClinicalAssistanceRequest_createdAt_idx" ON "ClinicalAssistanceRequest"("createdAt");

-- CreateIndex
CREATE INDEX "ClinicalAssistanceRequest_respondedById_idx" ON "ClinicalAssistanceRequest"("respondedById");

-- AddForeignKey
ALTER TABLE "ClinicalAssistanceRequest" ADD CONSTRAINT "ClinicalAssistanceRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAssistanceRequest" ADD CONSTRAINT "ClinicalAssistanceRequest_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
