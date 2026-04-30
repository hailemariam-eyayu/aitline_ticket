// ─── CBS config from env ──────────────────────────────────────────────────────
const CBS_USER          = (process.env.cbs_user          || "ADCUSER").trim();
const CBS_SOURCE        = (process.env.cbs_source        || "ADC").trim();

// Fixed branches — only used for channels that don't have a real account to derive from
const CBS_BRANCH        = (process.env.cbs_branch        || "001").trim();
const CBS_OFFSET_BRANCH = (process.env.cbs_offset_branch || "046").trim();

// Reversal uses a different source/user in CBS (PTP source for reversals)
const CBS_REV_SOURCE = (process.env.cbs_rev_source || process.env.cbs_source || "ADC").trim();
const CBS_REV_USER   = (process.env.cbs_rev_user   || process.env.cbs_user   || "ADCUSER").trim();

// ─── Channels that use fixed env branches (not derived from account number) ──
// For Telebirr, MPESA, IPS the account numbers are system GLs, not customer accounts,
// so branch must be configured explicitly.
const FIXED_BRANCH_CHANNELS = new Set(["TELEBIRR", "MPESA", "IPS"]);

/**
 * Derive the CBS branch code for a given channel + account number.
 * - For TELEBIRR / MPESA / IPS: use the fixed env branch
 * - For all others (AIRLINE, RIDE, BILL, etc.): first 3 chars of the account number
 *
 * @param {string} channel  - e.g. "AIRLINE", "RIDE", "TELEBIRR"
 * @param {string} acNo     - account number
 * @param {string} fallback - "DR" uses CBS_BRANCH, "CR" uses CBS_OFFSET_BRANCH
 */
const getBranch = (channel, acNo, fallback = "DR") => {
    if (FIXED_BRANCH_CHANNELS.has(String(channel).toUpperCase())) {
        return fallback === "CR" ? CBS_OFFSET_BRANCH : CBS_BRANCH;
    }
    return String(acNo || "").slice(0, 3) || (fallback === "CR" ? CBS_OFFSET_BRANCH : CBS_BRANCH);
};

// ─── Per-channel settlement (credit) accounts ─────────────────────────────────
const CBS_OFFSET_ACCOUNTS = {
    AIRLINE:  (process.env.cbs_offset_airline  || process.env.cbs_offset_account || "0461112216017001").trim(),
    TELEBIRR: (process.env.cbs_offset_telebirr || process.env.cbs_offset_account || "0461112216017001").trim(),
    RIDE:     (process.env.cbs_offset_ride     || process.env.cbs_offset_account || "0461112216017001").trim(),
    BILL:     (process.env.cbs_offset_bill     || process.env.cbs_offset_account || "0461112216017001").trim(),
    MPESA:    (process.env.cbs_offset_mpesa    || process.env.cbs_offset_account || "0461112216017001").trim(),
    IPS:      (process.env.cbs_offset_ips      || process.env.cbs_offset_account || "0461112216017001").trim(),
    OTHER:    (process.env.cbs_offset_account  || "0461112216017001").trim(),
};

const getOffsetAccount = (channel) =>
    CBS_OFFSET_ACCOUNTS[String(channel).toUpperCase()] || CBS_OFFSET_ACCOUNTS.OTHER;

// ─── PRD codes per channel ────────────────────────────────────────────────────
const CBS_PRD = {
    AIRLINE:  "ATAD",
    TELEBIRR: "TBTT",
    RIDE:     "ATAD",
    BILL:     "ATAD",
    MPESA:    "MPSA",
    IPS:      "ATAS",
    OTHER:    "ATAD"
};

// ─── Module type per channel (matches CBS ModuleType codes) ──────────────────
const CBS_MODULE_TYPE = {
    AIRLINE:  153,
    TELEBIRR: 153,
    RIDE:     153,
    BILL:     16,
    MPESA:    153,
    IPS:      153,
    OTHER:    153
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const normalizeAmount = (amount) => {
    const numeric = Number(amount || 0);
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
};

const extractXmlTag = (xml, tag) => {
    if (!xml) return null;
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return match ? match[1].trim() : null;
};

// ─── Core CBS CreateTransaction builder ───────────────────────────────────────
/**
 * Build a CBS CREATETRANSACTION_FSFS_REQ SOAP envelope.
 *
 * @param {object}        p
 * @param {string}        p.channel    - Channel name (AIRLINE, RIDE, TELEBIRR, etc.) — for branch derivation
 * @param {string}        p.prd        - CBS product code (use CBS_PRD constants)
 * @param {string}        p.drAcNo     - Debit account number
 * @param {string}        p.crAcNo     - Credit account number
 * @param {number|string} p.amount     - Transaction amount
 * @param {string}        [p.currency] - Currency code (default ETB)
 * @param {string}        [p.narrative]- Narrative shown in CBS
 */
const cbsCreateTransaction = ({ channel, prd, drAcNo, crAcNo, amount, currency = "ETB", narrative = "" }) => {
    const txnAmount    = normalizeAmount(amount);
    const txnBranch    = getBranch(channel, drAcNo, "DR");
    const offsetBranch = getBranch(channel, crAcNo, "CR");

    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fcub="http://fcubs.ofss.com/service/FCUBSRTService">
   <soapenv:Header/>
   <soapenv:Body>
      <fcub:CREATETRANSACTION_FSFS_REQ>
         <fcub:FCUBS_HEADER>
            <fcub:SOURCE>${CBS_SOURCE}</fcub:SOURCE>
            <fcub:UBSCOMP>FCUBS</fcub:UBSCOMP>
            <fcub:USERID>${CBS_USER}</fcub:USERID>
            <fcub:BRANCH>${txnBranch}</fcub:BRANCH>
            <fcub:SERVICE>FCUBSRTService</fcub:SERVICE>
            <fcub:OPERATION>CreateTransaction</fcub:OPERATION>
         </fcub:FCUBS_HEADER>
         <fcub:FCUBS_BODY>
            <fcub:Transaction-Details>
               <fcub:PRD>${prd}</fcub:PRD>
               <fcub:BRN>${txnBranch}</fcub:BRN>
               <fcub:TXNACC>${drAcNo}</fcub:TXNACC>
               <fcub:TXNCCY>${currency}</fcub:TXNCCY>
               <fcub:TXNAMT>${txnAmount}</fcub:TXNAMT>
               <fcub:OFFSETBRN>${offsetBranch}</fcub:OFFSETBRN>
               <fcub:OFFSETACC>${crAcNo}</fcub:OFFSETACC>
               <fcub:OFFSETCCY>${currency}</fcub:OFFSETCCY>
               <fcub:OFFSETAMT>${txnAmount}</fcub:OFFSETAMT>
               <fcub:NARRATIVE>${narrative}</fcub:NARRATIVE>
            </fcub:Transaction-Details>
         </fcub:FCUBS_BODY>
      </fcub:CREATETRANSACTION_FSFS_REQ>
   </soapenv:Body>
</soapenv:Envelope>`;
};

// ─── CBS ReverseTransaction builder ──────────────────────────────────────────
/**
 * Build a CBS REVERSETRANSACTION_FSFS_REQ SOAP envelope.
 * Branch is auto-derived from first 3 chars of FCCREF.
 * @param {string} fccRef - The FCCREF returned by CBS on the original transaction
 */
const cbsReverseTransaction = (fccRef) => {
    const branch   = fccRef ? String(fccRef).slice(0, 3) : CBS_BRANCH;
    const correlId = `CORR${Date.now()}`;

    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fcub="http://fcubs.ofss.com/service/FCUBSRTService">
   <soapenv:Header/>
   <soapenv:Body>
      <fcub:REVERSETRANSACTION_FSFS_REQ>
         <fcub:FCUBS_HEADER>
            <fcub:SOURCE>${CBS_REV_SOURCE}</fcub:SOURCE>
            <fcub:UBSCOMP>FCUBS</fcub:UBSCOMP>
            <fcub:CORRELID>${correlId}</fcub:CORRELID>
            <fcub:USERID>${CBS_REV_USER}</fcub:USERID>
            <fcub:BRANCH>${branch}</fcub:BRANCH>
            <fcub:MODULEID>RT</fcub:MODULEID>
            <fcub:SERVICE>FCUBSRTService</fcub:SERVICE>
            <fcub:OPERATION>ReverseTransaction</fcub:OPERATION>
         </fcub:FCUBS_HEADER>
         <fcub:FCUBS_BODY>
            <fcub:Transaction-Details>
               <fcub:FCCREF>${fccRef}</fcub:FCCREF>
            </fcub:Transaction-Details>
         </fcub:FCUBS_BODY>
      </fcub:REVERSETRANSACTION_FSFS_REQ>
   </soapenv:Body>
</soapenv:Envelope>`;
};

// ─── Auto-reversal helper ─────────────────────────────────────────────────────
/**
 * Attempt to reverse a CBS transaction silently.
 * Returns { success, reversalRef, error }. Never throws.
 */
const attemptAutoReversal = async (fccRef, cbsRtUrl, httpsAgent, axiosPost) => {
    try {
        const reversalXml = cbsReverseTransaction(fccRef);
        console.log(`\n[AUTO-REVERSAL] Reversing CBS ref: ${fccRef}`);

        const res = await axiosPost(cbsRtUrl, reversalXml, {
            headers: { "Content-Type": "text/xml;charset=utf-8", SOAPAction: "REVERSETRANSACTION_FSFS_REQ" },
            httpsAgent,
            validateStatus: (s) => s >= 200 && s < 600
        });

        const xml         = res.data || "";
        const isSuccess   = xml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        const reversalRef = extractXmlTag(xml, "FCCREF") || fccRef;
        const errDesc     = extractXmlTag(xml, "EDESC") || extractXmlTag(xml, "faultstring");

        console.log(`[AUTO-REVERSAL] ${isSuccess ? "SUCCESS" : "FAILED"} — ref: ${reversalRef}${errDesc ? " | " + errDesc : ""}`);
        return { success: isSuccess, reversalRef: isSuccess ? reversalRef : null, error: isSuccess ? null : (errDesc || "Reversal failed") };
    } catch (e) {
        console.error("[AUTO-REVERSAL] Exception:", e.message);
        return { success: false, reversalRef: null, error: e.message };
    }
};

// ─── Transactions journal helper ──────────────────────────────────────────────
/**
 * Insert DR + CR rows into the Transactions table for a completed CBS transaction.
 *
 * @param {object} p
 * @param {object} p.prisma           - Prisma client
 * @param {string} p.cbsChannel       - CBS channel name for branch derivation (AIRLINE, RIDE, TELEBIRR…)
 * @param {string} p.frontendChannel  - Frontend channel stored in DB only (MB, USSD, API, WEB…)
 * @param {string} p.drAcNo           - Debit account number
 * @param {string} p.crAcNo           - Credit account number
 * @param {number} p.amount           - Transaction amount
 * @param {string} p.cbsRefNo         - CBS FCCREF (BatchId + CustIden)
 * @param {Date}   p.trnDate          - Transaction date from CBS BOOKDATE
 * @param {string} p.utility          - PNR (airline) or phone (ride)
 * @param {string} p.utilRefNo        - FlyGate traceNumber or Ride billRefNo
 * @param {string} p.particulars      - Free text description
 * @param {string} [p.currency]       - Currency code (default ETB)
 * @param {number} [p.comAmount]      - Charge amount from CBS CHGAMT
 * @param {number} [p.disasterRiskAmt]- Disaster risk from CBS LCYCHG
 */
const insertTransactionJournal = async ({
    prisma, cbsChannel, frontendChannel,
    drAcNo, crAcNo, amount, cbsRefNo,
    trnDate, utility, utilRefNo, particulars,
    currency = "ETB", comAmount = 0, disasterRiskAmt = 0
}) => {
    // moduleType = what kind of transaction (AIRLINE=153, TELEBIRR=153, etc.)
    const moduleType  = CBS_MODULE_TYPE[String(cbsChannel).toUpperCase()] ?? 153;
    // channel/subChannel = which frontend service (IB, MB, USSD, BO) — from frontend only
    const channel     = (frontendChannel || "IB").slice(0, 10);
    const uniqueId    = String(Date.now());
    const batchId     = cbsRefNo || "";
    const iRefNo      = utilRefNo || cbsRefNo || "";
    const drBranch    = getBranch(cbsChannel, drAcNo, "DR");
    const now         = new Date();

    const base = {
        batchId:        batchId.slice(0, 50),
        iRefNo:         iRefNo.slice(0, 50),
        trnDate,
        branchCode:     drBranch.slice(0, 10),
        amount,
        currencyCode:   currency.slice(0, 5),
        utilRefNo:      (utilRefNo || "").slice(0, 100),
        utility:        (utility   || "").slice(0, 100),
        custIden:       batchId.slice(0, 50),
        particulars:    (particulars || "").slice(0, 500),
        moduleType,                // AIRLINE=153, TELEBIRR=153, BILL=16 etc.
        status:         1,
        channel,                   // IB | MB | USSD | BO — stored in DB only
        subChannel:     channel,
        uniqueId,
        processedTime:  trnDate,
        entryTime:      now,
        comAmount,
        disasterRiskAmt
    };

    // DR row — debit the customer account
    await prisma.transactions.create({
        data: { ...base, acNo: drAcNo.slice(0, 20), crDr: "DR", uniqueId: `${uniqueId}D` }
    }).catch(e => console.error("Transactions DR write failed:", e.message));

    // CR row — credit the settlement account (no charges on CR side)
    await prisma.transactions.create({
        data: {
            ...base,
            acNo:            crAcNo.slice(0, 20),
            crDr:            "CR",
            uniqueId:        `${uniqueId}C`,
            comAmount:       null,
            disasterRiskAmt: null
        }
    }).catch(e => console.error("Transactions CR write failed:", e.message));
};

// ─── CBS QueryCustAcc builder ─────────────────────────────────────────────────
/**
 * Build a CBS QUERYCUSTACC_IOFS_REQ SOAP envelope.
 * Branch is auto-derived from first 3 chars of account number.
 * @param {string} acNo - Account number to query
 */
const cbsQueryAccount = (acNo) => {
    const branch = String(acNo).slice(0, 3);
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fcub="http://fcubs.ofss.com/service/FCUBSAccService">
   <soapenv:Header/>
   <soapenv:Body>
      <fcub:QUERYCUSTACC_IOFS_REQ>
         <fcub:FCUBS_HEADER>
            <fcub:SOURCE>${CBS_SOURCE}</fcub:SOURCE>
            <fcub:UBSCOMP>FCUBS</fcub:UBSCOMP>
            <fcub:USERID>${CBS_USER}</fcub:USERID>
            <fcub:BRANCH>${branch}</fcub:BRANCH>
            <fcub:SERVICE>FCUBSAccService</fcub:SERVICE>
            <fcub:OPERATION>QueryCustAcc</fcub:OPERATION>
         </fcub:FCUBS_HEADER>
         <fcub:FCUBS_BODY>
            <fcub:Cust-Account-IO>
               <fcub:BRN>${branch}</fcub:BRN>
               <fcub:ACC>${acNo}</fcub:ACC>
            </fcub:Cust-Account-IO>
         </fcub:FCUBS_BODY>
      </fcub:QUERYCUSTACC_IOFS_REQ>
   </soapenv:Body>
</soapenv:Envelope>`;
};

export {
    CBS_PRD,
    CBS_MODULE_TYPE,
    CBS_OFFSET_ACCOUNTS,
    getOffsetAccount,
    getBranch,
    CBS_BRANCH,
    CBS_OFFSET_BRANCH,
    cbsCreateTransaction,
    cbsReverseTransaction,
    cbsQueryAccount,
    attemptAutoReversal,
    insertTransactionJournal,
    extractXmlTag,
    normalizeAmount
};
