import express from "express";
import { validateAccounts, a2aTransfer, getA2ATransfers } from "../controllers/a2aController.js";

const router = express.Router();

// POST /a2a/validate  — check both accounts before showing transfer form
router.post("/validate", validateAccounts);

// POST /a2a/transfer  — execute the A2A transfer
router.post("/transfer", a2aTransfer);

// GET  /a2a/transfers — audit log
router.get("/transfers", getA2ATransfers);

export default router;
