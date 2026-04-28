import express from "express";
import { queryRideAccount, payRide, getRideTransactions } from "../controllers/rideController.js";

const router = express.Router();

// POST /ride/query        — verify phone is an active Ride account
router.post("/query", queryRideAccount);

// POST /ride/pay          — full flow: query → CBS debit → Ride confirm
router.post("/pay", payRide);

// GET  /ride/transactions — paginated audit log
router.get("/transactions", getRideTransactions);

export default router;
