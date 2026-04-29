CREATE TABLE "A2ATransfer" (
    "id"              SERIAL        NOT NULL,
    "DrAcNo"          VARCHAR(20)   NOT NULL,
    "DrAcName"        VARCHAR(200),
    "CrAcNo"          VARCHAR(20)   NOT NULL,
    "CrAcName"        VARCHAR(200),
    "Amount"          MONEY         NOT NULL,
    "Currency"        VARCHAR(5)    NOT NULL DEFAULT 'ETB',
    "Narrative"       VARCHAR(500),
    "CBSRefNo"        VARCHAR(50),
    "Status"          SMALLINT      NOT NULL DEFAULT 0,
    "ErrorDesc"       VARCHAR(500),
    "AutoReversed"    SMALLINT      DEFAULT 0,
    "AutoReversalRef" VARCHAR(50),
    "EntryTime"       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "A2ATransfer_pkey" PRIMARY KEY ("id")
);
