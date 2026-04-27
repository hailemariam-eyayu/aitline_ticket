-- CreateEnum
CREATE TYPE "trnStatus" AS ENUM ('Success', 'Failed', 'Pending', 'Reversed');

-- CreateTable
CREATE TABLE "transactions" (
    "id" SERIAL NOT NULL,
    "drAcNo" TEXT NOT NULL,
    "payername" TEXT NOT NULL,
    "crAcNo" TEXT NOT NULL,
    "creditedTO" TEXT,
    "cbs_reference" TEXT,
    "trnTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trnDate" TIMESTAMP(3) NOT NULL,
    "status" "trnStatus" NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_orders" (
    "orderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "customerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_orders_pkey" PRIMARY KEY ("orderId")
);
