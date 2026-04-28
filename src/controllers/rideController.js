import axios from "axios";
import https from "https";
import { config } from "dotenv";
import { prisma } from "../config/db.js";
import { buildGenericTransactionXml, extractXmlTag } from "../services/cbsXmlService.js";
config();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const RIDE_BASE_URL   = (process.env.RIDE_BASE_URL   || "https://stagingmp.rideplus.co").trim().replace(/\/$/, "");
const RIDE_USERNAME   = (process.env.RIDE_USERNAME   || "enatstagingpassword").trim();
const RIDE_PASSWORD   = (process.env.RIDE_PASSWORD   || "enat@mpstaging!").trim();
const CBS_RT_URL      = process.env.cbs_endpoint     || process.env.cbs_url || "http://10.1.22.100:7003/FCUBSRTService/FCUBSRTService";
const CBS_CR_ACCOUNT  = process.env.ride_cr_account  || process.env.cbs_offset_account || "0461112216017001";

// Ride auth — passed as axios `auth` option (same pattern as FlyGate)
const rideAuth = { username: RIDE_USERNAME, password: RIDE_PASSWORD };

const rideHeaders = () => ({ "Content-Type": "application/json" });

const logJson = (label, data) =>
    console.log(`\n===== ${label} =====\n${JSON.stringify(data, null, 2)}\n===== END ${label} =====\n`);

const logXml = (label, xml) =>
    console.log(`\n===== ${label} =====\n${xml}\n===== END ${label} =====\n`);

// ─── POST /ride/query ─────────────────────────────────────────────────────────
/**
 * Check if a phone number is a valid active Ride account.
 *
 * Body: { phone: "251911259134" }
 *
 * Response:
 *   200 { status:"Success", data:{ full_name, phone, status } }
 *   404 { status:"Error", message:"Phone not found or inactive" }
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

        const isActive = rideRes.data?.status === "active";
        const isFound  = rideRes.status < 400 && rideRes.data?.phone;

        // Persist audit row
        const audit = await prisma.rideTransaction.create({
            data: {
                phone:         String(phone).slice(0, 20),
                fullName:      rideRes.data?.full_name  ? String(rideRes.data.full_name).slice(0, 200)  : null,
                accountStatus: rideRes.data?.status     ? String(rideRes.data.status).slice(0, 20)      : null,
                queryStatus:   isFound ? 1 : 0,
                queryResponse: JSON.stringify(rideRes.data)
            }
        }).catch(e => { console.error("RideTransaction audit failed:", e.message); return null; });

        auditId = audit?.id ?? null;

        if (!isFound) {
            return res.status(404).json({
                status:  "Error",
                message: "Phone number not found on Ride",
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
            auditId
        });

    } catch (error) {
        return res.status(500).json({
            status:  "Error",
            message: error.message,
            auditId
        });
    }
};

// ─── POST /ride/pay ───────────────────────────────────────────────────────────
/**
 * Full payment flow:
 *   1. Query Ride to verify phone is active
 *   2. CBS CreateTransaction (debit customer, credit Ride settlement account)
 *   3. Confirm payment to Ride
 *
 * Body:
 * {
 *   phone:       "251911259134"   (required)
 *   amount:      300              (required, number > 0)
 *   drAcNo:      "001123..."      (required — customer debit account)
 *   drBranch:    "001"            (optional)
 *   remark:      "Ride top-up"   (optional)
 *   billRefNo:   "BR7654321"      (optional — if omitted, auto-generated)
 * }
 */
const payRide = async (req, res) => {
    const { phone, amount, drAcNo, drBranch, remark, billRefNo: bodyBillRef } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    const missing = [];
    if (!phone)  missing.push("phone");
    if (!drAcNo) missing.push("drAcNo");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) missing.push("amount (must be > 0)");
    if (missing.length) {
        return res.status(400).json({ status: "Error", message: `Missing or invalid: ${missing.join(", ")}` });
    }

    const txnAmount    = Number(amount);
    const traceNumber  = `TRC${Date.now()}`;
    const transTime    = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14); // YYYYMMDDHHmmss
    const billRefNo    = bodyBillRef || `BR${Date.now()}`;
    const txnRemark    = remark || `Ride payment - ${phone}`;

    // Create initial audit row (will be updated as steps complete)
    let audit = null;
    try {
        audit = await prisma.rideTransaction.create({
            data: {
                phone:       String(phone).slice(0, 20),
                amount:      txnAmount,
                billRefNo:   String(billRefNo).slice(0, 100),
                transTime,
                remark:      String(txnRemark).slice(0, 500),
                traceNumber: traceNumber.slice(0, 150),
                drAcNo:      String(drAcNo).slice(0, 50),
                crAcNo:      String(CBS_CR_ACCOUNT).slice(0, 50),
                queryStatus:   0,
                paymentStatus: 0,
                cbsStatus:     0
            }
        });
    } catch (e) {
        console.error("RideTransaction initial create failed:", e.message);
    }

    const auditId  = audit?.id ?? null;
    const updateAudit = async (data) => {
        if (!auditId) return;
        await prisma.rideTransaction.update({ where: { id: auditId }, data }).catch(e =>
            console.error("RideTransaction update failed:", e.message)
        );
    };

    try {
        // ── Step 1: Query Ride — verify phone is active ───────────────────────
        const queryPayload = { phone: String(phone) };
        logJson("RIDE QUERY REQUEST", queryPayload);

        const queryRes = await axios.post(
            `${RIDE_BASE_URL}/api/v1/bank/enat/bill/query`,
            queryPayload,
            { headers: rideHeaders(), auth: rideAuth, httpsAgent, validateStatus: (s) => s >= 200 && s < 600 }
        );

        logJson("RIDE QUERY RESPONSE", queryRes.data);

        const isActive = queryRes.data?.status === "active";
        const fullName = queryRes.data?.full_name || "";

        await updateAudit({
            fullName:      fullName ? String(fullName).slice(0, 200) : null,
            accountStatus: queryRes.data?.status ? String(queryRes.data.status).slice(0, 20) : null,
            queryStatus:   isActive ? 1 : 0,
            queryResponse: JSON.stringify(queryRes.data)
        });

        if (queryRes.status >= 400 || !queryRes.data?.phone) {
            await updateAudit({ errorDesc: "Phone not found on Ride" });
            return res.status(404).json({
                status:  "Error",
                message: "Phone number not found on Ride",
                auditId
            });
        }

        if (!isActive) {
            const msg = `Ride account is not active (status: ${queryRes.data?.status})`;
            await updateAudit({ errorDesc: msg });
            return res.status(422).json({ status: "Error", message: msg, auditId });
        }

        // ── Step 2: CBS CreateTransaction ─────────────────────────────────────
        const requestXml = buildGenericTransactionXml({
            prd:       "RIDE",
            drAcNo:    String(drAcNo),
            crAcNo:    CBS_CR_ACCOUNT,
            amount:    txnAmount,
            drBranch:  drBranch ? String(drBranch) : undefined,
            currency:  "ETB",
            narrative: `Ride payment ${phone} - ${billRefNo}`
        });

        logXml("CBS RIDE REQUEST", requestXml);

        const cbsRes = await axios.post(CBS_RT_URL, requestXml, {
            headers: { "Content-Type": "text/xml;charset=utf-8", SOAPAction: "CREATETRANSACTION_FSFS_REQ" },
            httpsAgent,
            validateStatus: (s) => s >= 200 && s < 600
        });

        const cbsXml      = cbsRes.data || "";
        logXml("CBS RIDE RESPONSE", cbsXml);

        const cbsFault    = extractXmlTag(cbsXml, "faultstring");
        const cbsSuccess  = !cbsFault && cbsXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        const cbsRefNo    = extractXmlTag(cbsXml, "FCCREF") || extractXmlTag(cbsXml, "XREF");
        const cbsErrCode  = extractXmlTag(cbsXml, "ECODE");
        const cbsErrDesc  = extractXmlTag(cbsXml, "EDESC") || cbsFault;

        await updateAudit({
            cbsRefNo:  cbsRefNo  ? String(cbsRefNo).slice(0, 50)   : null,
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

        // ── Step 3: Confirm payment to Ride ───────────────────────────────────
        const confirmPayload = {
            amount:     String(txnAmount),
            bill_ref_no: billRefNo,
            phone:      String(phone),
            trans_time: transTime,
            remark:     txnRemark
        };

        logJson("RIDE CONFIRM REQUEST", confirmPayload);

        const confirmRes = await axios.post(
            `${RIDE_BASE_URL}/api/v1/bank/enat/bill/confirm`,
            confirmPayload,
            { headers: rideHeaders(), auth: rideAuth, httpsAgent, validateStatus: (s) => s >= 200 && s < 600 }
        );

        logJson("RIDE CONFIRM RESPONSE", confirmRes.data);

        const ackId        = confirmRes.data?.acknowledgement_id || null;
        const confirmOk    = confirmRes.status < 400 && !!ackId;

        await updateAudit({
            acknowledgementId: ackId ? String(ackId).slice(0, 100) : null,
            paymentStatus:     confirmOk ? 1 : 0,
            confirmResponse:   JSON.stringify(confirmRes.data),
            errorDesc:         confirmOk ? null : String(confirmRes.data?.message || "Ride confirm failed").slice(0, 500)
        });

        if (!confirmOk) {
            return res.status(400).json({
                status:  "Error",
                message: confirmRes.data?.message || "Ride payment confirmation failed",
                auditId
            });
        }

        return res.status(200).json({
            status:           "Success",
            message:          "Ride payment completed successfully",
            acknowledgementId: ackId,
            cbsRefNo,
            traceNumber,
            billRefNo,
            auditId
        });

    } catch (error) {
        await updateAudit({ errorDesc: String(error.message).slice(0, 500) });
        return res.status(500).json({
            status:  "Error",
            message: error.message,
            auditId
        });
    }
};

// ─── GET /ride/transactions ───────────────────────────────────────────────────
/**
 * Query Ride transaction audit log.
 * Query params: phone, paymentStatus, cbsStatus, from, to, page, limit
 */
const getRideTransactions = async (req, res) => {
    const { phone, paymentStatus, cbsStatus, from, to, page = 1, limit = 20 } = req.query;

    const where = {};
    if (phone)         where.phone         = { contains: String(phone) };
    if (paymentStatus !== undefined) where.paymentStatus = Number(paymentStatus);
    if (cbsStatus     !== undefined) where.cbsStatus     = Number(cbsStatus);
    if (from || to) {
        where.entryTime = {};
        if (from) where.entryTime.gte = new Date(from);
        if (to)   where.entryTime.lte = new Date(to);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [rows, total] = await Promise.all([
        prisma.rideTransaction.findMany({
            where,
            orderBy: { entryTime: "desc" },
            skip,
            take: Number(limit)
        }),
        prisma.rideTransaction.count({ where })
    ]);

    return res.status(200).json({
        status: "Success",
        total,
        page:   Number(page),
        limit:  Number(limit),
        data:   rows
    });
};

export { queryRideAccount, payRide, getRideTransactions };
