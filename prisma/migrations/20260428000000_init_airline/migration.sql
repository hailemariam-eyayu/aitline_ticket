-- ============================================================
-- Init: airline-only tables
-- Drops legacy tables first (safe with IF EXISTS)
-- ============================================================

-- Drop legacy tables that no longer belong in this schema
DROP TABLE IF EXISTS "WatchlistItem" CASCADE;
DROP TABLE IF EXISTS "Movie" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;
DROP TABLE IF EXISTS "GlConfiguration" CASCADE;
DROP TABLE IF EXISTS "TransactionLedger" CASCADE;
DROP TABLE IF EXISTS "transactions" CASCADE;
DROP TABLE IF EXISTS "pending_orders" CASCADE;
DROP TYPE IF EXISTS "watchlistStatus" CASCADE;
DROP TYPE IF EXISTS "trnStatus" CASCADE;

-- Drop existing airline tables so we can recreate with updated columns
DROP TABLE IF EXISTS "FLYGATEDetails" CASCADE;
DROP TABLE IF EXISTS "FlygateTransactions" CASCADE;
DROP TABLE IF EXISTS "Transactions" CASCADE;
DROP TABLE IF EXISTS "RefundLedger" CASCADE;
DROP TABLE IF EXISTS "FlyGateReqRes" CASCADE;
DROP TABLE IF EXISTS "CbsReqRes" CASCADE;

-- ─── FlyGate raw request/response log ────────────────────────────────────────
CREATE TABLE "FlyGateReqRes" (
    "auto"      SERIAL      NOT NULL,
    "OrderId"   VARCHAR(20),
    "type"      INTEGER     NOT NULL,
    "CreatedAt" TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Data"      JSONB       NOT NULL,
    CONSTRAINT "FlyGateReqRes_pkey" PRIMARY KEY ("auto")
);

-- ─── CBS raw request/response log ────────────────────────────────────────────
CREATE TABLE "CbsReqRes" (
    "auto"      SERIAL      NOT NULL,
    "OrderId"   VARCHAR(20),
    "type"      INTEGER     NOT NULL,
    "CreatedAt" TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Data"      TEXT        NOT NULL,
    CONSTRAINT "CbsReqRes_pkey" PRIMARY KEY ("auto")
);

-- ─── FlyGate audit / pending orders ──────────────────────────────────────────
CREATE TABLE "FLYGATEDetails" (
    "auto"            BIGSERIAL    NOT NULL,
    "orderId"         VARCHAR(20)  NOT NULL,
    "reqType"         INTEGER      NOT NULL,
    "RESPCODE"        VARCHAR(10)  NOT NULL,
    "RESPRESULT"      TEXT         NOT NULL,
    "AMOUNT"          MONEY        NOT NULL,
    "traceNumber"     VARCHAR(50)  NOT NULL,
    "orderStatusCode" INTEGER      NOT NULL,
    "resultDesc"      VARCHAR(100) NOT NULL,
    "CBSRefNo"        VARCHAR(50)  NOT NULL,
    "isRefund"        SMALLINT     NOT NULL,
    "CustomerName"    VARCHAR(500),
    "PNR"             VARCHAR(25),
    "Currency"        VARCHAR(5),
    "entryDate"       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FLYGATEDetails_pkey" PRIMARY KEY ("auto")
);

-- ─── Confirmed FlyGate transactions ──────────────────────────────────────────
CREATE TABLE "FlygateTransactions" (
    "CODE"               SERIAL       NOT NULL,
    "OrderId"            VARCHAR(20),
    "TrnDate"            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "DrAcNO"             VARCHAR(50),
    "CrAcNO"             VARCHAR(50),
    "CUSTOMERNAME"       VARCHAR(500),
    "FIRSTNAME"          VARCHAR(200),
    "LASTNAME"           VARCHAR(200),
    "MOBILENO"           VARCHAR(50),
    "PNR"                VARCHAR(25),
    "Amount"             MONEY,
    "Currency"           VARCHAR(5),
    "Remarks"            VARCHAR(500),
    "STATUS"             DECIMAL,
    "TraceNumber"        VARCHAR(150),
    "BatchId"            VARCHAR(150),
    "BankRefNo"          VARCHAR(500),
    "ProcessedDate"      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Channel"            VARCHAR(20),
    "UtilRefNo"          VARCHAR(50),
    "FAULTCODE"          DECIMAL,
    "FAULTSTRING"        TEXT,
    "IsRefund"           SMALLINT,
    "RefundStatus"       SMALLINT,
    "RefundReferenceCode" VARCHAR(250),
    "OrgPNR"             VARCHAR(25),
    "OrgBankRefNo"       VARCHAR(500),
    "EntryDate"          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlygateTransactions_pkey" PRIMARY KEY ("CODE")
);

-- ─── CBS transaction journal ──────────────────────────────────────────────────
CREATE TABLE "Transactions" (
    "Auto"          SERIAL       NOT NULL,
    "OrderId"       VARCHAR(20),
    "PNR"           VARCHAR(25),
    "TrnDate"       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ProcessedTime" TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "DrAcNo"        VARCHAR(50),
    "CrAcNo"        VARCHAR(50),
    "BranchCode"    VARCHAR(10),
    "Amount"        MONEY,
    "CurrencyCode"  VARCHAR(5),
    "CustomerName"  VARCHAR(500),
    "CustIden"      VARCHAR(50),
    "CBSRefNo"      VARCHAR(50),
    "TraceNumber"   VARCHAR(150),
    "BatchId"       VARCHAR(50),
    "ScrollId"      VARCHAR(50),
    "UtilRefNo"     VARCHAR(100),
    "UniqueId"      VARCHAR(50),
    "CrDr"          VARCHAR(6),
    "Remarks"       VARCHAR(500),
    "Particulars"   VARCHAR(500),
    "Status"        SMALLINT,
    "Channel"       VARCHAR(10),
    "SubChannel"    VARCHAR(10),
    "FAULTCODE"     DECIMAL,
    "FAULTSTRING"   TEXT,
    "EntryTime"     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transactions_pkey" PRIMARY KEY ("Auto")
);

CREATE UNIQUE INDEX "Transactions_UniqueId_key" ON "Transactions"("UniqueId");

-- ─── Refund ledger ────────────────────────────────────────────────────────────
CREATE TABLE "RefundLedger" (
    "Auto"                SERIAL       NOT NULL,
    "ReceiveDate"         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ShortCode"           VARCHAR(10),
    "OrderId"             VARCHAR(20),
    "Amount"              MONEY,
    "CBSRefNumber"        VARCHAR(50),
    "FLYRefundCode"       VARCHAR(30),
    "AcknowledgeStatus"   SMALLINT,
    "AcknowledgDesc"      VARCHAR(50),
    "RefundStatus"        SMALLINT,
    "RefundCBSRef"        VARCHAR(50),
    "RefundDate"          TIMESTAMP,
    "RefundDesc"          VARCHAR(100),
    "ConfirmRefundStatus" SMALLINT,
    "ConfirmRefundDate"   TIMESTAMP,
    "status"              SMALLINT,
    CONSTRAINT "RefundLedger_pkey" PRIMARY KEY ("Auto")
);
