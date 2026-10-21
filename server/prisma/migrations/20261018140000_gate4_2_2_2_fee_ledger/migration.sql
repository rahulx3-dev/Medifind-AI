-- AlterTable
ALTER TABLE "Order" ADD COLUMN "feeStatus" TEXT DEFAULT 'UNALLOCATED';
ALTER TABLE "Order" ADD COLUMN "feePayingChildOrderId" TEXT;
ALTER TABLE "Order" ADD COLUMN "feePaidAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_feePayingChildOrderId_idx" ON "Order"("feePayingChildOrderId");
