-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "trackingNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "trackingUrl" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "inStock" BOOLEAN NOT NULL DEFAULT true;
