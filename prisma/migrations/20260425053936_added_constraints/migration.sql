/*
  Warnings:

  - A unique constraint covering the columns `[userId,movieId]` on the table `WatchlistItem` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "FLYGATEDetails" (
    "auto" BIGSERIAL NOT NULL,
    "orderId" VARCHAR(20) NOT NULL,
    "reqType" INTEGER NOT NULL,
    "RESPCODE" VARCHAR(10) NOT NULL,
    "RESPRESULT" TEXT NOT NULL,
    "AMOUNT" MONEY NOT NULL,
    "traceNumber" VARCHAR(50) NOT NULL,
    "orderStatusCode" INTEGER NOT NULL,
    "resultDesc" VARCHAR(100) NOT NULL,
    "CBSRefNo" VARCHAR(50) NOT NULL,
    "isRefund" SMALLINT NOT NULL,
    "entryDate" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FLYGATEDetails_pkey" PRIMARY KEY ("auto")
);

-- CreateTable
CREATE TABLE "GlConfiguration" (
    "CODE" VARCHAR(10) NOT NULL,
    "RECEIVABLEGLAC" VARCHAR(30) NOT NULL,
    "SUSPENSEGLAC" VARCHAR(30) NOT NULL,
    "PAYABLEGLACNO" VARCHAR(30) NOT NULL,
    "Status" INTEGER,

    CONSTRAINT "GlConfiguration_pkey" PRIMARY KEY ("CODE")
);

-- CreateTable
CREATE TABLE "TransactionLedger" (
    "CODE" SERIAL NOT NULL,
    "UserID" VARCHAR(50),
    "TrnDate" TIMESTAMP,
    "BranchCode" INTEGER,
    "DrAcNO" VARCHAR(50),
    "CrAcNO" VARCHAR(50),
    "FIRSTNAME" VARCHAR(200),
    "LASTNAME" VARCHAR(200),
    "GENDER" SMALLINT,
    "MOBILENO" VARCHAR(50),
    "EMAILID" VARCHAR(500),
    "RESADDRESS" TEXT,
    "CUSTOMERNAME" VARCHAR(500),
    "CustName" VARCHAR(500),
    "CitizenId" VARCHAR(50),
    "PNR" VARCHAR(25),
    "Amount" MONEY,
    "Currency" VARCHAR(5),
    "Remarks" VARCHAR(500),
    "DueAmount" MONEY,
    "InvRefNo" INTEGER,
    "STATUS" DECIMAL,
    "ExpDate" VARCHAR(100),
    "TraceNumber" VARCHAR(150),
    "BatchId" VARCHAR(150),
    "BankRefNo" VARCHAR(500),
    "ProcessedDate" TIMESTAMP,
    "TrnCharge" MONEY,
    "VATAmt" MONEY,
    "DisasterRiskAmt" MONEY,
    "Channel" VARCHAR(20),
    "UtilRefNo" VARCHAR(50),
    "TSCROLLID" INTEGER,
    "EntryBy" INTEGER,
    "EntryDate" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "Authorised" SMALLINT,
    "EntryNode" INTEGER,
    "AuthoOpr" INTEGER,
    "AuthoNode" INTEGER,
    "AuthoTime" TIMESTAMP,
    "FAULTCODE" DECIMAL,
    "FAULTSTRING" TEXT,
    "IsRefund" SMALLINT,
    "RefundStatus" SMALLINT,
    "RefundReferenceCode" VARCHAR(250),
    "REFUNDOP" VARCHAR(500),
    "OrgPNR" VARCHAR(25),
    "OrgBankRefNo" VARCHAR(500),

    CONSTRAINT "TransactionLedger_pkey" PRIMARY KEY ("CODE")
);

-- CreateTable
CREATE TABLE "RefundLedger" (
    "Auto" SERIAL NOT NULL,
    "ReceiveDate" TIMESTAMP,
    "ShortCode" VARCHAR(10),
    "OrderId" VARCHAR(15),
    "Amount" MONEY,
    "CBSRefNumber" VARCHAR(25),
    "FLYRefundCode" VARCHAR(30),
    "AcknowledgeStatus" SMALLINT,
    "AcknowledgDesc" VARCHAR(50),
    "RefundStatus" SMALLINT,
    "RefundCBSRef" VARCHAR(25),
    "RefundDate" TIMESTAMP,
    "RefundDesc" VARCHAR(100),
    "ConfirmRefundStatus" SMALLINT,
    "ConfirmRefundDate" TIMESTAMP,
    "status" SMALLINT,

    CONSTRAINT "RefundLedger_pkey" PRIMARY KEY ("Auto")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_userId_movieId_key" ON "WatchlistItem"("userId", "movieId");
