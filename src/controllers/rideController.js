import axios from "axios";
import https from "https";
import { config } from "dotenv";
import { prisma } from "../config/db.js";
import { cbsCreateTransaction, CBS_PRD, getOffsetAccount, attemptAutoReversal, extractXmlTag } from "../services/cbsXmlService.js";
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
 * Creates the RideTransaction audit row and returns auditId.
 * The frontend must pass auditId back to /ride/pay.
 *
 * Body: { phone: "251911259134" }
 */
const queryRideAccount = async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ status: "Error", message: "phone is required" });
    }

    const payload = { phone: String(phone) };
    logJson("RIDE QUERY REQUEST", payload);

    let auditId = null;

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

        // Create the single audit row for this transaction
        const audit = await prisma.rideTransaction.create({
            data: {
                phone:         String(phone).slice(0, 20),
                fullName:      rideRes.data?.full_name ? String(rideRes.data.full_name).slice(0, 200) : null,
                accountStatus: rideRes.data?.status    ? String(rideRes.data.status).slice(0, 20)     : null,
                queryStatus:   isFound ? 1 : 0,
                queryResponse: JSON.stringify(rideRes.data)
            }
        }).catch(e => { console.error("RideTransaction create failed:", e.message); return null; });

        auditId = audit?.id ?? null;

        if (isBadAuth) {
            return res.status(401).json({
                status:  "Error",
                message: `Ride API authentication failed: ${rideMessage}`,
                data:    rideRes.data,
                auditId
            });
        }
        if (!isFound) {
            return res.status(404).json({
                status:  "Error",
                message: rideMessage || "Phone number not found on Ride",
                data:    rideRes.data,
                auditId
            });
        }
        if (!isActive) {
            return res.status(422).json({
                status:  "Error",
                message: `Ride account is not active (status: ${rideRes.data?.status})`,
                data:    rideRes.data,
                auditId
            });
        }

        return res.status(200).json({
            status:  "Success",
            message: "Ride account is active",
            data:    rideRes.data,
            auditId  // ← frontend must send this back in /ride/pay
        });

    } catch (error) {
        return res.status(500).json({ status: "Error", message: error.message, auditId });
    }
};

// ─── POST /ride/pay ───────────────────────────────────────────────────────────
/**
 * Execute payment: CBS debit → Ride confirm.
 * UPDATES the existing RideTransaction row created by /ride/query (via auditId).
 *
 * Body:
 * {
 *   auditId:   28              (required — from /ride/query response)
 *   phone:     "251911259134"  (required)
 *   amount:    300             (required)
 *   drAcNo:    "001123..."     (required)
 *   drBranch:  "001"           (optional)
 *   remark:    "Ride top-up"  (optional)
 *   billRefNo: "BR7654321"     (optional — auto-generated if omitted)
 * }
 */
const payRide = async (req, res) => {
    const { auditId: bodyAuditId, phone, amount, drAcNo, drBranch, remark, billRefNo: bodyBillRef } = req.body;

    const missing = [];
    if (!phone)  missing.push("phone");
    if (!drAcNo) missing.push("drAcNo");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) missing.push("amount (must be > 0)");
    if (missing.length) {
        return res.status(400).json({ status: "Error", message: `Missing or invalid: ${missing.join(", ")}` });
    }

    const txnAmount  = Number(amount);
    const transTime  = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14); // YYYYMMDDHHmmss
    const billRefNo  = bodyBillRef || `BR${Date.now()}`;
    const txnRemark  = remark || `Ride payment - ${phone}`;
    // Branch = first 3 chars of account number (e.g. "0011230708313001" → "001")
    const resolvedBranch = drBranch || String(drAcNo).slice(0, 3);

    // Resolve audit row: use auditId from query step if provided,
    // otherwise find the latest pending query row for this phone
    let auditId = bodyAuditId ? Number(bodyAuditId) : null;
    if (!auditId) {
        const existing = await prisma.rideTransaction.findFirst({
            where: { phone: String(phone).slice(0, 20), queryStatus: 1, paymentStatus: 0 },
            orderBy: { id: "desc" }
        }).catch(() => null);
        auditId = existing?.id ?? null;
    }

    // Helper: update the single audit row
    const updateAudit = async (data) => {
        if (!auditId) return;
        await prisma.rideTransaction.update({ where: { id: auditId }, data })
            .catch(e => console.error("RideTransaction update failed:", e.message));
    };

    // Stamp payment fields onto the row
    await updateAudit({
        amount:    txnAmount,
        billRefNo: String(billRefNo).slice(0, 100),
        transTime,
        remark:    String(txnRemark).slice(0, 500),
        drAcNo:    String(drAcNo).slice(0, 50),
        crAcNo:    String(CBS_CR_ACCOUNT).slice(0, 50)
    });

    try {
        // ── Step 1: CBS CreateTransaction ─────────────────────────────────────
        const requestXml = cbsCreateTransaction({
            prd:       CBS_PRD.RIDE,
            drAcNo:    String(drAcNo),
            crAcNo:    CBS_CR_ACCOUNT,
            amount:    txnAmount,
            drBranch:  resolvedBranch,
            currency:  "ETB",
            narrative: `Ride payment ${phone} - ${billRefNo}`
        });

        logXml("CBS RIDE REQUEST", requestXml);

        const cbsRes = await axios.post(CBS_RT_URL, requestXml, {
            headers: { "Content-Type": "text/xml;charset=utf-8", SOAPAction: "CREATETRANSACTION_FSFS_REQ" },
            httpsAgent,
            validateStatus: (s) => s >= 200 && s < 600
        });

        const cbsXml     = cbsRes.data || "";
        logXml("CBS RIDE RESPONSE", cbsXml);

        const cbsFault   = extractXmlTag(cbsXml, "faultstring");
        const cbsSuccess = !cbsFault && cbsXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        const cbsRefNo   = extractXmlTag(cbsXml, "FCCREF") || extractXmlTag(cbsXml, "XREF");
        const cbsErrCode = extractXmlTag(cbsXml, "ECODE");
        const cbsErrDesc = extractXmlTag(cbsXml, "EDESC") || cbsFault;
        // Use CBS book date as the canonical transaction date
        const cbsBookDate = extractXmlTag(cbsXml, "BOOKDATE"); // e.g. "2026-04-29"
        const cbsTrnDate  = cbsBookDate ? new Date(cbsBookDate) : new Date();

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

        // ── Step 2: Confirm payment to Ride ───────────────────────────────────
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

        await updateAudit({
            acknowledgementId: ackId ? String(ackId).slice(0, 100) : null,
            paymentStatus:     confirmOk ? 1 : 0,
            confirmResponse:   JSON.stringify(confirmRes.data),
            errorDesc:         confirmOk ? null : String(confirmRes.data?.message || "Ride confirm failed").slice(0, 500)
        });

        if (!confirmOk) {
            // ── Auto-reverse CBS since Ride confirm failed ────────────────────
            const reversal = await attemptAutoReversal(cbsRefNo, CBS_RT_URL, httpsAgent, axios.post.bind(axios));
            await updateAudit({
                paymentStatus:     0,
                autoReversed:      reversal.success ? 1 : 0,
                autoReversalRef:   reversal.reversalRef,
                autoReversalError: reversal.error,
                errorDesc:         String(confirmRes.data?.message || "Ride confirm failed").slice(0, 500)
            });
            // Also mark the Transactions row as auto-reversed
            if (cbsRefNo) {
                await prisma.transactions.updateMany({
                    where: { cbsRefNo: String(cbsRefNo) },
                    data: {
                        status:            0,
                        autoReversed:      reversal.success ? 1 : 0,
                        autoReversalRef:   reversal.reversalRef,
                        autoReversalError: reversal.error
                    }
                }).catch(e => console.error("Transactions auto-reversal update failed:", e.message));
            }
            return res.status(400).json({
                status:        "Error",
                message:       confirmRes.data?.message || "Ride payment confirmation failed",
                autoReversed:  reversal.success,
                autoReversalRef: reversal.reversalRef,
                auditId
            });
        }

        // ── Step 3: Write Transactions journal (CBS book date as trnDate) ─────
        await prisma.transactions.create({
            data: {
                trnDate:      cbsTrnDate,
                processedTime: new Date(),
                drAcNo:       String(drAcNo).slice(0, 50),
                crAcNo:       String(CBS_CR_ACCOUNT).slice(0, 50),
                amount:       txnAmount,
                currencyCode: "ETB",
                cbsRefNo:     cbsRefNo ? String(cbsRefNo).slice(0, 50) : null,
                remarks:      String(txnRemark).slice(0, 500),
                particulars:  `Ride payment ${phone}`,
                custIden:     String(phone).slice(0, 50),
                status:       1,
                channel:      "RIDE",
                entryTime:    new Date()
            }
        }).catch(e => console.error("Transactions write failed:", e.message));

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
