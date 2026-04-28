-- Add generic CBS transfer audit table
CREATE TABLE "CbsTransfer" (
    "id"          SERIAL        NOT NULL,
    "Channel"     VARCHAR(30)   NOT NULL,
    "PRD"         VARCHAR(20)   NOT NULL,
    "DrAcNo"      VARCHAR(50)   NOT NULL,
    "CrAcNo"      VARCHAR(50)   NOT NULL,
    "DrBranch"    VARCHAR(10),
    "CrBranch"    VARCHAR(10),
    "Amount"      MONEY         NOT NULL,
    "Currency"    VARCHAR(5)    NOT NULL DEFAULT 'ETB',
    "Narrative"   VARCHAR(500),
    "ReferenceId" VARCHAR(100),
    "TraceNumber" VARCHAR(150)  NOT NULL,
    "CBSRefNo"    VARCHAR(50),
    "Status"      SMALLINT      NOT NULL,
    "ErrorCode"   VARCHAR(50),
    "ErrorDesc"   VARCHAR(500),
    "RequestXml"  TEXT,
    "ResponseXml" TEXT,
    "EntryTime"   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CbsTransfer_pkey" PRIMARY KEY ("id")
);
