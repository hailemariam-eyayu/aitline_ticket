const CBS_USER = process.env.cbs_user || "ADCUSER";
const CBS_SOURCE = process.env.cbs_source || "ADC";
const CBS_BRANCH = process.env.cbs_branch || "001";
const CBS_OFFSET_BRANCH = process.env.cbs_offset_branch || "046";
const CBS_OFFSET_ACCOUNT = process.env.cbs_offset_account || "0461112216017001";

const extractXmlTag = (xml, tag) => {
    if (!xml) return null;
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
};

const normalizeAmount = (amount) => {
    const numeric = Number(amount || 0);
    if (Number.isInteger(numeric)) return String(numeric);
    return numeric.toFixed(2);
};

/**
 * Build the CBS CreateTransaction SOAP envelope.
 *
 * @param {object} params
 * @param {number|string} params.amount        - Transaction amount
 * @param {string}        params.orderid       - FlyGate order ID (used as narrative)
 * @param {string}        params.beneficiaryAcno - Debit account (CBS_TXN_ACCOUNT) from frontend
 * @param {string}        [params.branchCode]  - Branch code from frontend (overrides env default)
 */
const buildCreateTransactionXml = ({ amount, orderid, beneficiaryAcno, branchCode }) => {
    const txnAmount = normalizeAmount(amount);
    const narrative = `Airline ticket payment - ${orderid}`;
    const txnBranch = branchCode || CBS_BRANCH;

    return {
        xml: `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fcub="http://fcubs.ofss.com/service/FCUBSRTService">
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
               <fcub:PRD>ATAD</fcub:PRD>
               <fcub:BRN>${txnBranch}</fcub:BRN>
               <fcub:TXNACC>${beneficiaryAcno}</fcub:TXNACC>
               <fcub:TXNCCY>ETB</fcub:TXNCCY>
               <fcub:TXNAMT>${txnAmount}</fcub:TXNAMT>
               <fcub:OFFSETBRN>${CBS_OFFSET_BRANCH}</fcub:OFFSETBRN>
               <fcub:OFFSETACC>${CBS_OFFSET_ACCOUNT}</fcub:OFFSETACC>
               <fcub:OFFSETCCY>ETB</fcub:OFFSETCCY>
               <fcub:OFFSETAMT>${txnAmount}</fcub:OFFSETAMT>
               <fcub:NARRATIVE>${narrative}</fcub:NARRATIVE>
            </fcub:Transaction-Details>
         </fcub:FCUBS_BODY>
      </fcub:CREATETRANSACTION_FSFS_REQ>
   </soapenv:Body>
</soapenv:Envelope>`
    };
};

const buildReversalXml = (referenceNumber) => `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fcub="http://fcubs.ofss.com/service/FCUBSRTService">
   <soapenv:Header/>
   <soapenv:Body>
      <fcub:REVERSETRANSACTION_FSFS_REQ>
         <fcub:FCUBS_HEADER>
            <fcub:SOURCE>PTP</fcub:SOURCE>
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
               <fcub:FCCREF>${referenceNumber}</fcub:FCCREF>
            </fcub:Transaction-Details>
         </fcub:FCUBS_BODY>
      </fcub:REVERSETRANSACTION_FSFS_REQ>
   </soapenv:Body>
</soapenv:Envelope>`;

export {
    CBS_OFFSET_ACCOUNT,
    buildCreateTransactionXml,
    buildReversalXml,
    extractXmlTag
};
