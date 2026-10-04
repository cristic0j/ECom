-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "supplier" TEXT,
ADD COLUMN     "supplierData" JSONB,
ADD COLUMN     "supplierProductId" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "costMinor" INTEGER,
ADD COLUMN     "supplierSkuId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_supplier_supplierProductId_key" ON "Product"("supplier", "supplierProductId");

