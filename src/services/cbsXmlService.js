// ─── CBS config from env ──────────────────────────────────────────────────────
const CBS_USER          = (process.env.cbs_user          || "ADCUSER").trim();
const CBS_SOURCE        = (process.env.cbs_source        || "ADC").trim();
const CBS_BRANCH        = (process.env.cbs_branch        || "001").trim();
const CBS_OFFSET_BRANCH = (process.env.cbs_offset_branch || "046").trim();
const CBS_OFFSET_ACCOUNT = (process.env.cbs_offset_account || "0461112216017001").trim();

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
 */
const cbsReverseTransaction = (fccRef) =>
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fcub="http://fcubs.ofss.com/service/FCUBSRTService">
   <soapenv:Header/>
   <soapenv:Body>
      <fcub:REVERSETRANSACTION_FSFS_REQ>
         <fcub:FCUBS_HEADER>
            <fcub:SOURCE>${CBS_SOURCE}</fcub:SOURCE>
            <fcub:UBSCOMP>FCUBS</fcub:UBSCOMP>
            <fcub:CORRELID>CORR${Date.now()}</fcub:CORRELID>
            <fcub:USERID>${CBS_USER}</fcub:USERID>
            <fcub:BRANCH>${CBS_BRANCH}</fcub:BRANCH>
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

export {
    CBS_PRD,
    CBS_OFFSET_ACCOUNT,
    CBS_BRANCH,
    CBS_OFFSET_BRANCH,
    cbsCreateTransaction,
    cbsReverseTransaction,
    extractXmlTag,
    normalizeAmount
};
