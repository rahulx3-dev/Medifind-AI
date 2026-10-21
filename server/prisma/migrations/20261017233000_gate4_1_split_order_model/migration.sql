-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "isParentOrder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentOrderId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "fulfilledQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "unfulfilledReason" TEXT;

-- CreateIndex
CREATE INDEX "Order_parentOrderId_idx" ON "Order"("parentOrderId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_status_idx" ON "OrderItem"("status");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
