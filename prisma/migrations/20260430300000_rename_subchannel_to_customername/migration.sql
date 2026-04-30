-- Rename SubChannel to CustomerName (stores credited party name)
ALTER TABLE "Transactions" RENAME COLUMN "SubChannel" TO "CustomerName";
-- Widen to 500 chars to hold full names
ALTER TABLE "Transactions" ALTER COLUMN "CustomerName" TYPE VARCHAR(500);
