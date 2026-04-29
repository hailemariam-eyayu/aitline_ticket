// ─── CBS config from env ──────────────────────────────────────────────────────
const CBS_USER          = (process.env.cbs_user          || "ADCUSER").trim();
const CBS_SOURCE        = (process.env.cbs_source        || "ADC").trim();
const CBS_BRANCH        = (process.env.cbs_branch        || "001").trim();
const CBS_OFFSET_BRANCH = (process.env.cbs_offset_branch || "046").trim();

// Reversal uses a different source/user in CBS (PTP source for reversals)
const CBS_REV_SOURCE = (process.env.cbs_rev_source || process.env.cbs_source || "ADC").trim();
const CBS_REV_USER   = (process.env.cbs_rev_user   || process.env.cbs_user   || "ADCUSER").trim();

// ─── Per-channel settlement (credit) accounts ─────────────────────────────────
// Each channel debits the customer and credits its own settlement GL/account.
// Set the correct account numbers in .env — these are just safe fallbacks.
const CBS_OFFSET_ACCOUNTS = {
    AIRLINE:  (process.env.cbs_offset_airline  || process.env.cbs_offset_account || "0461112216017001").trim(),
    TELEBIRR: (process.env.cbs_offset_telebirr || process.env.cbs_offset_account || "0461112216017001").trim(),
    RIDE:     (process.env.cbs_offset_ride     || process.env.cbs_offset_account || "0461112216017001").trim(),
    BILL:     (process.env.cbs_offset_bill     || process.env.cbs_offset_account || "0461112216017001").trim(),
    MPESA:    (process.env.cbs_offset_mpesa    || process.env.cbs_offset_account || "0461112216017001").trim(),
    IPS:      (process.env.cbs_offset_ips      || process.env.cbs_offset_account || "0461112216017001").trim(),
    OTHER:    (process.env.cbs_offset_account  || "0461112216017001").trim(),
};

// Convenience: get offset account for a channel (falls back to OTHER)
const getOffsetAccount = (channel) =>
    CBS_OFFSET_ACCOUNTS[String(channel).toUpperCase()] || CBS_OFFSET_ACCOUNTS.OTHER;

// ─── PRD codes per channel ────────────────────────────────────────────────────
// Add new channels here as needed
const CBS_PRD = {
    AIRLINE:  "ATAD",   // Ethiopian Airlines ticket payment
    TELEBIRR: "TBTT",   // Telebirr transfer
    RIDE:     "ATAD",   // Ride ET bill payment
    BILL:     "ATAD",   // Generic bill payment
    MPESA:    "MPSA",   // M-Pesa
    IPS:      "ATAS",   // IPS / interbank
    OTHER:    "ATAD"    // fallback
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
 * This is the single function used by ALL integrations (airline, Ride, Telebirr, etc.)
 *
 * @param {object}        p
 * @param {string}        p.prd        - CBS product code. Use CBS_PRD constants or pass directly.
 * @param {string}        p.drAcNo     - Debit account number (customer account)
 * @param {string}        p.crAcNo     - Credit account number (settlement/offset account)
 * @param {number|string} p.amount     - Transaction amount
 * @param {string}        [p.drBranch] - Debit branch code (defaults to CBS_BRANCH env)
 * @param {string}        [p.crBranch] - Credit branch code (defaults to CBS_OFFSET_BRANCH env)
 * @param {string}        [p.currency] - Currency code (default: ETB)
 * @param {string}        [p.narrative]- Transaction narrative shown in CBS
 *
 * @returns {string} SOAP XML string ready to POST to CBS endpoint
 *
 * @example
 * // Airline
 * cbsCreateTransaction({ prd: CBS_PRD.AIRLINE, drAcNo: acno, crAcNo: offsetAc, amount: 4500, narrative: "Airline - ET1234" })
 *
 * @example
 * // Telebirr
 * cbsCreateTransaction({ prd: CBS_PRD.TELEBIRR, drAcNo: acno, crAcNo: telebirrAc, amount: 300, narrative: "Telebirr 0911..." })
 */
const cbsCreateTransaction = ({ prd, drAcNo, crAcNo, amount, drBranch, crBranch, currency = "ETB", narrative = "" }) => {
    const txnAmount    = normalizeAmount(amount);
    const txnBranch    = (drBranch || CBS_BRANCH).trim();
    const offsetBranch = (crBranch || CBS_OFFSET_BRANCH).trim();

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
 * @param {string} fccRef - The FCCREF returned by CBS on the original transaction
 *                          Branch is auto-derived from first 3 chars of FCCREF
 *                          (e.g. "001ATAD22346A046" → branch "001")
 */
const cbsReverseTransaction = (fccRef) => {
    // Branch = first 3 chars of FCCREF (same branch that created the transaction)
    const branch = fccRef ? String(fccRef).slice(0, 3) : CBS_BRANCH;
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
 * Returns { success, reversalRef, error }.
 * Never throws — caller decides what to do with the result.
 *
 * @param {string} fccRef       - CBS FCCREF to reverse
 * @param {string} cbsRtUrl     - CBS RT endpoint URL
 * @param {object} httpsAgent   - https.Agent (TLS config)
 * @param {Function} axiosPost  - axios.post (injected to avoid circular deps)
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

        const xml        = res.data || "";
        const isSuccess  = xml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        const reversalRef = extractXmlTag(xml, "FCCREF") || fccRef;
        const errDesc    = extractXmlTag(xml, "EDESC") || extractXmlTag(xml, "faultstring");

        console.log(`[AUTO-REVERSAL] ${isSuccess ? "SUCCESS" : "FAILED"} — ref: ${reversalRef}${errDesc ? " | " + errDesc : ""}`);
        return { success: isSuccess, reversalRef: isSuccess ? reversalRef : null, error: isSuccess ? null : (errDesc || "Reversal failed") };
    } catch (e) {
        console.error("[AUTO-REVERSAL] Exception:", e.message);
        return { success: false, reversalRef: null, error: e.message };
    }
};

export {
    CBS_PRD,
    CBS_OFFSET_ACCOUNTS,
    getOffsetAccount,
    CBS_BRANCH,
    CBS_OFFSET_BRANCH,
    cbsCreateTransaction,
    cbsReverseTransaction,
    attemptAutoReversal,
    extractXmlTag,
    normalizeAmount
};
