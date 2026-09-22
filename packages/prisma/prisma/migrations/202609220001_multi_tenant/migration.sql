-- Preserve the POC as one starter tenant before replacing its table-specific schema.
BEGIN;
ALTER TYPE "UserRole" RENAME TO "_legacy_UserRole";
ALTER TYPE "OrderStatus" RENAME TO "_legacy_OrderStatus";
ALTER TYPE "PaymentStatus" RENAME TO "_legacy_PaymentStatus";
ALTER TYPE "PaymentMethod" RENAME TO "_legacy_PaymentMethod";
ALTER TABLE "User" RENAME TO "_legacy_User";
ALTER TABLE "Session" RENAME TO "_legacy_Session";
ALTER TABLE "Table" RENAME TO "_legacy_Table";
ALTER TABLE "MenuCategory" RENAME TO "_legacy_MenuCategory";
ALTER TABLE "MenuItem" RENAME TO "_legacy_MenuItem";
ALTER TABLE "Order" RENAME TO "_legacy_Order";
ALTER TABLE "OrderItem" RENAME TO "_legacy_OrderItem";
ALTER TABLE "Payment" RENAME TO "_legacy_Payment";
-- PostgreSQL keeps old index names on renamed tables; move those names aside.
DO $$ DECLARE idx record; BEGIN
  FOR idx IN SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename LIKE '_legacy_%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', idx.indexname, '_legacy_' || idx.indexname);
  END LOOP;
END $$;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QrMode" AS ENUM ('PERMANENT', 'SESSION');

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('SINGLE_ORDER', 'OPEN_SESSION');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('PER_ORDER', 'AT_CHECKOUT', 'STAFF_MANAGED');

-- CreateEnum
CREATE TYPE "FulfillmentMode" AS ENUM ('SERVE_TO_LOCATION', 'PICKUP');

-- CreateEnum
CREATE TYPE "ServicePointType" AS ENUM ('TABLE', 'BAR_SEAT', 'ZONE', 'COUNTER', 'PICKUP', 'OTHER');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PROMPTPAY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "branchId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branchLimit" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextOrderNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchUser" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchSettings" (
    "branchId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "qrMode" "QrMode" NOT NULL,
    "sessionMode" "SessionMode" NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "fulfillmentMode" "FulfillmentMode" NOT NULL,
    "promptpayId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchSettings_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Main menu',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ServicePointType" NOT NULL DEFAULT 'TABLE',
    "qrToken" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "servicePointId" TEXT,
    "label" TEXT,
    "description" TEXT,
    "token" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "paymentMethod" "PaymentMethod",
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "confirmedBy" TEXT,

    CONSTRAINT "OrderSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sessionId" TEXT,
    "servicePointId" TEXT,
    "locationSnapshot" TEXT,
    "orderNumber" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "paymentMethod" "PaymentMethod",
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "subtotal" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "productNameSnapshot" TEXT NOT NULL,
    "unitPriceSnapshot" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "lineTotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE INDEX "Subscription_status_createdAt_idx" ON "Subscription"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Branch_tenantId_status_idx" ON "Branch"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_tenantId_id_key" ON "Branch"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_tenantId_slug_key" ON "Branch"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "BranchUser_tenantId_branchId_role_idx" ON "BranchUser"("tenantId", "branchId", "role");

-- CreateIndex
CREATE INDEX "BranchUser_userId_active_idx" ON "BranchUser"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "BranchUser_userId_branchId_key" ON "BranchUser"("userId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSettings_tenantId_branchId_key" ON "BranchSettings"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "Menu_tenantId_branchId_active_idx" ON "Menu"("tenantId", "branchId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Menu_tenantId_branchId_id_key" ON "Menu"("tenantId", "branchId", "id");

-- CreateIndex
CREATE INDEX "MenuCategory_tenantId_branchId_menuId_sortOrder_idx" ON "MenuCategory"("tenantId", "branchId", "menuId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategory_tenantId_branchId_id_key" ON "MenuCategory"("tenantId", "branchId", "id");

-- CreateIndex
CREATE INDEX "Product_tenantId_branchId_categoryId_sortOrder_idx" ON "Product"("tenantId", "branchId", "categoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "Product_tenantId_branchId_active_available_idx" ON "Product"("tenantId", "branchId", "active", "available");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_branchId_id_key" ON "Product"("tenantId", "branchId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePoint_qrToken_key" ON "ServicePoint"("qrToken");

-- CreateIndex
CREATE INDEX "ServicePoint_tenantId_branchId_active_idx" ON "ServicePoint"("tenantId", "branchId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePoint_tenantId_branchId_id_key" ON "ServicePoint"("tenantId", "branchId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePoint_tenantId_branchId_name_key" ON "ServicePoint"("tenantId", "branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSession_token_key" ON "OrderSession"("token");

-- CreateIndex
CREATE INDEX "OrderSession_tenantId_branchId_status_openedAt_idx" ON "OrderSession"("tenantId", "branchId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "OrderSession_tenantId_branchId_servicePointId_status_idx" ON "OrderSession"("tenantId", "branchId", "servicePointId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSession_tenantId_branchId_id_key" ON "OrderSession"("tenantId", "branchId", "id");

-- CreateIndex
CREATE INDEX "Order_tenantId_branchId_status_createdAt_idx" ON "Order"("tenantId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_tenantId_branchId_sessionId_createdAt_idx" ON "Order"("tenantId", "branchId", "sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_tenantId_branchId_paymentStatus_paidAt_idx" ON "Order"("tenantId", "branchId", "paymentStatus", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_requestKey_key" ON "Order"("tenantId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_branchId_orderNumber_key" ON "Order"("tenantId", "branchId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_branchId_id_key" ON "Order"("tenantId", "branchId", "id");

-- CreateIndex
CREATE INDEX "OrderItem_tenantId_branchId_orderId_idx" ON "OrderItem"("tenantId", "branchId", "orderId");

-- CreateIndex
CREATE INDEX "OrderItem_tenantId_branchId_productId_idx" ON "OrderItem"("tenantId", "branchId", "productId");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchUser" ADD CONSTRAINT "BranchUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchUser" ADD CONSTRAINT "BranchUser_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchUser" ADD CONSTRAINT "BranchUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchSettings" ADD CONSTRAINT "BranchSettings_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_tenantId_branchId_menuId_fkey" FOREIGN KEY ("tenantId", "branchId", "menuId") REFERENCES "Menu"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_branchId_menuId_fkey" FOREIGN KEY ("tenantId", "branchId", "menuId") REFERENCES "Menu"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_branchId_categoryId_fkey" FOREIGN KEY ("tenantId", "branchId", "categoryId") REFERENCES "MenuCategory"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePoint" ADD CONSTRAINT "ServicePoint_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSession" ADD CONSTRAINT "OrderSession_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSession" ADD CONSTRAINT "OrderSession_tenantId_branchId_servicePointId_fkey" FOREIGN KEY ("tenantId", "branchId", "servicePointId") REFERENCES "ServicePoint"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_branchId_sessionId_fkey" FOREIGN KEY ("tenantId", "branchId", "sessionId") REFERENCES "OrderSession"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_branchId_servicePointId_fkey" FOREIGN KEY ("tenantId", "branchId", "servicePointId") REFERENCES "ServicePoint"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_tenantId_branchId_orderId_fkey" FOREIGN KEY ("tenantId", "branchId", "orderId") REFERENCES "Order"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_tenantId_branchId_productId_fkey" FOREIGN KEY ("tenantId", "branchId", "productId") REFERENCES "Product"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Branch limits are data, not hard-coded prices. Operators can configure billing later.
INSERT INTO "Plan" ("id","name","branchLimit","active","createdAt") VALUES
 ('starter','Starter',1,true,now()),('standard','Standard',2,true,now());
CREATE UNIQUE INDEX "OrderSession_one_open_service_point" ON "OrderSession" ("tenantId","branchId","servicePointId") WHERE "status"='OPEN' AND "servicePointId" IS NOT NULL;
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_nonnegative" CHECK ("price" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0 AND "unitPriceSnapshot" >= 0 AND "lineTotal" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_valid" CHECK ("subtotal" >= 0 AND "total" >= 0 AND "subtotal" = "total");
ALTER TABLE "OrderSession" ADD CONSTRAINT "OrderSession_subtotal_nonnegative" CHECK ("subtotal" >= 0);
CREATE TEMP TABLE legacy_context (tenant_id TEXT, branch_id TEXT, menu_id TEXT);
INSERT INTO legacy_context
SELECT gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text
WHERE EXISTS (SELECT 1 FROM "_legacy_User") OR EXISTS (SELECT 1 FROM "_legacy_Table")
   OR EXISTS (SELECT 1 FROM "_legacy_MenuCategory") OR EXISTS (SELECT 1 FROM "_legacy_Order");
INSERT INTO "Tenant" ("id","name","slug","status","createdAt","updatedAt")
SELECT tenant_id,'Original restaurant','legacy-' || substring(tenant_id,1,8),'ACTIVE',now(),now() FROM legacy_context;
INSERT INTO "Subscription" ("id","tenantId","planId","status","createdAt","updatedAt")
SELECT gen_random_uuid()::text,tenant_id,'standard','ACTIVE',now(),now() FROM legacy_context;
INSERT INTO "Branch" ("id","tenantId","name","slug","timezone","status","nextOrderNumber","createdAt","updatedAt")
SELECT branch_id,tenant_id,'Main branch','main','Asia/Bangkok','ACTIVE',1,now(),now() FROM legacy_context;
INSERT INTO "BranchSettings" ("branchId","tenantId","preset","qrMode","sessionMode","paymentMode","fulfillmentMode","updatedAt")
SELECT branch_id,tenant_id,'LEGACY_BAR','PERMANENT','SINGLE_ORDER','PER_ORDER','SERVE_TO_LOCATION',now() FROM legacy_context;
INSERT INTO "Menu" ("id","tenantId","branchId","name","active","createdAt","updatedAt")
SELECT menu_id,tenant_id,branch_id,'Main menu',true,now(),now() FROM legacy_context;
INSERT INTO "User" ("id","email","passwordHash","platformRole","active","createdAt","updatedAt")
SELECT "id","email","passwordHash",'USER',"active","createdAt",now() FROM "_legacy_User";
INSERT INTO "BranchUser" ("id","tenantId","branchId","userId","role","active","createdAt")
SELECT gen_random_uuid()::text,c.tenant_id,c.branch_id,u."id",
 CASE WHEN u."role"::text='ADMIN' THEN 'OWNER'::"MemberRole" ELSE 'STAFF'::"MemberRole" END,
 u."active",u."createdAt" FROM "_legacy_User" u CROSS JOIN legacy_context c;
INSERT INTO "AuthSession" ("tokenHash","userId","tenantId","branchId","expiresAt","createdAt")
SELECT s."tokenHash",s."userId",c.tenant_id,c.branch_id,s."expiresAt",now()
FROM "_legacy_Session" s CROSS JOIN legacy_context c;
INSERT INTO "ServicePoint" ("id","tenantId","branchId","name","type","qrToken","active","createdAt","updatedAt")
SELECT t."id",c.tenant_id,c.branch_id,t."name",'TABLE',t."qrToken",t."active",t."createdAt",t."updatedAt"
FROM "_legacy_Table" t CROSS JOIN legacy_context c;
INSERT INTO "MenuCategory" ("id","tenantId","branchId","menuId","name","sortOrder","active")
SELECT m."id",c.tenant_id,c.branch_id,c.menu_id,m."name",m."sortOrder",m."active"
FROM "_legacy_MenuCategory" m CROSS JOIN legacy_context c;
INSERT INTO "Product" ("id","tenantId","branchId","menuId","categoryId","name","description","imageUrl","price","active","available","sortOrder","createdAt","updatedAt")
SELECT m."id",c.tenant_id,c.branch_id,c.menu_id,m."categoryId",m."name",m."description",m."imageUrl",m."price",m."active",m."available",m."sortOrder",m."createdAt",m."updatedAt"
FROM "_legacy_MenuItem" m CROSS JOIN legacy_context c;
INSERT INTO "Order" ("id","tenantId","branchId","servicePointId","locationSnapshot","orderNumber","requestKey","requestHash","status","paymentMethod","paymentStatus","subtotal","total","paidAt","confirmedBy","createdAt","updatedAt")
SELECT o."id",c.tenant_id,c.branch_id,o."tableId",o."tableName",o."orderNumber",o."requestKey",o."requestHash",
 CASE WHEN o."status"::text='SERVED' THEN 'COMPLETED'::"OrderStatus" ELSE o."status"::text::"OrderStatus" END,
 CASE WHEN p."method"::text='QR' THEN 'PROMPTPAY'::"PaymentMethod" WHEN p."method" IS NULL THEN NULL ELSE 'CASH'::"PaymentMethod" END,
 COALESCE(p."status"::text::"PaymentStatus",'PENDING'::"PaymentStatus"),o."total",o."total",p."paidAt",p."confirmedBy",o."createdAt",o."updatedAt"
FROM "_legacy_Order" o CROSS JOIN legacy_context c LEFT JOIN "_legacy_Payment" p ON p."orderId"=o."id";
INSERT INTO "OrderItem" ("id","tenantId","branchId","orderId","productId","productNameSnapshot","unitPriceSnapshot","quantity","lineTotal")
SELECT i."id",c.tenant_id,c.branch_id,i."orderId",i."menuItemId",i."name",i."unitPrice",i."quantity",i."lineTotal"
FROM "_legacy_OrderItem" i CROSS JOIN legacy_context c;
UPDATE "Branch" SET "nextOrderNumber" = COALESCE((SELECT max("orderNumber") + 1 FROM "Order"),1)
WHERE "id" IN (SELECT branch_id FROM legacy_context);
DROP TABLE "_legacy_OrderItem", "_legacy_Payment", "_legacy_Order", "_legacy_MenuItem", "_legacy_MenuCategory", "_legacy_Table", "_legacy_Session", "_legacy_User" CASCADE;
DROP TYPE "_legacy_UserRole", "_legacy_OrderStatus", "_legacy_PaymentStatus", "_legacy_PaymentMethod";
COMMIT;
