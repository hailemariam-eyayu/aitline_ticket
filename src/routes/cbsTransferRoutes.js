import express from "express";
import { cbsTransfer, cbsReverse, getTransfers, cbsQueryTransaction } from "../controllers/cbsTransferController.js";

const router = express.Router();

// POST /cbs/transfer  — execute a CBS CreateTransaction
router.post("/transfer", cbsTransfer);

// POST /cbs/reverse   — reverse a CBS transaction by FCCREF
router.post("/reverse", cbsReverse);

// POST /cbs/query     — look up a CBS transaction by acNo + date, or by fccRef
router.post("/query", cbsQueryTransaction);

// GET  /cbs/transfers — query audit log
router.get("/transfers", getTransfers);

export default router;
