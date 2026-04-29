import axios from "axios";
import https from "https";
import { config } from "dotenv";
import { prisma } from "../config/db.js";
import { cbsCreateTransaction, CBS_PRD, getOffsetAccount, attemptAutoReversal, insertTransactionJournal, extractXmlTag } from "../services/cbsXmlService.js";
config();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const RIDE_BASE_URL  = (process.env.RIDE_BASE_URL  || "https://stagingmp.rideplus.co").trim().replace(/\/$/, "");
const RIDE_USERNAME  = (process.env.RIDE_USERNAME  || "enatstagingpassword").trim();
const RIDE_PASSWORD  = (process.env.RIDE_PASSWORD  || "enat@mpstaging!").trim();
const CBS_RT_URL     = (process.env.cbs_endpoint   || process.env.cbs_url || "http://10.1.22.100:7003/FCUBSRTService/FCUBSRTService").trim();
const CBS_CR_ACCOUNT = (process.env.ride_cr_account || getOffsetAccount("RIDE")).trim();

const rideAuth    = { username: RIDE_USERNAME, password: RIDE_PASSWORD };
const rideHeaders = () => ({ "Content-Type": "application/json" });

const logJson = (label, data) =>
    console.log(`\n===== ${label} =====\n${JSON.stringify(data, null, 2)}\n===== END ${label} =====\n`);
const logXml = (label, xml) =>
    console.log(`\n===== ${label} =====\n${xml}\n===== END ${label} =====\n`);

// ─── POST /ride/query ─────────────────────────────────────────────────────────
/**
 * Verify phone is an active Ride account.
 * INSERT into RideTransaction ONLY when account is active.
 * Returns auditId — frontend must pass it back to /ride/pay.
 *
 * DB writes: 1 INSERT (only on success)
 */
const queryRideAccount = async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ status: "Error", message: "phone is required" });
    }

    const payload = { phone: String(phone) };
    logJson("RIDE QUERY REQUEST", payload);

    try {
        const rideRes = await axios.post(
            `${RIDE_BASE_URL}/api/v1/bank/enat/bill/query`,
            payload,
            { headers: rideHeaders(), auth: rideAuth, httpsAgent, validateStatus: (s) => s >= 200 && s < 600 }
        );

        logJson("RIDE QUERY RESPONSE", rideRes.data);

        const rideMessage = rideRes.data?.message || "";
        const isBadAuth   = rideRes.status === 401
            || rideMessage.toLowerCase().includes("bad auth")
            || rideMessage.toLowerCase().includes("unauthorized");
        const isFound  = rideRes.status < 400 && rideRes.data?.phone && !isBadAuth;
        const isActive = isFound && rideRes.data?.status === "active";

        // ── Only insert a row when account is confirmed active ────────────────
        if (!isActive) {
            const msg = isBadAuth
                ? `Ride API authentication failed: ${rideMessage}`
                : !isFound
                    ? (rideMessage || "Phone number not found on Ride")
                    : `Ride account is not active (status: ${rideRes.data?.status})`;

            const status = isBadAuth ? 401 : !isFound ? 404 : 422;
            return res.status(status).json({
                status:  "Error",
                message: msg,
                data:    rideRes.data
            });
        }

        // Active — create the single audit row
        const audit = await prisma.rideTransaction.create({
            data: {
                phone:         String(phone).slice(0, 20),
                fullName:      rideRes.data.full_name ? String(rideRes.data.full_name).slice(0, 200) : null,
                accountStatus: String(rideRes.data.status).slice(0, 20),
                queryStatus:   1,
                queryResponse: JSON.stringify(rideRes.data)
            }
        });

        return res.status(200).json({
            status:  "Success",
            message: "Ride account is active",
            data:    rideRes.data,
            auditId: audit.id   // ← frontend must send this back in /ride/pay
        });

    } catch (error) {
        return res.status(500).json({ status: "Error", message: error.message });
    }
};

// ─── POST /ride/pay ───────────────────────────────────────────────────────────
/**
 * Execute payment: CBS debit → Ride confirm.
 * All DB operations are UPDATEs on the single row created by /ride/query.
 * One INSERT into Transactions on full success.
 *
 * DB writes:
 *   UPDATE RideTransaction — payment fields (amount, acno, billRef…)
 *   UPDATE RideTransaction — CBS result (cbsRefNo, cbsStatus)
 *   UPDATE RideTransaction — confirm result (ackId, paymentStatus) or reversal fields
 *   INSERT Transactions    — only on full success
 *
 * Body:
 * {
 *   auditId:   28              (required — from /ride/query response)
 *   phone:     "251911259134"  (required)
 *   amount:    300             (required)
 *   drAcNo:    "001123..."     (required)
 *   remark:    "Ride top-up"  (optional)
 *   billRefNo: "BR7654321"     (optional — auto-generated if omitted)
 * }
 */
const payRide = async (req, res) => {
    const { auditId: bodyAuditId, phone, amount, drAcNo, remark, billRefNo: bodyBillRef, channel: frontendChannel } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    const missing = [];
    if (!phone)  missing.push("phone");
    if (!drAcNo) missing.push("drAcNo");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) missing.push("amount (must be > 0)");
    if (missing.length) {
        return res.status(400).json({ status: "Error", message: `Missing or invalid: ${missing.join(", ")}` });
    }

    const txnAmount      = Number(amount);
    const transTime      = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
    const billRefNo      = bodyBillRef || `BR${Date.now()}`;
    const txnRemark      = remark || `Ride payment - ${phone}`;

    // ── Resolve the audit row ─────────────────────────────────────────────────
    // Priority: auditId from request → latest active+unpaid row for this phone
    let auditId = bodyAuditId ? Number(bodyAuditId) : null;
    if (!auditId) {
        const existing = await prisma.rideTransaction.findFirst({
            where: { phone: String(phone).slice(0, 20), queryStatus: 1, paymentStatus: 0 },
            orderBy: { id: "desc" }
        }).catch(() => null);
        auditId = existing?.id ?? null;
    }

    if (!auditId) {
        return res.status(400).json({
            status:  "Error",
            message: "No verified query found for this phone. Please call /ride/query first."
        });
    }

    // Single helper — all DB changes go through here (UPDATE only)
    const updateAudit = async (data) => {
        await prisma.rideTransaction.update({ where: { id: auditId }, data })
            .catch(e => console.error("RideTransaction update failed:", e.message));
    };

    // ── UPDATE 1: stamp payment intent fields ─────────────────────────────────
    await updateAudit({
        amount:    txnAmount,
        billRefNo: String(billRefNo).slice(0, 100),
        transTime,
        remark:    String(txnRemark).slice(0, 500),
        drAcNo:    String(drAcNo).slice(0, 50),
        crAcNo:    String(CBS_CR_ACCOUNT).slice(0, 50)
    });

    try {
        // ── CBS CreateTransaction ─────────────────────────────────────────────
        const requestXml = cbsCreateTransaction({
            channel:   "RIDE",
            prd:       CBS_PRD.RIDE,
            drAcNo:    String(drAcNo),
            crAcNo:    CBS_CR_ACCOUNT,
            amount:    txnAmount,
            currency:  "ETB",
            narrative: `Ride payment ${phone} - ${billRefNo}`
        });

        logXml("CBS RIDE REQUEST", requestXml);

        // Log CBS request to CbsReqRes
        await prisma.cbsReqRes.create({
            data: { orderId: String(phone).slice(0, 20), type: 1, data: requestXml }
        }).catch(e => console.error("CbsReqRes req write failed:", e.message));

        const cbsRes = await axios.post(CBS_RT_URL, requestXml, {
            headers: { "Content-Type": "text/xml;charset=utf-8", SOAPAction: "CREATETRANSACTION_FSFS_REQ" },
            httpsAgent,
            validateStatus: (s) => s >= 200 && s < 600
        });

        const cbsXml      = cbsRes.data || "";
        logXml("CBS RIDE RESPONSE", cbsXml);

        // Log CBS response to CbsReqRes
        await prisma.cbsReqRes.create({
            data: { orderId: String(phone).slice(0, 20), type: 2, data: cbsXml }
        }).catch(e => console.error("CbsReqRes resp write failed:", e.message));

        const cbsFault    = extractXmlTag(cbsXml, "faultstring");
        const cbsSuccess  = !cbsFault && cbsXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        const cbsRefNo    = extractXmlTag(cbsXml, "FCCREF") || extractXmlTag(cbsXml, "XREF");
        const cbsErrCode  = extractXmlTag(cbsXml, "ECODE");
        const cbsErrDesc  = extractXmlTag(cbsXml, "EDESC") || cbsFault;
        const cbsBookDate = extractXmlTag(cbsXml, "BOOKDATE");
        const cbsTrnDate  = cbsBookDate ? new Date(cbsBookDate) : new Date();

        // ── UPDATE 2: CBS result ──────────────────────────────────────────────
        await updateAudit({
            cbsRefNo:  cbsRefNo ? String(cbsRefNo).slice(0, 50) : null,
            cbsStatus: cbsSuccess ? 1 : 0,
            errorDesc: cbsSuccess ? null : String(cbsErrDesc || "CBS transaction failed").slice(0, 500)
        });

        if (!cbsSuccess) {
            return res.status(400).json({
                status:    "Error",
                message:   cbsErrDesc || "CBS transaction failed",
                errorCode: cbsErrCode || null,
                auditId
            });
        }

        // ── Ride ConfirmPayment ───────────────────────────────────────────────
        const confirmPayload = {
            amount:      String(txnAmount),
            bill_ref_no: billRefNo,
            phone:       String(phone),
            trans_time:  transTime,
            remark:      txnRemark
        };

        logJson("RIDE CONFIRM REQUEST", confirmPayload);

        const confirmRes = await axios.post(
            `${RIDE_BASE_URL}/api/v1/bank/enat/bill/confirm`,
            confirmPayload,
            { headers: rideHeaders(), auth: rideAuth, httpsAgent, validateStatus: (s) => s >= 200 && s < 600 }
        );

        logJson("RIDE CONFIRM RESPONSE", confirmRes.data);

        const ackId     = confirmRes.data?.acknowledgement_id || null;
        const confirmOk = confirmRes.status < 400 && !!ackId;

        if (!confirmOk) {
            // ── Ride confirm failed → auto-reverse CBS ────────────────────────
            const reversal = await attemptAutoReversal(cbsRefNo, CBS_RT_URL, httpsAgent, axios.post.bind(axios));

            // ── UPDATE 3a: confirm failure + reversal result ──────────────────
            await updateAudit({
                confirmResponse:   JSON.stringify(confirmRes.data),
                paymentStatus:     0,
                autoReversed:      reversal.success ? 1 : 0,
                autoReversalRef:   reversal.reversalRef,
                autoReversalError: reversal.error,
                errorDesc:         String(confirmRes.data?.message || "Ride confirm failed").slice(0, 500)
            });

            return res.status(400).json({
                status:          "Error",
                message:         confirmRes.data?.message || "Ride payment confirmation failed",
                autoReversed:    reversal.success,
                autoReversalRef: reversal.reversalRef,
                auditId
            });
        }

        // ── UPDATE 3b: full success ───────────────────────────────────────────
        await updateAudit({
            acknowledgementId: String(ackId).slice(0, 100),
            confirmResponse:   JSON.stringify(confirmRes.data),
            paymentStatus:     1,
            errorDesc:         null
        });

        // ── INSERT Transactions journal (DR + CR rows, only on full success) ─
        await insertTransactionJournal({
            prisma,
            cbsChannel:      "RIDE",
            frontendChannel: frontendChannel || "IB",
            drAcNo:          String(drAcNo),
            crAcNo:          CBS_CR_ACCOUNT,
            amount:          txnAmount,
            cbsRefNo:        cbsRefNo,
            trnDate:         cbsTrnDate,
            utility:         String(phone),
            utilRefNo:       billRefNo,
            particulars:     `Ride payment ${phone}`,
            currency:        "ETB",
            comAmount:       Number(extractXmlTag(cbsXml, "CHGAMT") || 0),
            disasterRiskAmt: Number(extractXmlTag(cbsXml, "LCYCHG") || 0)
        });

        return res.status(200).json({
            status:            "Success",
            message:           "Ride payment completed successfully",
            acknowledgementId: ackId,
            cbsRefNo,
            billRefNo,
            auditId
        });

    } catch (error) {
        await updateAudit({ errorDesc: String(error.message).slice(0, 500) });
        return res.status(500).json({ status: "Error", message: error.message, auditId });
    }
};

// ─── GET /ride/transactions ───────────────────────────────────────────────────
const getRideTransactions = async (req, res) => {
    const { phone, paymentStatus, cbsStatus, from, to, page = 1, limit = 20 } = req.query;

    const where = {};
    if (phone)                       where.phone         = { contains: String(phone) };
    if (paymentStatus !== undefined) where.paymentStatus = Number(paymentStatus);
    if (cbsStatus     !== undefined) where.cbsStatus     = Number(cbsStatus);
    if (from || to) {
        where.entryTime = {};
        if (from) where.entryTime.gte = new Date(from);
        if (to)   where.entryTime.lte = new Date(to);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [rows, total] = await Promise.all([
        prisma.rideTransaction.findMany({ where, orderBy: { entryTime: "desc" }, skip, take: Number(limit) }),
        prisma.rideTransaction.count({ where })
    ]);

    return res.status(200).json({ status: "Success", total, page: Number(page), limit: Number(limit), data: rows });
};

export { queryRideAccount, payRide, getRideTransactions };
