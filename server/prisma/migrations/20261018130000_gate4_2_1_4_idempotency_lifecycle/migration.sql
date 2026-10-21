-- AlterTable
ALTER TABLE "IdempotencyRecord" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
