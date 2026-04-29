-- Add auto-reversal tracking columns to FlygateTransactions, Transactions, RideTransaction

ALTER TABLE "FlygateTransactions"
    ADD COLUMN IF NOT EXISTS "AutoReversed"      SMALLINT     DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "AutoReversalRef"   VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "AutoReversalError" VARCHAR(500);

ALTER TABLE "Transactions"
    ADD COLUMN IF NOT EXISTS "AutoReversed"      SMALLINT     DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "AutoReversalRef"   VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "AutoReversalError" VARCHAR(500);

ALTER TABLE "RideTransaction"
    ADD COLUMN IF NOT EXISTS "AutoReversed"      SMALLINT     DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "AutoReversalRef"   VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "AutoReversalError" VARCHAR(500);
