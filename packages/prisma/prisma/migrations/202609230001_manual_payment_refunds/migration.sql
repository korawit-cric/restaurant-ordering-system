CREATE TYPE "PaymentClaimStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');
CREATE TYPE "RefundMethod" AS ENUM ('CASH', 'BANK_TRANSFER');

ALTER TABLE "Order"
  ADD COLUMN "paymentReference" TEXT,
  ADD COLUMN "paymentNote" TEXT;

ALTER TABLE "OrderSession"
  ADD COLUMN "paymentReference" TEXT,
  ADD COLUMN "paymentNote" TEXT;

CREATE TABLE "PaymentClaim" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" "PaymentClaimStatus" NOT NULL DEFAULT 'SUBMITTED',
  "customerReference" TEXT,
  "customerNote" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewNote" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManualRefund" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "method" "RefundMethod" NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "reference" TEXT,
  "createdBy" TEXT NOT NULL,
  "completedBy" TEXT,
  "completedAt" TIMESTAMP(3),
  "cancelledBy" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManualRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManualRefund_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "PaymentClaim_orderId_key" ON "PaymentClaim"("orderId");
CREATE UNIQUE INDEX "PaymentClaim_tenantId_branchId_orderId_key" ON "PaymentClaim"("tenantId", "branchId", "orderId");
CREATE INDEX "PaymentClaim_tenantId_branchId_status_submittedAt_idx" ON "PaymentClaim"("tenantId", "branchId", "status", "submittedAt");
CREATE INDEX "ManualRefund_tenantId_branchId_orderId_createdAt_idx" ON "ManualRefund"("tenantId", "branchId", "orderId", "createdAt");
CREATE INDEX "ManualRefund_tenantId_branchId_status_createdAt_idx" ON "ManualRefund"("tenantId", "branchId", "status", "createdAt");

ALTER TABLE "PaymentClaim" ADD CONSTRAINT "PaymentClaim_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentClaim" ADD CONSTRAINT "PaymentClaim_tenantId_branchId_orderId_fkey" FOREIGN KEY ("tenantId", "branchId", "orderId") REFERENCES "Order"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_tenantId_branchId_orderId_fkey" FOREIGN KEY ("tenantId", "branchId", "orderId") REFERENCES "Order"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
