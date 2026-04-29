import axios from "axios";
import https from "https";
import { config } from "dotenv";
import { prisma } from "../config/db.js";
import { cbsCreateTransaction, cbsReverseTransaction, CBS_PRD, getOffsetAccount, extractXmlTag } from "../services/cbsXmlService.js";
config();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const CBS_RT_URL = process.env.cbs_endpoint || process.env.cbs_url || "http://10.1.22.100:7003/FCUBSRTService/FCUBSRTService";

const logXml = (label, xml) =>
    console.log(`\n===== ${label} =====\n${xml}\n===== END ${label} =====\n`);

// ─── POST /cbs/transfer ───────────────────────────────────────────────────────
/**
 * Generic CBS CreateTransaction endpoint.
 *
 * Body:
 * {
 *   channel:     "TELEBIRR" | "AIRLINE" | "BILL" | "MPESA" | "OTHER"  (required)
 *   prd:         string   — CBS product code e.g. "ATAD", "TELE"       (required)
 *   drAcNo:      string   — debit account number                        (required)
 *   crAcNo:      string   — credit account number                       (required)
 *   amount:      number   — transaction amount                          (required)
 *   drBranch:    string   — debit branch code                           (optional, env default)
 *   crBranch:    string   — credit branch code                          (optional, env default)
 *   currency:    string   — currency code                               (optional, default ETB)
 *   narrative:   string   — transaction narrative / remarks             (optional)
 *   referenceId: string   — caller's own ref (PNR, bill no, phone…)    (optional)
 * }
 */
const cbsTransfer = async (req, res) => {
    const { channel, prd, drAcNo, crAcNo, amount, drBranch, crBranch, currency = "ETB", narrative, referenceId } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    const missing = [];
    if (!channel)  missing.push("channel");
    if (!prd)      missing.push("prd");
    if (!drAcNo)   missing.push("drAcNo");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) missing.push("amount (must be > 0)");

    if (missing.length) {
        return res.status(400).json({
            status: "Error",
            message: `Missing or invalid fields: ${missing.join(", ")}`
        });
    }

    const txnAmount    = Number(amount);
    const txnNarrative = narrative || `${channel} payment${referenceId ? " - " + referenceId : ""}`;
    // crAcNo defaults to the channel's configured settlement account if not provided
    const creditAccount = crAcNo ? String(crAcNo) : getOffsetAccount(channel);

    // ── Build SOAP XML ────────────────────────────────────────────────────────
    const requestXml = cbsCreateTransaction({
        prd:       String(prd).toUpperCase(),
        drAcNo:    String(drAcNo),
        crAcNo:    creditAccount,
        amount:    txnAmount,
        drBranch:  drBranch ? String(drBranch) : undefined,
        crBranch:  crBranch ? String(crBranch) : undefined,
        currency:  String(currency).toUpperCase(),
        narrative: txnNarrative
    });

    logXml(`CBS TRANSFER REQUEST [${channel}]`, requestXml);

    let responseXml = "";
    let cbsRefNo    = null;
    let isSuccess   = false;
    let errorCode   = null;
    let errorDesc   = null;

    try {
        // ── Call CBS ──────────────────────────────────────────────────────────
        const cbsResponse = await axios.post(CBS_RT_URL, requestXml, {
            headers: {
                "Content-Type": "text/xml;charset=utf-8",
                SOAPAction: "CREATETRANSACTION_FSFS_REQ"
            },
            httpsAgent,
            validateStatus: (s) => s >= 200 && s < 600
        });

        responseXml = cbsResponse.data || "";
        logXml(`CBS TRANSFER RESPONSE [${channel}]`, responseXml);

        // Check for SOAP fault
        const faultString = extractXmlTag(responseXml, "faultstring");
        if (faultString) {
            errorDesc = `CBS Fault: ${faultString}`;
        } else if (cbsResponse.status >= 400) {
            errorDesc = `CBS HTTP ${cbsResponse.status}`;
        } else {
            isSuccess  = responseXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
            cbsRefNo   = extractXmlTag(responseXml, "FCCREF") || extractXmlTag(responseXml, "XREF");
            errorCode  = extractXmlTag(responseXml, "ECODE");
            errorDesc  = extractXmlTag(responseXml, "EDESC");
        }

    } catch (callError) {
        errorDesc   = callError.message;
        responseXml = callError.cbsRawData || "";
    }

    // ── Persist audit row ─────────────────────────────────────────────────────
    let auditRow = null;
    try {
        auditRow = await prisma.cbsTransfer.create({
            data: {
                channel:     String(channel).toUpperCase().slice(0, 30),
                prd:         String(prd).toUpperCase().slice(0, 20),
                drAcNo:      String(drAcNo).slice(0, 50),
                crAcNo:      creditAccount.slice(0, 50),
                drBranch:    drBranch  ? String(drBranch).slice(0, 10)  : null,
                crBranch:    crBranch  ? String(crBranch).slice(0, 10)  : null,
                amount:      txnAmount,
                currency:    String(currency).toUpperCase().slice(0, 5),
                narrative:   txnNarrative ? String(txnNarrative).slice(0, 500) : null,
                referenceId: referenceId  ? String(referenceId).slice(0, 100)  : null,
                traceNumber: traceNumber.slice(0, 150),
                cbsRefNo:    cbsRefNo  ? String(cbsRefNo).slice(0, 50)  : null,
                status:      isSuccess ? 1 : 0,
                errorCode:   errorCode ? String(errorCode).slice(0, 50) : null,
                errorDesc:   errorDesc ? String(errorDesc).slice(0, 500): null,
                requestXml:  requestXml,
                responseXml: responseXml
            }
        });
    } catch (dbErr) {
        console.error("CbsTransfer audit write failed:", dbErr.message);
    }

    // ── Respond ───────────────────────────────────────────────────────────────
    if (isSuccess) {
        return res.status(200).json({
            status:      "Success",
            message:     "CBS transaction completed successfully",
            traceNumber,
            cbsRefNo,
            auditId:     auditRow?.id ?? null
        });
    }

    return res.status(400).json({
        status:      "Error",
        message:     errorDesc || "CBS transaction failed",
        errorCode:   errorCode || null,
        traceNumber,
        auditId:     auditRow?.id ?? null
    });
};

// ─── POST /cbs/reverse ────────────────────────────────────────────────────────
/**
 * Reverse a previous CBS transaction by its FCCREF.
 *
 * Body: { cbsRefNo: string }
 */
const cbsReverse = async (req, res) => {
    const { cbsRefNo } = req.body;
    if (!cbsRefNo) {
        return res.status(400).json({ status: "Error", message: "cbsRefNo is required" });
    }

    const requestXml = cbsReverseTransaction(String(cbsRefNo));
    logXml("CBS REVERSE REQUEST", requestXml);

    try {
        const cbsResponse = await axios.post(CBS_RT_URL, requestXml, {
            headers: {
                "Content-Type": "text/xml;charset=utf-8",
                SOAPAction: "REVERSETRANSACTION_FSFS_REQ"
            },
            httpsAgent,
            validateStatus: (s) => s >= 200 && s < 600
        });

        const responseXml = cbsResponse.data || "";
        logXml("CBS REVERSE RESPONSE", responseXml);

        const faultString = extractXmlTag(responseXml, "faultstring");
        if (faultString) {
            return res.status(400).json({ status: "Error", message: `CBS Fault: ${faultString}` });
        }

        const isSuccess  = responseXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        const reverseRef = extractXmlTag(responseXml, "FCCREF") || cbsRefNo;
        const errorCode  = extractXmlTag(responseXml, "ECODE");
        const errorDesc  = extractXmlTag(responseXml, "EDESC");

        if (isSuccess) {
            return res.status(200).json({
                status:     "Success",
                message:    "CBS reversal completed successfully",
                cbsRefNo:   reverseRef
            });
        }

        return res.status(400).json({
            status:    "Error",
            message:   errorDesc || "CBS reversal failed",
            errorCode: errorCode || null
        });

    } catch (error) {
        return res.status(500).json({
            status:  "Error",
            message: error.message
        });
    }
};

// ─── GET /cbs/transfers ───────────────────────────────────────────────────────
/**
 * Query transfer audit log.
 * Query params: channel, referenceId, status, from, to, page, limit
 */
const getTransfers = async (req, res) => {
    const { channel, referenceId, status, from, to, page = 1, limit = 20 } = req.query;

    const where = {};
    if (channel)     where.channel     = String(channel).toUpperCase();
    if (referenceId) where.referenceId = { contains: String(referenceId) };
    if (status !== undefined) where.status = Number(status);
    if (from || to) {
        where.entryTime = {};
        if (from) where.entryTime.gte = new Date(from);
        if (to)   where.entryTime.lte = new Date(to);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [rows, total] = await Promise.all([
        prisma.cbsTransfer.findMany({
            where,
            orderBy: { entryTime: "desc" },
            skip,
            take: Number(limit)
        }),
        prisma.cbsTransfer.count({ where })
    ]);

    return res.status(200).json({
        status: "Success",
        total,
        page:   Number(page),
        limit:  Number(limit),
        data:   rows
    });
};

export { cbsTransfer, cbsReverse, getTransfers };
