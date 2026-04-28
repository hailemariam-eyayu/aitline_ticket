-- ============================================================
-- Sample seed data: 2 rows per table
-- ============================================================

-- ─── FlyGateReqRes ───────────────────────────────────────────
INSERT INTO "FlyGateReqRes" ("OrderId", "type", "CreatedAt", "Data") VALUES
('ORD-2026-0001', 1, '2026-04-28 08:00:00', '{"OrderId":"ORD-2026-0001","shortCode":526341}'),
('ORD-2026-0001', 2, '2026-04-28 08:00:01', '{"statusCodeResponseDescription":"Success","Amount":4500.00,"CustomerName":"Abebe Kebede","PNR":"ET1234","Currency":"ETB"}');

-- ─── CbsReqRes ───────────────────────────────────────────────
INSERT INTO "CbsReqRes" ("OrderId", "type", "CreatedAt", "Data") VALUES
('ORD-2026-0001', 1, '2026-04-28 08:01:00', '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><CREATETRANSACTION_FSFS_REQ><TXNACC>0011230708313001</TXNACC><TXNAMT>4500</TXNAMT></CREATETRANSACTION_FSFS_REQ></soapenv:Body></soapenv:Envelope>'),
('ORD-2026-0001', 2, '2026-04-28 08:01:02', '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><CREATETRANSACTION_FSFS_RES><MSGSTAT>SUCCESS</MSGSTAT><FCCREF>FCC20260428001</FCCREF></CREATETRANSACTION_FSFS_RES></soapenv:Body></soapenv:Envelope>');

-- ─── FLYGATEDetails ──────────────────────────────────────────
INSERT INTO "FLYGATEDetails" ("orderId","reqType","RESPCODE","RESPRESULT","AMOUNT","traceNumber","orderStatusCode","resultDesc","CBSRefNo","isRefund","CustomerName","PNR","Currency","entryDate") VALUES
('ORD-2026-0001', 0, '200',  'GetOrder Success - Pending',          4500.00, '',              0, 'Pending order from FlyGate',      '',              0, 'Abebe Kebede',  'ET1234', 'ETB', '2026-04-28 08:00:01'),
('ORD-2026-0001', 2, 'SUCCESS', 'CBS CreateTransaction Success',    4500.00, 'TRC1745827200', 1, 'CBS transaction completed',       'FCC20260428001', 0, 'Abebe Kebede',  'ET1234', 'ETB', '2026-04-28 08:01:02');

-- ─── FlygateTransactions ─────────────────────────────────────
INSERT INTO "FlygateTransactions" ("OrderId","TrnDate","DrAcNO","CrAcNO","CUSTOMERNAME","PNR","Amount","Currency","Remarks","STATUS","TraceNumber","BankRefNo","ProcessedDate","Channel","IsRefund","EntryDate") VALUES
('ORD-2026-0001', '2026-04-28 08:01:05', '0011230708313001', '0461112216017001', 'Abebe Kebede',  'ET1234', 4500.00, 'ETB', 'Payment for order ORD-2026-0001', 1, 'TRC1745827200', 'FCC20260428001', '2026-04-28 08:01:05', 'API', 0, '2026-04-28 08:01:05'),
('ORD-2026-0002', '2026-04-28 09:15:00', '0011230708313002', '0461112216017001', 'Tigist Alemu',  'ET5678', 7200.00, 'ETB', 'Payment for order ORD-2026-0002', 1, 'TRC1745831700', 'FCC20260428002', '2026-04-28 09:15:00', 'API', 0, '2026-04-28 09:15:00');

-- ─── Transactions ────────────────────────────────────────────
INSERT INTO "Transactions" ("OrderId","PNR","TrnDate","ProcessedTime","DrAcNo","CrAcNo","BranchCode","Amount","CurrencyCode","CustomerName","CBSRefNo","TraceNumber","UniqueId","CrDr","Remarks","Particulars","Status","Channel","EntryTime") VALUES
('ORD-2026-0001', 'ET1234', '2026-04-28 08:01:05', '2026-04-28 08:01:05', '0011230708313001', '0461112216017001', '001', 4500.00, 'ETB', 'Abebe Kebede',  'FCC20260428001', 'TRC1745827200', 'ORD-2026-0001-TRC1745827200', 'DEBIT', 'Airline payment ORD-2026-0001', 'FlyGate order ORD-2026-0001', 1, 'API', '2026-04-28 08:01:05'),
('ORD-2026-0002', 'ET5678', '2026-04-28 09:15:00', '2026-04-28 09:15:00', '0011230708313002', '0461112216017001', '001', 7200.00, 'ETB', 'Tigist Alemu',  'FCC20260428002', 'TRC1745831700', 'ORD-2026-0002-TRC1745831700', 'DEBIT', 'Airline payment ORD-2026-0002', 'FlyGate order ORD-2026-0002', 1, 'API', '2026-04-28 09:15:00');

-- ─── RefundLedger ────────────────────────────────────────────
INSERT INTO "RefundLedger" ("ReceiveDate","ShortCode","OrderId","Amount","CBSRefNumber","FLYRefundCode","AcknowledgeStatus","AcknowledgDesc","RefundStatus","RefundCBSRef","RefundDate","RefundDesc","ConfirmRefundStatus","ConfirmRefundDate","status") VALUES
('2026-04-28 10:00:00', '526341', 'ORD-2026-0001', 4500.00, 'FCC20260428001', 'RFND-ET1234-001', 1, 'Received', 1, 'REV20260428001', '2026-04-28 10:01:00', 'Successfully Refunded', 1, '2026-04-28 10:01:30', 1),
('2026-04-28 11:30:00', '526341', 'ORD-2026-0002', 7200.00, 'FCC20260428002', 'RFND-ET5678-002', 1, 'Received', 0,  NULL,             NULL,                  'Refund pending CBS',   0, NULL,                  0);
