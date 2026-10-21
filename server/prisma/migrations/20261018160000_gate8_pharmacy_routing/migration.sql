-- CreateTable: Gate 8 ClinicalAssistanceAssignment (Additive)
CREATE TABLE "ClinicalAssistanceAssignment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "round" INTEGER NOT NULL DEFAULT 1,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ClinicalAssistanceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalAssistanceAssignment_requestId_pharmacyId_key" ON "ClinicalAssistanceAssignment"("requestId", "pharmacyId");

-- CreateIndex
CREATE INDEX "ClinicalAssistanceAssignment_requestId_idx" ON "ClinicalAssistanceAssignment"("requestId");

-- CreateIndex
CREATE INDEX "ClinicalAssistanceAssignment_pharmacyId_idx" ON "ClinicalAssistanceAssignment"("pharmacyId");

-- CreateIndex
CREATE INDEX "ClinicalAssistanceAssignment_status_idx" ON "ClinicalAssistanceAssignment"("status");

-- CreateIndex
CREATE INDEX "ClinicalAssistanceAssignment_assignedAt_idx" ON "ClinicalAssistanceAssignment"("assignedAt");

-- AddForeignKey
ALTER TABLE "ClinicalAssistanceAssignment" ADD CONSTRAINT "ClinicalAssistanceAssignment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClinicalAssistanceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAssistanceAssignment" ADD CONSTRAINT "ClinicalAssistanceAssignment_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
