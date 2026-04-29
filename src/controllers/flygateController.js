import axios from "axios";
import https from "https";
import { config } from 'dotenv';
import { prisma } from "../config/db.js";
import {
    CBS_OFFSET_ACCOUNTS,
    getOffsetAccount,
    CBS_PRD,
    cbsCreateTransaction,
    cbsReverseTransaction,
    attemptAutoReversal,
    extractXmlTag
} from "../services/cbsXmlService.js";
config();

// Disable TLS verification for self-signed certs on internal endpoints
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const shortcode = process.env.shortCodeT || 526341;
const url = (process.env.BASE_URL || "").trim().replace(/\/$/, "");
const AIRLINE_USER = (process.env.AIRLINE_USER || 'EnatBankTest@ethiopianairlines.com').trim();
const AIRLINE_PASS = (process.env.AIRLINE_PASS || 'EnatBankTest@!23').trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const logCbsXml = (label, xml) =>
    console.log(`\n========== ${label} ==========\n${xml}\n========== END ${label} ==========\n`);

const logJsonBlock = (label, data) =>
    console.log(`\n========== ${label} ==========\n${JSON.stringify(data, null, 2)}\n========== END ${label} ==========\n`);

/**
 * Log a raw JSON payload to FlyGateReqRes.
 * type: 1 = request, 2 = response
 */
const logFlyGateReqRes = async (orderId, type, data) => {
    try {
        await prisma.flyGateReqRes.create({
            data: {
                orderId: String(orderId || "").slice(0, 20),
                type,
                data: typeof data === "string" ? JSON.parse(data) : data
            }
        });
    } catch (e) {
        console.error("FlyGateReqRes log failed:", e.message);
    }
};

/**
 * Log a raw XML payload to CbsReqRes.
 * type: 1 = request, 2 = response
 */
const logCbsReqRes = async (orderId, type, xml) => {
    try {
        await prisma.cbsReqRes.create({
            data: {
                orderId: String(orderId || "").slice(0, 20),
                type,
                data: String(xml || "")
            }
        });
    } catch (e) {
        console.error("CbsReqRes log failed:", e.message);
    }
};

/**
 * Write a step audit row to FLYGATEDetails.
 *
 * reqType:
 *   1 = GetOrder (validate) response from FlyGate
 *   2 = ConfirmOrder response from FlyGate
 *   3 = (unused — merged into reqType 2)
 *   4 = Refund (CBS reversal + FlyGate ConfirmRefund)
 *
 * Fields mapped from FlyGate response JSON:
 *   respCode        = HTTP status code (e.g. "200", "500")
 *   respResult      = raw FlyGate response JSON string
 *   traceNumber     = response.traceNumber (FlyGate's own trace)
 *   orderStatusCode = response.statusCodeResponse
 *   cbsRefNo        = response.enatTransactionNo (CBS ref from FlyGate)
 *   amount          = response.amount
 */
const writeFlygateAudit = async ({
    orderId, reqType, flyGateData, httpStatus, isRefund,
    customerName, pnr, currency
}) => {
    try {
        const d = flyGateData || {};
        await prisma.fLYGATEDetails.create({
            data: {
                orderId:         String(orderId || "").slice(0, 20),
                reqType,
                respCode:        String(httpStatus ?? "").slice(0, 10),
                respResult:      typeof flyGateData === "string" ? flyGateData : JSON.stringify(flyGateData),
                amount:          Number(d.amount || d.Amount || 0),
                traceNumber:     String(d.traceNumber || d.TraceNumber || "").slice(0, 50),
                orderStatusCode: Number(d.statusCodeResponse ?? d.statusCodeResponseDescription != null ? (d.statusCodeResponse ?? 0) : 0),
                resultDesc:      String(d.statusCodeResponseDescription || d.message || "").slice(0, 100),
                cbsRefNo:        String(d.enatTransactionNo || "").slice(0, 50),
                isRefund:        isRefund ? 1 : 0,
                customerName:    customerName ? String(customerName).slice(0, 500) : (d.customerName ? String(d.customerName).slice(0, 500) : null),
                pnr:             pnr ? String(pnr).slice(0, 25) : null,
                currency:        currency ? String(currency).slice(0, 5) : null
            }
        });
    } catch (e) {
        console.error("FLYGATEDetails write failed:", e.message);
    }
};

// ─── CBS SOAP call ────────────────────────────────────────────────────────────

const CBS_RT_URL = process.env.cbs_endpoint || process.env.cbs_url || "http://10.1.22.100:7003/FCUBSRTService/FCUBSRTService";

const callCbs = async (soapRequestXml, soapAction) => {
    logCbsXml(`CBS REQUEST [${soapAction}]`, soapRequestXml);
    const response = await axios.post(CBS_RT_URL, soapRequestXml, {
        headers: {
            'Content-Type': 'text/xml;charset=utf-8',
            SOAPAction: soapAction
        },
        httpsAgent,
        validateStatus: (s) => s >= 200 && s < 600
    });
    const responseXml = response.data || "";
    logCbsXml(`CBS RESPONSE [${soapAction}]`, responseXml);

    const faultString = extractXmlTag(responseXml, "faultstring");
    if (faultString) {
        const err = new Error(`CBS Fault: ${faultString}`);
        err.cbsRawData = responseXml;
        throw err;
    }
    if (response.status >= 400) {
        const err = new Error(`CBS HTTP ${response.status}`);
        err.cbsRawData = responseXml;
        throw err;
    }
    return responseXml;
};

// ─── validatePNR ─────────────────────────────────────────────────────────────

const validatePNR = async (req, res) => {
    const { orderid } = req.body;
    if (!orderid) {
        return res.status(400).json({ success: false, message: "orderid is required" });
    }

    try {
        const getOrderParams = { OrderId: orderid, shortCode: shortcode };

        // Log the outgoing request
        await logFlyGateReqRes(orderid, 1, getOrderParams);

        const response = await axios.get(`${url}/Enat/api/V1.0/Enat/GetOrder`, {
            params: getOrderParams,
            httpsAgent,
            auth: { username: AIRLINE_USER, password: AIRLINE_PASS },
            validateStatus: (s) => s >= 200 && s < 600
        });

        logJsonBlock("FLYGATE GetOrder RESPONSE", response.data);

        // Log the incoming response
        await logFlyGateReqRes(orderid, 2, response.data);

        const amount = Number(response.data?.Amount ?? response.data?.amount ?? 0);
        const customerName = response.data?.CustomerName || response.data?.customerName || "";
        const pnr = response.data?.PNR || response.data?.pnr || "";
        const currency = response.data?.Currency || response.data?.currency || "ETB";
        const statusDesc = response.data?.statusCodeResponseDescription || response.data?.message || "";

        const isSuccess = statusDesc === "Success" || amount > 0;

        if (isSuccess) {
            // Store pending order details in FLYGATEDetails (reqType=1 = GetOrder response)
            await writeFlygateAudit({
                orderId:     orderid,
                reqType:     1,
                flyGateData: response.data,
                httpStatus:  response.status,
                isRefund:    false,
                customerName,
                pnr,
                currency
            });

            return res.status(200).json({
                success: true,
                data: { orderId: orderid, amount, customerName, pnr, currency }
            });
        }

        // Store failed validate attempt too
        await writeFlygateAudit({
            orderId:     orderid,
            reqType:     1,
            flyGateData: response.data,
            httpStatus:  response.status,
            isRefund:    false
        });

        return res.status(404).json({
            success: false,
            message: statusDesc || "Order not found or expired",
            errorCode: response.data?.errorCode,
            orderId: response.data?.orderId || orderid,
            rawResponse: response.data
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.response?.data?.message || error.message || "Internal Server Error",
            error: error.response?.data || error.message,
            statusCode: error.response?.status || 500
        });
    }
};

// ─── confirmOrder ─────────────────────────────────────────────────────────────

const confirmOrder = async (req, res) => {
    const { orderid, beneficiaryAcno, branchCode, remark, pnr, customerName: bodyCustomerName, currency: bodyCurrency } = req.body;

    if (!orderid || !beneficiaryAcno) {
        return res.status(400).json({ status: "Error", message: "orderid and beneficiaryAcno are required" });
    }

    try {
        // ── 0a. Guard: already paid? ────────────────────────────────────────
        // Check FlygateTransactions for a successful payment for this orderId
        const existingTrn = await prisma.flygateTransactions.findFirst({
            where: { orderId: orderid, status: 1, isRefund: 0 },
            orderBy: { code: 'desc' }
        });
        if (existingTrn) {
            return res.status(409).json({
                status: "AlreadyPaid",
                message: `Order ${orderid} has already been paid`,
                reference: existingTrn.bankRefNo,
                paidAt:    existingTrn.processedDate,
                amount:    existingTrn.amount,
                traceNumber: existingTrn.traceNumber
            });
        }

        // ── 0b. Get pending order details ───────────────────────────────────
        // First try local DB (written by validatePNR — reqType=1)
        let pending = await prisma.fLYGATEDetails.findFirst({
            where: { orderId: orderid, reqType: 1 },
            orderBy: { auto: 'desc' }
        });

        // If not found locally, re-call FlyGate GetOrder to validate live
        if (!pending) {
            const getOrderParams = { OrderId: orderid, shortCode: shortcode };
            await logFlyGateReqRes(orderid, 1, getOrderParams);

            const revalidate = await axios.get(`${url}/Enat/api/V1.0/Enat/GetOrder`, {
                params: getOrderParams,
                httpsAgent,
                auth: { username: AIRLINE_USER, password: AIRLINE_PASS },
                validateStatus: (s) => s >= 200 && s < 600
            });

            logJsonBlock("FLYGATE GetOrder RE-VALIDATE RESPONSE", revalidate.data);
            await logFlyGateReqRes(orderid, 2, revalidate.data);

            const reAmount     = Number(revalidate.data?.Amount ?? revalidate.data?.amount ?? 0);
            const reStatusDesc = revalidate.data?.statusCodeResponseDescription || revalidate.data?.message || "";
            const reIsValid    = reStatusDesc === "Success" || reAmount > 0;

            if (!reIsValid) {
                return res.status(404).json({
                    status:  "Error",
                    message: `Invalid orderId: ${orderid} — order not found or expired`
                });
            }

            // Build a synthetic pending object from the live response
            pending = {
                amount:       reAmount,
                customerName: revalidate.data?.CustomerName || revalidate.data?.customerName || "",
                pnr:          revalidate.data?.PNR          || revalidate.data?.pnr          || "",
                currency:     revalidate.data?.Currency     || revalidate.data?.currency     || "ETB"
            };

            // Persist it so next call hits the DB
            await writeFlygateAudit({
                orderId:     orderid,
                reqType:     1,
                flyGateData: revalidate.data,
                httpStatus:  revalidate.status,
                isRefund:    false,
                customerName: pending.customerName,
                pnr:          pending.pnr,
                currency:     pending.currency
            });
        }

        // Parse pending data — respResult holds the raw FlyGate JSON
        let pendingData = {};
        try { pendingData = JSON.parse(pending.respResult || "{}"); } catch {}

        const amount       = Number(req.body.amount ?? pending?.amount ?? pendingData?.amount ?? 0);
        const customerName = bodyCustomerName || pending?.customerName || pendingData?.customerName || "Flygate Customer";
        const orderPnr     = pnr || pending?.pnr || "";
        const currency     = bodyCurrency || pending?.currency || "ETB";

        if (!amount || amount <= 0) {
            return res.status(400).json({ status: "Error", message: "Valid amount is required" });
        }

        const finalTraceNumber = `TRC${Date.now()}`;

        // ── 1. Build & log CBS request ──────────────────────────────────────
        const soapRequestXml = cbsCreateTransaction({
            prd:       CBS_PRD.AIRLINE,
            drAcNo:    String(beneficiaryAcno),
            crAcNo:    getOffsetAccount("AIRLINE"),
            amount,
            drBranch:  branchCode,
            narrative: `Airline ticket payment - ${orderid}`
        });

        await logCbsReqRes(orderid, 1, soapRequestXml);
        // CBS req/resp logged to CbsReqRes only — not to FLYGATEDetails

        // ── 2. Call CBS ─────────────────────────────────────────────────────
        const cbsResponseXml = await callCbs(soapRequestXml, 'CREATETRANSACTION_FSFS_REQ');
        await logCbsReqRes(orderid, 2, cbsResponseXml);

        const isSuccess = cbsResponseXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        const cbsFccRef = extractXmlTag(cbsResponseXml, "FCCREF");
        const cbsXref = extractXmlTag(cbsResponseXml, "XREF");
        const cbsErrorDesc = extractXmlTag(cbsResponseXml, "EDESC");
        const finalReferenceNumber = cbsFccRef || cbsXref;
        // Use CBS book date as canonical transaction date (e.g. "2026-04-29")
        const cbsBookDate = extractXmlTag(cbsResponseXml, "BOOKDATE");
        const cbsTrnDate  = cbsBookDate ? new Date(cbsBookDate) : new Date();
        // CBS result logged to CbsReqRes only

        if (!isSuccess) {
            const err = new Error(`CBS Error: ${cbsErrorDesc || "Transaction failed"}`);
            err.cbsRawData = cbsResponseXml;
            err.cbsRequestXml = soapRequestXml;
            throw err;
        }
        if (!finalReferenceNumber) {
            const err = new Error("CBS Error: Missing FCCREF/XREF in successful response");
            err.cbsRawData = cbsResponseXml;
            err.cbsRequestXml = soapRequestXml;
            throw err;
        }

        // ── 3. Confirm with FlyGate ─────────────────────────────────────────
        const flyGatePayload = {
            OrderId: orderid,
            shortCode: shortcode,
            Amount: amount,
            Currency: currency,
            status: 1,
            remark: remark || `Successfully Paid for order: ${orderid}`,
            TraceNumber: finalTraceNumber,
            ReferenceNumber: finalReferenceNumber,
            PayerCustomerName: customerName,
            PaidAccountNumber: beneficiaryAcno
        };

        logJsonBlock("FLYGATE ConfirmOrder REQUEST", flyGatePayload);
        await logFlyGateReqRes(orderid, 1, flyGatePayload);

        const flyGateResponse = await axios.post(
            `${url}/Enat/api/V1.0/Enat/ConfirmOrder`,
            flyGatePayload,
            {
                httpsAgent,
                auth: { username: AIRLINE_USER, password: AIRLINE_PASS },
                validateStatus: (s) => s >= 200 && s < 600
            }
        );
        logJsonBlock("FLYGATE ConfirmOrder RESPONSE", flyGateResponse.data);
        await logFlyGateReqRes(orderid, 2, flyGateResponse.data);

        if (flyGateResponse.status >= 400 || flyGateResponse.data?.statusCodeResponseDescription === "Error") {
            const err = new Error(flyGateResponse.data?.message || "Flygate confirm failed");
            err.httpStatus = flyGateResponse.status;
            err.upstreamData = flyGateResponse.data;

            // ── Auto-reverse CBS since FlyGate confirm failed ────────────────
            const reversal = await attemptAutoReversal(finalReferenceNumber, CBS_RT_URL, httpsAgent, axios.post.bind(axios));
            // Write a failed FlygateTransactions row so we have a record
            await prisma.flygateTransactions.create({
                data: {
                    orderId:           String(orderid).slice(0, 20),
                    trnDate:           cbsTrnDate,
                    drAcNo:            String(beneficiaryAcno).slice(0, 50),
                    crAcNo:            getOffsetAccount("AIRLINE").slice(0, 50),
                    customerName:      String(customerName).slice(0, 500),
                    pnr:               orderPnr ? String(orderPnr).slice(0, 25) : null,
                    amount:            Number(amount),
                    currency:          String(currency).slice(0, 5),
                    remarks:           `FlyGate confirm failed — auto-reversed`,
                    status:            0,
                    traceNumber:       String(finalTraceNumber).slice(0, 150),
                    bankRefNo:         String(finalReferenceNumber).slice(0, 500),
                    processedDate:     new Date(),
                    channel:           "API",
                    isRefund:          0,
                    autoReversed:      reversal.success ? 1 : 0,
                    autoReversalRef:   reversal.reversalRef,
                    autoReversalError: reversal.error,
                    entryDate:         new Date()
                }
            }).catch(e => console.error("FlygateTransactions (failed+reversed) write failed:", e.message));

            throw err;
        }

        // ── 4. Write FLYGATEDetails — ConfirmOrder response (reqType=2) ────
        await writeFlygateAudit({
            orderId:     orderid,
            reqType:     2,
            flyGateData: flyGateResponse.data,
            httpStatus:  flyGateResponse.status,
            isRefund:    false,
            customerName,
            pnr:         orderPnr,
            currency
        });

        // ── 5. Write FlygateTransactions (confirmed record) ─────────────────
        await prisma.flygateTransactions.create({
            data: {
                orderId:       String(orderid).slice(0, 20),
                trnDate:       cbsTrnDate,
                drAcNo:        String(beneficiaryAcno).slice(0, 50),
                crAcNo:        getOffsetAccount("AIRLINE").slice(0, 50),
                customerName:  String(customerName).slice(0, 500),
                pnr:           orderPnr ? String(orderPnr).slice(0, 25) : null,
                amount:        Number(amount),
                currency:      String(currency).slice(0, 5),
                remarks:       remark ? String(remark).slice(0, 500) : `Payment for order ${orderid}`,
                status:        1,
                traceNumber:   String(finalTraceNumber).slice(0, 150),
                bankRefNo:     String(finalReferenceNumber).slice(0, 500),
                processedDate: new Date(),
                channel:       "API",
                isRefund:      0,
                entryDate:     new Date()
            }
        }).catch(e => console.error("FlygateTransactions write failed:", e.message));

        // ── 6. Write Transactions (CBS journal — trnDate from CBS BOOKDATE) ──
        await prisma.transactions.create({
            data: {
                orderId:      String(orderid).slice(0, 20),
                pnr:          orderPnr ? String(orderPnr).slice(0, 25) : null,
                trnDate:      cbsTrnDate,
                processedTime: new Date(),
                drAcNo:       String(beneficiaryAcno).slice(0, 50),
                crAcNo:       getOffsetAccount("AIRLINE").slice(0, 50),
                branchCode:   branchCode ? String(branchCode).slice(0, 10) : null,
                amount:       Number(amount),
                currencyCode: String(currency).slice(0, 5),
                customerName: String(customerName).slice(0, 500),
                cbsRefNo:     String(finalReferenceNumber).slice(0, 50),
                uniqueId:     `${orderid}-${finalReferenceNumber}`.slice(0, 50),
                crDr:         "DEBIT",
                remarks:      remark ? String(remark).slice(0, 500) : `Airline payment ${orderid}`,
                particulars:  `FlyGate order ${orderid}`,
                status:       1,
                channel:      "API",
                entryTime:    new Date()
            }
        }).catch(e => console.error("Transactions write failed:", e.message));

        return res.json({
            status: "Success",
            message: "Successfully transferred",
            reference: finalReferenceNumber,
            rawData: flyGateResponse.data
        });

    } catch (error) {
        return res.status(error.httpStatus || 500).json({
            status: "Error",
            message: error.response?.data?.message || error.message,
            rawData: error.cbsRawData || error.upstreamData || error.response?.data || null,
            requestXml: error.cbsRequestXml || null
        });
    }
};

// ─── refundRequest ────────────────────────────────────────────────────────────

const refundRequest = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ status: "Error", message: "Authorization header missing" });
    }
    const encoded = authHeader.split(' ')[1];
    if (!encoded) {
        return res.status(401).json({ status: "Error", message: "Invalid authorization format" });
    }
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user !== AIRLINE_USER || pass !== AIRLINE_PASS) {
        return res.status(401).json({ status: "Error", message: "Invalid credentials" });
    }

    const {
        shortCode, orderId, firstName, lastName,
        amount, currency, ReferenceNumber,
        refundFOP, refundReferenceCode
    } = req.body;

    try {
        // ── 1. Build & log CBS reversal request ─────────────────────────────
        const soapRequestXml = cbsReverseTransaction(ReferenceNumber);
        await logCbsReqRes(orderId, 1, soapRequestXml);

        // ── 2. Call CBS reversal ─────────────────────────────────────────────
        const cbsResponseXml = await callCbs(soapRequestXml, 'REVERSETRANSACTION_FSFS_REQ');
        await logCbsReqRes(orderId, 2, cbsResponseXml);

        const isSuccess = cbsResponseXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        const refundError = extractXmlTag(cbsResponseXml, "EDESC");
        const reverseRef = extractXmlTag(cbsResponseXml, "FCCREF") || ReferenceNumber;

        // ── 3. Write FLYGATEDetails — CBS reversal result (reqType=4, isRefund=1) ─
        // Build a synthetic FlyGate-style object from CBS response for consistent storage
        await writeFlygateAudit({
            orderId:     orderId,
            reqType:     4,
            flyGateData: {
                amount:                      Number(amount || 0),
                traceNumber:                 reverseRef,
                statusCodeResponse:          isSuccess ? 1 : 0,
                statusCodeResponseDescription: isSuccess ? "CBS Reversal Success" : (refundError || "CBS reversal failed"),
                enatTransactionNo:           reverseRef,
                message:                     isSuccess ? "CBS Reversal Success" : (refundError || "CBS reversal failed")
            },
            httpStatus:  isSuccess ? 200 : 400,
            isRefund:    true
        });

        // ── 4. Write RefundLedger ────────────────────────────────────────────
        await prisma.refundDetails.create({
            data: {
                receiveDate: new Date(),
                shortCode: String(shortCode || "").slice(0, 10),
                orderId: String(orderId || "").slice(0, 20),
                amount: Number(amount || 0),
                cbsRefNumber: String(ReferenceNumber || "").slice(0, 50),
                flyRefundCode: String(refundReferenceCode || "").slice(0, 30),
                acknowledgeStatus: 1,
                acknowledgDesc: "Received",
                refundStatus: isSuccess ? 1 : 0,
                refundCbsRef: String(reverseRef || "").slice(0, 50),
                refundDate: isSuccess ? new Date() : null,
                refundDesc: isSuccess ? "Successfully Refunded" : (refundError || "Refund failed"),
                confirmRefundStatus: isSuccess ? 1 : 0,
                confirmRefundDate: isSuccess ? new Date() : null,
                status: isSuccess ? 1 : 0
            }
        }).catch(e => console.error("RefundDetails write failed:", e.message));

        if (!isSuccess) {
            return res.status(400).json({
                ResponseCode: 0,
                ResponseCodeDescription: refundError || `No transaction found for reference: ${ReferenceNumber}`,
                Status: "Error"
            });
        }

        // ── 5. Confirm refund with FlyGate ───────────────────────────────────
        const flyGatePayload = {
            shortCode,
            OrderId: orderId,
            Amount: amount,
            Currency: currency,
            RefundReferenceCode: refundReferenceCode,
            bankRefundReference: ReferenceNumber,
            refundDate: new Date().toISOString().split('T')[0],
            RefundAccountNumber: req.body.RefundAccountNumber || getOffsetAccount("AIRLINE"),
            AccountHolderName: `${firstName || ""} ${lastName || ""}`.trim(),
            refundFOP,
            status: 1,
            remark: "Successfully Refunded"
        };

        logJsonBlock("FLYGATE ConfirmRefund REQUEST", flyGatePayload);
        await logFlyGateReqRes(orderId, 1, flyGatePayload);

        const flyGateResponse = await axios.post(
            `${url}/Enat/api/V1.0/Enat/ConfirmRefund`,
            flyGatePayload,
            {
                httpsAgent,
                auth: { username: AIRLINE_USER, password: AIRLINE_PASS },
                validateStatus: (s) => s >= 200 && s < 600
            }
        );
        logJsonBlock("FLYGATE ConfirmRefund RESPONSE", flyGateResponse.data);
        await logFlyGateReqRes(orderId, 2, flyGateResponse.data);

        if (flyGateResponse.status >= 400 || flyGateResponse.data?.statusCodeResponseDescription === "Error") {
            return res.status(flyGateResponse.status || 400).json({
                status: "Error",
                message: flyGateResponse.data?.message || "Flygate refund confirmation failed",
                rawData: flyGateResponse.data
            });
        }

        // ── 6. Update FlygateTransactions refund fields ──────────────────────
        await prisma.flygateTransactions.updateMany({
            where: { bankRefNo: String(ReferenceNumber) },
            data: {
                isRefund: 1,
                refundStatus: 1,
                refundReferenceCode: String(refundReferenceCode || "").slice(0, 250),
                orgBankRefNo: String(ReferenceNumber || "").slice(0, 500)
            }
        }).catch(e => console.error("FlygateTransactions refund update failed:", e.message));

        return res.status(200).json({
            ResponseCode: 1,
            success: "Success",
            ResponseCodeDescription: "Successfully accepted Refund request",
            data: flyGateResponse.data
        });

    } catch (error) {
        return res.status(error.httpStatus || 500).json({
            status: "Error",
            message: error.message,
            rawData: error.cbsRawData || error.upstreamData || error.response?.data || null
        });
    }
};

export { validatePNR, confirmOrder, refundRequest };
