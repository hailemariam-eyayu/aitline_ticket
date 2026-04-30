-- Remove unnecessary columns
ALTER TABLE "Transactions" DROP COLUMN IF EXISTS "OrderId";
ALTER TABLE "Transactions" DROP COLUMN IF EXISTS "PNR";
ALTER TABLE "Transactions" DROP COLUMN IF EXISTS "CrDr";
ALTER TABLE "Transactions" DROP COLUMN IF EXISTS "DrAcNo";
ALTER TABLE "Transactions" DROP COLUMN IF EXISTS "CrAcNo";
ALTER TABLE "Transactions" DROP COLUMN IF EXISTS "CustomerName";

-- Add AcNo (single account column — DR or CR row)
ALTER TABLE "Transactions" ADD COLUMN IF NOT EXISTS "AcNo" VARCHAR(20);

-- Add Utility and charge columns if missing
ALTER TABLE "Transactions" ADD COLUMN IF NOT EXISTS "Utility"         VARCHAR(100);
ALTER TABLE "Transactions" ADD COLUMN IF NOT EXISTS "ComAmount"       MONEY;
ALTER TABLE "Transactions" ADD COLUMN IF NOT EXISTS "DisasterRiskAmt" MONEY;
