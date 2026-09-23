-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "priceMinMinor" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Product_priceMinMinor_idx" ON "Product"("priceMinMinor");
