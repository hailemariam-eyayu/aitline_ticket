import axios from "axios";
import https from "https";
import { config } from 'dotenv';
import { prisma } from "../config/db.js";
import {
    CBS_OFFSET_ACCOUNT,
    buildCreateTransactionXml,
    buildReversalXml,
    extractXmlTag
} from "../services/cbsXmlService.js";
config();

// Disable TLS verification for self-signed certs on internal endpoints
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const shortcode = process.env.shortCodeT || 526341;
const url = process.env.BASE_URL;

const AIRLINE_USER = process.env.AIRLINE_USER || 'EnatBankTest@ethiopianairlines.com';
const AIRLINE_PASS = process.env.AIRLINE_PASS || 'EnatBankTest@!23';

const validatePNR = async (req, res) => {
    const { orderid } = req.body;
    if (!orderid) {
        return res.status(400).json({ success: false, message: "orderid is required" });
    }

    try {
        const getOrderParams = {
            OrderId: orderid,
            shortCode: shortcode
        };

        const response = await axios.get(`${url}/Enat/api/V1.0/Enat/GetOrder`, {
            params: getOrderParams,
            httpsAgent,
            auth: {
                username: AIRLINE_USER,
                password: AIRLINE_PASS
            },
            validateStatus: (status) => status >= 200 && status < 600
        });

        const amount = Number(response.data?.Amount ?? response.data?.amount ?? 0);
        const customerName = response.data?.CustomerName || response.data?.customerName || "Unknown";

        if (response.data && (response.data.statusCodeResponseDescription === "Success" || amount > 0)) {
            let savedOrder = null;
            try {
                savedOrder = await prisma.fLYGATEDetails.upsert({
                    where: { orderId: orderid },
                    update: { amount, customerName },
                    create: { orderId: orderid, amount, customerName }
                });
            } catch (dbError) {
                console.error("PendingOrder upsert failed:", dbError.message);
            }

            return res.status(200).json({
                success: true,
                data: savedOrder || { orderId: orderid, amount, customerName }
            });
        }

        return res.status(404).json({
            success: false,
            message: response.data?.statusCodeResponseDescription || response.data?.message || "Order not found or expired",
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


// Configuration from your Web.config
const CBS_URL = process.env.cbs_url || "http://10.1.22.100:7003/FCUBSRTService/FCUBSRTService?WSDL";
const CBS_RT_URL = process.env.cbs_endpoint || CBS_URL;
const logCbsXml = (label, xml) => {
    console.log(`\n========== ${label} ==========\n${xml}\n========== END ${label} ==========\n`);
};
const logJsonBlock = (label, data) => {
    console.log(`\n========== ${label} ==========\n${JSON.stringify(data, null, 2)}\n========== END ${label} ==========\n`);
};

const callCbs = async (soapRequestXml, soapAction, endpoint = CBS_RT_URL) => {
    logCbsXml(`CBS REQUEST ${soapAction}`, soapRequestXml);
    const response = await axios.post(endpoint, soapRequestXml, {
        headers: {
            'Content-Type': 'text/xml;charset=utf-8',
            SOAPAction: soapAction
        },
        httpsAgent,
        validateStatus: (status) => status >= 200 && status < 600
    });
    const responseXml = response.data || "";
    logCbsXml(`CBS RESPONSE ${soapAction}`, responseXml);

    const faultString = extractXmlTag(responseXml, "faultstring");
    if (faultString) {
        const error = new Error(`CBS Fault: ${faultString}`);
        error.cbsRawData = responseXml;
        throw error;
    }
    if (response.status >= 400) {
        const error = new Error(`CBS HTTP ${response.status}`);
        error.cbsRawData = responseXml;
        throw error;
    }
    return responseXml;
};

const writeFlygateAudit = async ({ orderId, reqType, payload, responseCode, resultDesc, cbsRefNo, amount, traceNumber, orderStatusCode, isRefund }) => {
    try {
        await prisma.fLYGATEDetails.create({
            data: {
                orderId: String(orderId).slice(0, 20),
                reqType,
                respCode: String(responseCode ?? ""),
                respResult: typeof payload === "string" ? payload : JSON.stringify(payload),
                amount: Number(amount || 0),
                traceNumber: String(traceNumber || "").slice(0, 50),
                orderStatusCode: Number(orderStatusCode ?? 0),
                resultDesc: String(resultDesc || "").slice(0, 100),
                cbsRefNo: String(cbsRefNo || "").slice(0, 50),
                isRefund: isRefund ? 1 : 0
            }
        });
    } catch (error) {
        console.error("FLYGATEDetails write failed:", error.message);
    }
};

const confirmOrder = async (req, res) => {
    const { orderid, beneficiaryAcno, remark } = req.body;
    if (!orderid || !beneficiaryAcno) {
        return res.status(400).json({ status: "Error", message: "orderid and beneficiaryAcno are required" });
    }

    try {
        const pending = await prisma.pendingOrder.findUnique({ where: { orderId: orderid } }).catch(() => null);
        const amount = Number(req.body.amount ?? pending?.amount ?? 0);
        const customerName = req.body.customerName || pending?.customerName || "Flygate Customer";
        if (!amount || amount <= 0) {
            return res.status(400).json({ status: "Error", message: "Valid amount is required" });
        }

        const finalTraceNumber = `TRC${Date.now()}`;
        const { xml: soapRequestXml } = buildCreateTransactionXml({ amount, orderid, beneficiaryAcno });
        await writeFlygateAudit({
            orderId: orderid,
            reqType: 1,
            payload: soapRequestXml,
            responseCode: "REQ",
            resultDesc: "CBS CreateTransaction Request",
            cbsRefNo: "",
            amount,
            traceNumber: finalTraceNumber,
            orderStatusCode: 0,
            isRefund: false
        });

        const cbsResponseXml = await callCbs(soapRequestXml, 'CREATETRANSACTION_FSFS_REQ');
        const isSuccess = cbsResponseXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        const cbsFccRef = extractXmlTag(cbsResponseXml, "FCCREF");
        const cbsXref = extractXmlTag(cbsResponseXml, "XREF");
        const cbsErrorDesc = extractXmlTag(cbsResponseXml, "EDESC");
        const finalReferenceNumber = cbsFccRef || cbsXref;

        await writeFlygateAudit({
            orderId: orderid,
            reqType: 2,
            payload: cbsResponseXml,
            responseCode: isSuccess ? "SUCCESS" : "FAILURE",
            resultDesc: isSuccess ? "CBS CreateTransaction Success" : (cbsErrorDesc || "CBS transaction failed"),
            cbsRefNo: finalReferenceNumber,
            amount,
            traceNumber: finalTraceNumber,
            orderStatusCode: isSuccess ? 1 : 0,
            isRefund: false
        });

        if (!isSuccess) {
            const error = new Error(`CBS Error: ${cbsErrorDesc || "Transaction failed"}`);
            error.cbsRawData = cbsResponseXml;
            error.cbsRequestXml = soapRequestXml;
            throw error;
        }
        if (!finalReferenceNumber) {
            const error = new Error("CBS Error: Missing FCCREF/XREF in successful response");
            error.cbsRawData = cbsResponseXml;
            error.cbsRequestXml = soapRequestXml;
            throw error;
        }

        const flyGatePayload = {
            OrderId: orderid,
            shortCode: process.env.shortCodeT,
            Amount: amount,
            Currency: "ETB",
            status: 1,
            remark: remark || `Successfully Paid for order: ${orderid}`,
            TraceNumber: finalTraceNumber,
            ReferenceNumber: finalReferenceNumber,
            PayerCustomerName: customerName || "Enat Customer",
            PaidAccountNumber: beneficiaryAcno
        };

        logJsonBlock("FLYGATE CONFIRM REQUEST", flyGatePayload);
        const flyGateResponse = await axios.post(
            `${url}/Enat/api/V1.0/Enat/ConfirmOrder`,
            flyGatePayload,
            {
                httpsAgent,
                auth: {
                    username: AIRLINE_USER,
                    password: AIRLINE_PASS
                },
                validateStatus: (status) => status >= 200 && status < 600
            }
        );
        logJsonBlock("FLYGATE CONFIRM RESPONSE", flyGateResponse.data);

        if (flyGateResponse.status >= 400 || flyGateResponse.data?.statusCodeResponseDescription === "Error") {
            const error = new Error(flyGateResponse.data?.message || "Flygate confirm failed");
            error.httpStatus = flyGateResponse.status;
            error.upstreamData = flyGateResponse.data;
            throw error;
        }
        await writeFlygateAudit({
            orderId: orderid,
            reqType: 3,
            payload: flyGateResponse.data,
            responseCode: "200",
            resultDesc: "Flygate ConfirmOrder Success",
            cbsRefNo: finalReferenceNumber,
            amount,
            traceNumber: finalTraceNumber,
            orderStatusCode: 1,
            isRefund: false
        });

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


const refundRequest = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ status: "Error", message: "Authorization header missing"  });
    }

    const encoded = authHeader.split(' ')[1];
    if (!encoded) {
        return res.status(401).json({ status: "Error", message: "Invalid authorization format" });
    }
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');

    if (user !== AIRLINE_USER || pass !== AIRLINE_PASS) {
        return res.status(401).json({ status: "Error", message: "Invalid credentials" });
    }

    const { shortCode, orderId, firstName, lastName, amount, currency, ReferenceNumber, refundFOP, refundReferenceCode } = req.body;

    try {
        const soapRequestXml = buildReversalXml(ReferenceNumber);
        const cbsResponseXml = await callCbs(soapRequestXml, 'REVERSETRANSACTION_FSFS_REQ');
        const isSuccess = cbsResponseXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        const refundError = extractXmlTag(cbsResponseXml, "EDESC");
        const reverseRef = extractXmlTag(cbsResponseXml, "FCCREF") || ReferenceNumber;

        await writeFlygateAudit({
            orderId,
            reqType: 4,
            payload: cbsResponseXml,
            responseCode: isSuccess ? "SUCCESS" : "FAILURE",
            resultDesc: isSuccess ? "CBS Reversal Success" : (refundError || "CBS reversal failed"),
            cbsRefNo: reverseRef,
            amount: Number(amount || 0),
            traceNumber: "",
            orderStatusCode: isSuccess ? 1 : 0,
            isRefund: true
        });

        await prisma.refundLedger.create({
            data: {
                receiveDate: new Date(),
                shortCode: String(shortCode),
                orderId: String(orderId),
                amount: Number(amount || 0),
                cbsRefNumber: String(ReferenceNumber || ""),
                flyRefundCode: String(refundReferenceCode || ""),
                acknowledgeStatus: 1,
                acknowledgDesc: "Received",
                refundStatus: isSuccess ? 1 : 0,
                refundCbsRef: String(reverseRef || ""),
                refundDate: isSuccess ? new Date() : null,
                refundDesc: isSuccess ? "Successfully Refunded" : (refundError || "Refund failed"),
                confirmRefundStatus: isSuccess ? 1 : 0,
                confirmRefundDate: isSuccess ? new Date() : null,
                status: isSuccess ? 1 : 0
            }
        }).catch(e => console.error("RefundLedger write failed:", e.message));

        if (isSuccess) {
            const flyGatePayload = {
                shortCode: shortCode,
                OrderId: orderId,
                Amount: amount,
                Currency: currency,
                RefundReferenceCode: refundReferenceCode,
                bankRefundReference: ReferenceNumber,
                refundDate: new Date().toISOString().split('T')[0],
                RefundAccountNumber: req.body.RefundAccountNumber || CBS_OFFSET_ACCOUNT,
                AccountHolderName: `${firstName} ${lastName}`,
                refundFOP: refundFOP,
                status: 1,
                remark: "Successfully Refunded",
            };

            logJsonBlock("FLYGATE REFUND REQUEST", flyGatePayload);
            const flyGateResponse = await axios.post(
                `${url}/Enat/api/V1.0/Enat/ConfirmRefund`,
                flyGatePayload,
                {
                    httpsAgent,
                    auth: {
                        username: AIRLINE_USER,
                        password: AIRLINE_PASS
                    },
                    validateStatus: (status) => status >= 200 && status < 600
                }
            );
            logJsonBlock("FLYGATE REFUND RESPONSE", flyGateResponse.data);

            if (flyGateResponse.status >= 400 || flyGateResponse.data?.statusCodeResponseDescription === "Error") {
                return res.status(flyGateResponse.status || 400).json({
                    status: "Error",
                    message: flyGateResponse.data?.message || "Flygate refund failed",
                    rawData: flyGateResponse.data
                });
            }

            return res.status(200).json({
                "ResponseCode": 1,
                "success": "Success",
                "ResponseCodeDescription": "Successfully accepted Refund request",
                "data": flyGateResponse.data
            });
        } else {
            return res.status(400).json({
                "ResponseCode": 0,
                "ResponseCodeDescription": refundError || `There is no transaction associated with Reference: ${ReferenceNumber}`,
                "Status": "Error"
            });
        }
    } catch (error) {
        return res.status(error.httpStatus || 500).json({
            status: "Error",
            message: error.message,
            rawData: error.cbsRawData || error.upstreamData || error.response?.data || null
        });
    }
};


export { validatePNR, confirmOrder, refundRequest };