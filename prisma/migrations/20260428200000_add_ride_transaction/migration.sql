-- Add Ride bill payment audit table
CREATE TABLE "RideTransaction" (
    "id"                SERIAL        NOT NULL,
    "Phone"             VARCHAR(20)   NOT NULL,
    "FullName"          VARCHAR(200),
    "AccountStatus"     VARCHAR(20),
    "Amount"            MONEY,
    "BillRefNo"         VARCHAR(100),
    "TransTime"         VARCHAR(20),
    "Remark"            VARCHAR(500),
    "AcknowledgementId" VARCHAR(100),
    "CBSRefNo"          VARCHAR(50),
    "TraceNumber"       VARCHAR(150),
    "DrAcNo"            VARCHAR(50),
    "CrAcNo"            VARCHAR(50),
    "QueryStatus"       SMALLINT      NOT NULL DEFAULT 0,
    "PaymentStatus"     SMALLINT      NOT NULL DEFAULT 0,
    "CBSStatus"         SMALLINT      NOT NULL DEFAULT 0,
    "ErrorDesc"         VARCHAR(500),
    "QueryResponse"     TEXT,
    "ConfirmResponse"   TEXT,
    "EntryTime"         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RideTransaction_pkey" PRIMARY KEY ("id")
);
