import express from "express";
import { cbsTransfer, cbsReverse, getTransfers } from "../controllers/cbsTransferController.js";

const router = express.Router();

// POST /cbs/transfer  — execute a CBS CreateTransaction
router.post("/transfer", cbsTransfer);

// POST /cbs/reverse   — reverse a CBS transaction by FCCREF
router.post("/reverse", cbsReverse);

// GET  /cbs/transfers — query audit log
router.get("/transfers", getTransfers);

export default router;
