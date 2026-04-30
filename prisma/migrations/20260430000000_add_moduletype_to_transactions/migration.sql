-- Add ModuleType column to Transactions table
ALTER TABLE "Transactions"
    ADD COLUMN IF NOT EXISTS "ModuleType" SMALLINT;
