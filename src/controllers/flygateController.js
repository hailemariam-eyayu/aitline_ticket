import express from "express";
import axios from "axios";
import https from "https";
import { config } from 'dotenv';
import { prisma } from "../config/db.js";
config();

// Disable TLS verification for self-signed certs on internal endpoints
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const shortcode = process.env.shortCodeT || 526341;
const url = process.env.BASE_URL; // Ensure URL is defined

const validatePNR = async (req, res) => {
    console.log("PNR Validate method");
    const { orderid } = req.body;
    console.log(orderid);

    try {
        // Corrected query parameter syntax using URLSearchParams or template literals
        console.log("Try block");
        const getOrderParams = {
            OrderId: orderid,
            shortCode: shortcode
        };
        console.log("Request to Airline (GetOrder):", getOrderParams);

        const response = await axios.get(`${url}/Enat/api/V1.0/Enat/GetOrder`, {
            params: getOrderParams,
            httpsAgent,
            auth: {
                username: 'EnatBankTest@ethiopianairlines.com',
                password: 'EnatBankTest@!23'
            },
            // Prevent 500 status codes from throwing an exception so we can read the business error in response.data
            validateStatus: (status) => status >= 200 && status < 600
        });

        console.log("Response from Airline (GetOrder):", response.data);

        // Check for success based on statusCodeResponse (0 or 1 usually success, 4 is Not Found)
        if (response.data && response.data.statusCodeResponseDescription === "Success" || (response.data.amount > 0)) {
            // Store order details for later use in confirmOrder
            console.log("Response data:", response.data);

            const savedOrder = await prisma.flyGateOrder.upsert({
                where: { orderId: orderid },
                update: {
                    amount: Number(response.data.Amount || response.data.amount || 0),
                    customerName: response.data.CustomerName || response.data.customerName || "Unknown",
                },
                create: {
                    orderId: orderid,
                    amount: Number(response.data.Amount || response.data.amount || 0),
                    customerName: response.data.CustomerName || response.data.customerName || "Unknown",
                }
            });

            return res.status(200).json({
                success: true,
                data: savedOrder
            });
        } else {
            console.log("Validation Failed. Full Response:", JSON.stringify(response.data, null, 2));
            return res.status(404).json({
                success: false,
                message: response.data.statusCodeResponseDescription || response.data.message || "Order not found or expired",
                errorCode: response.data.errorCode,
                orderId: response.data.orderId || orderid,
                rawResponse: response.data
            });
        }
    } catch (error) {
        console.error("Error occurred while validating PNR:", error);
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
const CBS_USER = process.env.cbs_user || "ADCUSER";
const CBS_PASS = process.env.cbs_pass || "cbs_password";

const confirmOrder = async (req, res) => {
    const { orderid, beneficiaryAcno, remark } = req.body;

    try {
        // --- PRE-CBS CHECKS (commented out for CBS testing) ---
        // const storedOrder = await prisma.flyGateOrder.findFirst({
        //     where: { orderId: orderid }
        // });
        // if (!storedOrder) {
        //     return res.status(404).json({ status: "Error", message: "Order details not found. Please validate PNR first." });
        // }
        // if (storedOrder.status === 1) {
        //     return res.status(400).json({ status: "Error", message: "Order has already been paid." });
        // }
        // const amount = storedOrder.amount;
        // const customerName = storedOrder.customerName;
        // const finalTraceNumber = storedOrder.id || `TRC${Date.now()}`;

        // Hardcoded for CBS testing — replace with storedOrder values when re-enabling
        const amount = req.body.amount || 100;
        const customerName = req.body.customerName || "Test Customer";
        const finalTraceNumber = `TRC${Date.now()}`;
        const xref = `FLYGATE-${orderid}-${Date.now()}`; // External reference sent to CBS

        // --- 1. CBS INTERACTION (XML via Axios) ---
        const soapRequestXml = `
            <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fcub="http://fcubs.ofss.com/service/FCUBSRTService">
               <soapenv:Header/>
               <soapenv:Body>
                  <fcub:REVERSETRANSACTION_IOPK_REQ>
                     <FCUBS_HEADER>
                        <SOURCE>PTP</SOURCE>
                        <UBSCOMP>FCUBS</UBSCOMP>
                        <MSGID>MSG${Date.now()}</MSGID>
                        <CORRELID>CORR${Date.now()}</CORRELID>
                        <USERID>${CBS_USER}</USERID>
                        <BRANCH>001</BRANCH>
                        <MODULEID>RT</MODULEID>
                        <SERVICE>FCUBSRTService</SERVICE>
                        <OPERATION>ReverseTransaction</OPERATION>
                        <PASSWORD>${CBS_PASS}</PASSWORD>
                     </FCUBS_HEADER>
                     <FCUBS_BODY>
                        <Transaction-Details-IO>
                           <XREF>${xref}</XREF>
                           <FCCREF></FCCREF>
                        </Transaction-Details-IO>
                     </FCUBS_BODY>
                  </fcub:REVERSETRANSACTION_IOPK_REQ>
               </soapenv:Body>
            </soapenv:Envelope>`;

        console.log("Request to CBS (XML):", soapRequestXml);

        // Log CBS Request
        if (prisma.cBSLog) {
            await prisma.cBSLog.create({
                data: { orderId: orderid, status: "REQ", type: "CONFIRM", payload: soapRequestXml }
            }).catch(e => console.error("CBS Log Error:", e));
        }
        
        let cbsResponseXml;
        try {
            const response = await axios.post(CBS_URL, soapRequestXml, {
                headers: {
                    'Content-Type': 'text/xml;charset=utf-8',
                    'SOAPAction': 'REVERSETRANSACTION_IOPK_REQ'
                },
                httpsAgent
            });
            cbsResponseXml = response.data;
            console.log("Raw CBS XML Response:", cbsResponseXml);
        } catch (err) {
            console.error("CBS XML Error:", err.response?.data || err.message);
            throw new Error("Failed to process transaction with CBS");
        }

        // Log CBS Response
        if (prisma.cBSLog) {
            await prisma.cBSLog.create({
                data: { orderId: orderid, status: "RES", type: "CONFIRM", payload: cbsResponseXml }
            }).catch(e => console.error("CBS Log Error:", e));
        }

        // Simple XML parsing for success check and FCCREF extraction
        const isSuccess = cbsResponseXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        if (!isSuccess) {
            const errorMatch = cbsResponseXml.match(/<EDESC>(.*?)<\/EDESC>/);
            const errDesc = errorMatch ? errorMatch[1] : "CBS transaction failed";
            throw new Error(`CBS Error: ${errDesc}`);
        }

        const fccRefMatch = cbsResponseXml.match(/<FCCREF>(.*?)<\/FCCREF>/);
        const finalReferenceNumber = fccRefMatch ? fccRefMatch[1] : xref;

        // --- 2. FLYGATE INTERACTION (REST) ---
        // ... (rest of the logic remains the same)

        // --- 2. FLYGATE INTERACTION (REST) ---

        const flyGatePayload = {
            OrderId: orderid,
            shortCode: process.env.shortCodeT,
            Amount: amount,
            Currency: "ETB",
            status: 1,
            remark: "Successfully Paid",
            TraceNumber: finalTraceNumber,
            ReferenceNumber: finalReferenceNumber,
            PayerCustomerName: customerName || "Enat Customer",
            PaidAccountNumber: beneficiaryAcno
        };

        console.log("Request to Flygate (ConfirmOrder):", flyGatePayload);

        // Log FlyGate Request
        if (prisma.flyGateLog) {
            await prisma.flyGateLog.create({
                data: { orderId: orderid, status: "REQ", type: "CONFIRM", payload: JSON.stringify(flyGatePayload) }
            }).catch(e => console.error("FlyGate Log Error:", e));
        }

        // Update order status to paid in DB (commented out for CBS testing)
        // await prisma.flyGateOrder.update({
        //     where: { orderId: orderid },
        //     data: {
        //         status: 1,
        //         beneficiaryAcno: beneficiaryAcno,
        //         traceNumber: String(finalTraceNumber),
        //         referenceNumber: finalReferenceNumber
        //     }
        // }).catch(e => console.error("Update Status Error:", e));

        // FlyGate interaction
        const flyGateResponse = await axios.post(
            `${url}/Enat/api/V1.0/Enat/ConfirmOrder`,
            flyGatePayload,
            {
                httpsAgent,
                auth: {
                    username: 'EnatBankTest@ethiopianairlines.com',
                    password: 'EnatBankTest@!23'
                }
            }
        );
        console.log("Response from Flygate (ConfirmOrder):", flyGateResponse.data);

        // Log FlyGate Response
        if (prisma.flyGateLog) {
            await prisma.flyGateLog.create({
                data: { orderId: orderid, status: "RES", type: "CONFIRM", payload: JSON.stringify(flyGateResponse.data) }
            }).catch(e => console.error("FlyGate Log Error:", e));
        }

        return res.json({
            status: "Success",
            message: "Successfully transferred",
            reference: finalReferenceNumber,
            rawData: flyGateResponse.data
        });

    } catch (error) {
        return res.status(500).json({
            status: "Error",
            message: error.response?.data?.message || error.message,
            rawData: error.response?.data || null
        });
    }
};


const refundRequest = async (req, res) => {
    // Basic Auth Check for Third Party
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ status: "Error", message: "Authorization header missing"  });
    }

    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const user = auth[0];
    const pass = auth[1];

    if (user !== 'EnatBankTest@ethiopianairlines.com' || pass !== 'EnatBankTest@!23') {
        return res.status(401).json({ status: "Error", message: "Invalid credentials" });
    }

    const { shortCode, orderId, firstName, lastName, amount, currency, ReferenceNumber, refundFOP, refundReferenceCode } = req.body;

    try {
        const order = await prisma.flyGateOrder.findFirst({ where: { orderId: orderId } });

        // CBS Interaction to reverse the transaction (send raw XML via Axios)
        console.log("Initiating CBS transaction reversal for ReferenceNumber:", ReferenceNumber);
        const soapRequestXml = `
            <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fcub="http://fcubs.ofss.com/service/FCUBSRTService">
               <soapenv:Header/>
               <soapenv:Body>
                  <fcub:REVERSETRANSACTION_FSFS_REQ>
                     <FCUBS_HEADER>
                        <SOURCE>PTP</SOURCE>
                        <UBSCOMP>FCUBS</UBSCOMP>
                        <CORRELID>CORR${Date.now()}</CORRELID>
                        <USERID>PTPUSER</USERID>
                        <BRANCH>001</BRANCH>
                        <MODULEID>RT</MODULEID>
                        <SERVICE>FCUBSRTService</SERVICE>
                        <OPERATION>ReverseTransaction</OPERATION>
                     </FCUBS_HEADER>
                     <FCUBS_BODY>
                        <Transaction-Details>
                           <FCCREF>${ReferenceNumber}</FCCREF>
                        </Transaction-Details>
                     </FCUBS_BODY>
                  </fcub:REVERSETRANSACTION_FSFS_REQ>
               </soapenv:Body>
            </soapenv:Envelope>`;

        console.log("Request to CBS (XML refund):", soapRequestXml);

        // Log CBS Refund Request
        await prisma.cBSLog.create({
            data: { orderId: orderId, status: "REQ", type: "REFUND", payload: soapRequestXml }
        }).catch(e => console.error("CBS Log Error:", e));

        let cbsResponseXml;
        try {
            const response = await axios.post(CBS_URL, soapRequestXml, {
                headers: {
                    'Content-Type': 'text/xml;charset=utf-8',
                    'SOAPAction': 'REVERSETRANSACTION_FSFS_REQ'
                },
                httpsAgent
            });
            cbsResponseXml = response.data;
            console.log("Raw CBS XML Response (refund):", cbsResponseXml);
        } catch (err) {
            console.error("CBS XML Error (refund):", err.response?.data || err.message);
            throw new Error("Failed to reverse transaction with CBS");
        }

        // Log CBS Refund Response
        await prisma.cBSLog.create({
            data: { orderId: orderId, status: "RES", type: "REFUND", payload: cbsResponseXml }
        }).catch(e => console.error("CBS Log Error:", e));

        // Simple XML parsing for success check
        const isSuccess = cbsResponseXml.includes("<MSGSTAT>SUCCESS</MSGSTAT>");
        if (isSuccess) {
            const flyGatePayload = {
                shortCode: shortCode,
                OrderId: orderId,
                Amount: amount,
                Currency: currency,
                RefundReferenceCode: refundReferenceCode,
                bankRefundReference: ReferenceNumber,
                refundDate: new Date().toISOString().split('T')[0],
                RefundAccountNumber: order ? order.beneficiaryAcno : "Unknown",
                AccountHolderName: `${firstName} ${lastName}`,
                refundFOP: refundFOP,
                status: 1,
                remark: "Successfully Refunded",
            };

            console.log("Request to Flygate (ConfirmRefund):", flyGatePayload);
            // Log FlyGate Refund Request
            await prisma.flyGateLog.create({
                data: { orderId: orderId, status: "REQ", type: "REFUND", payload: JSON.stringify(flyGatePayload) }
            }).catch(e => console.error("FlyGate Log Error:", e));
            const flyGateResponse = await axios.post(
                `${url}/Enat/api/V1.0/Enat/ConfirmRefund`,
                flyGatePayload,
                {
                    httpsAgent,
                    auth: {
                        username: 'EnatBankTest@ethiopianairlines.com',
                        password: 'EnatBankTest@!23'
                    }
                }
            );
            console.log("Response from Flygate (ConfirmRefund):", flyGateResponse.data);
            // Log FlyGate Refund Response
            await prisma.flyGateLog.create({
                data: { orderId: orderId, status: "RES", type: "REFUND", payload: JSON.stringify(flyGateResponse.data) }
            }).catch(e => console.error("FlyGate Log Error:", e));

            return res.status(200).json({
                "ResponseCode": 1,
                "success": "Success",
                "ResponseCodeDescription": "Successfully accepted Refund request",
                "data": flyGateResponse.data
            });
        } else {
            return res.status(400).json({
                "ResponseCode": 0,
                "ResponseCodeDescription": `There is no transaction associated with Reference: ${ReferenceNumber}`,
                "Status": "Error"
            });
        }
    } catch (error) {
        return res.status(500).json({
            status: "Error",
            message: error.message
        });
    }
};


export { validatePNR, confirmOrder, refundRequest };