import axios from "axios";
import https from "https";
import { config } from "dotenv";
import { prisma } from "../config/db.js";
import {
    cbsQueryAccount,
    cbsCreateTransaction,
    CBS_PRD,
    attemptAutoReversal,
    insertTransactionJournal,
    extractXmlTag
} from "../services/cbsXmlService.js";
config();

const httpsAgent  = new https.Agent({ rejectUnauthorized: false });
const CBS_RT_URL  = (process.env.cbs_endpoint || process.env.cbs_url || "http://10.1.22.100:7003/FCUBSRTService/FCUBSRTService").trim();
const CBS_ACC_URL = (process.env.cbs_acc_url  || "http://10.1.22.100:7003/FCUBSAccService/FCUBSAccService").trim();

const logXml  = (label, xml)  => console.log(`\n===== ${label} =====\n${xml}\n===== END ${label} =====\n`);

// ─── Helper: query CBS account details ───────────────────────────────────────
const fetchAccountDetails = async (acNo) => {
    const xml = cbsQueryAccount(String(acNo));
    logXml(`CBS QUERY ACCOUNT [${acNo}]`, xml);

    const res = await axios.post(CBS_ACC_URL, xml, {
        headers: { "Content-Type": "text/xml;charset=utf-8", SOAPAction: "" },
        httpsAgent,
        validateStatus: (s) => s >= 200 && s < 600
    });

    const responseXml = res.data || "";
    logXml(`CBS QUERY ACCOUNT RESPONSE [${acNo}]`, responseXml);

    // Log to CbsReqRes
    await prisma.cbsReqRes.create({
        data: { orderId: String(acNo).slice(0, 20), type: 1, data: xml }
    }).catch(() => {});
    await prisma.cbsReqRes.create({
        data: { orderId: String(acNo).slice(0, 20), type: 2, data: responseXml }
    }).catch(() => {});

    const fault = extractXmlTag(responseXml, "faultstring");
    if (fault) throw new Error(`CBS Fault: ${fault}`);

    const isSuccess = responseXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
    if (!isSuccess) {
        const errDesc = extractXmlTag(responseXml, "EDESC") || "Account not found";
        throw new Error(errDesc);
    }

    const custName  = extractXmlTag(responseXml, "CUSTNAME");
    const accStat   = extractXmlTag(responseXml, "ACCSTAT");   // NORM, DORM, etc.
    const frozen    = extractXmlTag(responseXml, "FROZEN");    // Y/N
    const noCredit  = extractXmlTag(responseXml, "ACSTATNOCR"); // Y = no credit allowed
    const noDebit   = extractXmlTag(responseXml, "ACSTATNODR"); // Y = no debit allowed
    const ccy       = extractXmlTag(responseXml, "CCY");

    return { acNo, custName, accStat, frozen, noCredit, noDebit, ccy, raw: responseXml };
};

// ─── POST /a2a/validate ───────────────────────────────────────────────────────
/**
 * Validate both debit and credit accounts before showing the transfer form.
 * Body: { drAcNo, crAcNo }
 */
const validateAccounts = async (req, res) => {
    const { drAcNo, crAcNo } = req.body;
    if (!drAcNo || !crAcNo) {
        return res.status(400).json({ status: "Error", message: "drAcNo and crAcNo are required" });
    }
    if (drAcNo === crAcNo) {
        return res.status(400).json({ status: "Error", message: "Debit and credit accounts must be different" });
    }

    try {
        const [dr, cr] = await Promise.all([
            fetchAccountDetails(drAcNo),
            fetchAccountDetails(crAcNo)
        ]);

        // Check debit account can be debited
        if (dr.frozen === "Y") {
            return res.status(422).json({ status: "Error", message: `Debit account ${drAcNo} is frozen` });
        }
        if (dr.noDebit === "Y") {
            return res.status(422).json({ status: "Error", message: `Debit account ${drAcNo} does not allow debits` });
        }

        // Check credit account can be credited
        if (cr.frozen === "Y") {
            return res.status(422).json({ status: "Error", message: `Credit account ${crAcNo} is frozen` });
        }
        if (cr.noCredit === "Y") {
            return res.status(422).json({ status: "Error", message: `Credit account ${crAcNo} does not allow credits` });
        }

        return res.status(200).json({
            status: "Success",
            dr: { acNo: dr.acNo, name: dr.custName, status: dr.accStat, currency: dr.ccy },
            cr: { acNo: cr.acNo, name: cr.custName, status: cr.accStat, currency: cr.ccy }
        });

    } catch (error) {
        return res.status(400).json({ status: "Error", message: error.message });
    }
};

// ─── POST /a2a/transfer ───────────────────────────────────────────────────────
/**
 * Execute A2A transfer:
 *   1. Validate both accounts (query CBS)
 *   2. Check credit account allows credits — if not, skip CBS and return error
 *   3. CBS CreateTransaction
 *   4. Write A2ATransfer + Transactions journal
 *
 * Body: { drAcNo, crAcNo, amount, narrative, currency? }
 */
const a2aTransfer = async (req, res) => {
    const { drAcNo, crAcNo, amount, narrative, currency = "ETB" } = req.body;

    const missing = [];
    if (!drAcNo)  missing.push("drAcNo");
    if (!crAcNo)  missing.push("crAcNo");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) missing.push("amount (must be > 0)");
    if (missing.length) {
        return res.status(400).json({ status: "Error", message: `Missing or invalid: ${missing.join(", ")}` });
    }
    if (drAcNo === crAcNo) {
        return res.status(400).json({ status: "Error", message: "Debit and credit accounts must be different" });
    }

    const txnAmount  = Number(amount);
    const txnNarrative = narrative || `A2A transfer ${drAcNo} → ${crAcNo}`;

    // ── Step 1: Validate both accounts ───────────────────────────────────────
    let drInfo, crInfo;
    try {
        [drInfo, crInfo] = await Promise.all([
            fetchAccountDetails(drAcNo),
            fetchAccountDetails(crAcNo)
        ]);
    } catch (err) {
        return res.status(400).json({ status: "Error", message: err.message });
    }

    // ── Step 2: Check credit account allows credits ───────────────────────────
    if (crInfo.noCredit === "Y") {
        return res.status(422).json({
            status:  "Error",
            message: `Credit account ${crAcNo} (${crInfo.custName}) does not allow credits`,
            cr: { acNo: crInfo.acNo, name: crInfo.custName, status: crInfo.accStat }
        });
    }
    if (drInfo.noDebit === "Y" || drInfo.frozen === "Y") {
        return res.status(422).json({
            status:  "Error",
            message: `Debit account ${drAcNo} (${drInfo.custName}) does not allow debits or is frozen`,
            dr: { acNo: drInfo.acNo, name: drInfo.custName, status: drInfo.accStat }
        });
    }

    // Create audit row
    let audit = null;
    try {
        audit = await prisma.a2ATransfer.create({
            data: {
                drAcNo:   String(drAcNo).slice(0, 20),
                drAcName: drInfo.custName ? String(drInfo.custName).slice(0, 200) : null,
                crAcNo:   String(crAcNo).slice(0, 20),
                crAcName: crInfo.custName ? String(crInfo.custName).slice(0, 200) : null,
                amount:   txnAmount,
                currency: String(currency).slice(0, 5),
                narrative: txnNarrative.slice(0, 500),
                status:   0
            }
        });
    } catch (e) {
        console.error("A2ATransfer create failed:", e.message);
    }
    const auditId = audit?.id ?? null;

    const updateAudit = async (data) => {
        if (!auditId) return;
        await prisma.a2ATransfer.update({ where: { id: auditId }, data })
            .catch(e => console.error("A2ATransfer update failed:", e.message));
    };

    try {
        // ── Step 3: CBS CreateTransaction ─────────────────────────────────────
        const requestXml = cbsCreateTransaction({
            channel:   "A2A",
            prd:       CBS_PRD.OTHER,
            drAcNo:    String(drAcNo),
            crAcNo:    String(crAcNo),
            amount:    txnAmount,
            currency:  String(currency).toUpperCase(),
            narrative: txnNarrative
        });

        logXml("CBS A2A REQUEST", requestXml);
        await prisma.cbsReqRes.create({
            data: { orderId: String(drAcNo).slice(0, 20), type: 1, data: requestXml }
        }).catch(() => {});

        const cbsRes = await axios.post(CBS_RT_URL, requestXml, {
            headers: { "Content-Type": "text/xml;charset=utf-8", SOAPAction: "CREATETRANSACTION_FSFS_REQ" },
            httpsAgent,
            validateStatus: (s) => s >= 200 && s < 600
        });

        const cbsXml     = cbsRes.data || "";
        logXml("CBS A2A RESPONSE", cbsXml);
        await prisma.cbsReqRes.create({
            data: { orderId: String(drAcNo).slice(0, 20), type: 2, data: cbsXml }
        }).catch(() => {});

        const cbsFault   = extractXmlTag(cbsXml, "faultstring");
        const cbsSuccess = !cbsFault && cbsXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        const cbsRefNo   = extractXmlTag(cbsXml, "FCCREF") || extractXmlTag(cbsXml, "XREF");
        const cbsErrCode = extractXmlTag(cbsXml, "ECODE");
        const cbsErrDesc = extractXmlTag(cbsXml, "EDESC") || cbsFault;
        const cbsBookDate = extractXmlTag(cbsXml, "BOOKDATE");
        const cbsTrnDate  = cbsBookDate ? new Date(cbsBookDate) : new Date();

        if (!cbsSuccess) {
            await updateAudit({ status: 0, errorDesc: String(cbsErrDesc || "CBS transaction failed").slice(0, 500) });
            return res.status(400).json({
                status:    "Error",
                message:   cbsErrDesc || "CBS transaction failed",
                errorCode: cbsErrCode || null,
                auditId
            });
        }

        // ── Step 4: Write journal + update audit ──────────────────────────────
        await updateAudit({ cbsRefNo: cbsRefNo ? String(cbsRefNo).slice(0, 50) : null, status: 1 });

        await insertTransactionJournal({
            prisma,
            cbsChannel:      "A2A",
            frontendChannel: "API",
            drAcNo:          String(drAcNo),
            crAcNo:          String(crAcNo),
            amount:          txnAmount,
            cbsRefNo,
            trnDate:         cbsTrnDate,
            utility:         `${drAcNo}→${crAcNo}`,
            utilRefNo:       cbsRefNo || "",
            particulars:     txnNarrative,
            currency:        String(currency).toUpperCase(),
            comAmount:       Number(extractXmlTag(cbsXml, "CHGAMT") || 0),
            disasterRiskAmt: Number(extractXmlTag(cbsXml, "LCYCHG") || 0)
        });

        return res.status(200).json({
            status:   "Success",
            message:  "Transfer completed successfully",
            cbsRefNo,
            dr:       { acNo: drInfo.acNo, name: drInfo.custName },
            cr:       { acNo: crInfo.acNo, name: crInfo.custName },
            amount:   txnAmount,
            currency,
            auditId
        });

    } catch (error) {
        // If CBS succeeded but something else failed, attempt auto-reversal
        const reversal = await attemptAutoReversal(
            audit?.cbsRefNo || null, CBS_RT_URL, httpsAgent, axios.post.bind(axios)
        );
        await updateAudit({
            status:          0,
            autoReversed:    reversal.success ? 1 : 0,
            autoReversalRef: reversal.reversalRef,
            errorDesc:       String(error.message).slice(0, 500)
        });
        return res.status(500).json({ status: "Error", message: error.message, auditId });
    }
};

// ─── GET /a2a/transfers ───────────────────────────────────────────────────────
const getA2ATransfers = async (req, res) => {
    const { drAcNo, crAcNo, status, from, to, page = 1, limit = 20 } = req.query;
    const where = {};
    if (drAcNo)  where.drAcNo = { contains: String(drAcNo) };
    if (crAcNo)  where.crAcNo = { contains: String(crAcNo) };
    if (status !== undefined) where.status = Number(status);
    if (from || to) {
        where.entryTime = {};
        if (from) where.entryTime.gte = new Date(from);
        if (to)   where.entryTime.lte = new Date(to);
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [rows, total] = await Promise.all([
        prisma.a2ATransfer.findMany({ where, orderBy: { entryTime: "desc" }, skip, take: Number(limit) }),
        prisma.a2ATransfer.count({ where })
    ]);
    return res.status(200).json({ status: "Success", total, page: Number(page), limit: Number(limit), data: rows });
};

export { validateAccounts, a2aTransfer, getA2ATransfers };
