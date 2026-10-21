-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "prescriptionItemId" TEXT;

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'SPLIT_ORDER_CREATION',
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL DEFAULT 201,
    "responseBody" TEXT NOT NULL,
    "parentOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderItem_prescriptionItemId_idx" ON "OrderItem"("prescriptionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_action_key_key" ON "IdempotencyRecord"("userId", "action", "key");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_parentOrderId_idx" ON "IdempotencyRecord"("parentOrderId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_prescriptionItemId_fkey" FOREIGN KEY ("prescriptionItemId") REFERENCES "PrescriptionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
