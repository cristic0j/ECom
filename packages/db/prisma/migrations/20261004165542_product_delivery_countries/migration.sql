-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "notDeliveredTo" TEXT[] DEFAULT ARRAY[]::TEXT[];

