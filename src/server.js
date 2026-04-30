import express from 'express';
import cors from 'cors';
import flygateRoutes from "./routes/flygateRoutes.js";
import cbsTransferRoutes from "./routes/cbsTransferRoutes.js";
import rideRoutes from "./routes/rideRoutes.js";
import a2aRoutes from "./routes/a2aRoutes.js";
import { connectToDatabase, disconnectFromDatabase } from './config/db.js';
import { config } from 'dotenv';
config();
connectToDatabase();
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.options(/.*/, cors({ origin: true, credentials: true }));

// Body parsing middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use("/airline", flygateRoutes);
app.use("/cbs", cbsTransferRoutes);
app.use("/ride", rideRoutes);
app.use("/a2a", a2aRoutes);

// //Handle unhandled promise rejection eg, DB connection errors
// process.on("unhandledRejection", (err) => {
//     console.error("Unhandled Rejection:", err);
//     server.close(async () => {
//         await disconnectFromDatabase();
//         process.exit(1);
//     });
//   });

// // Handle uncaught exceptions 
// process.on("uncaughtException", async (err) => {
//     console.error("Uncaught Exception:", err);
//     await disconnectFromDatabase();
//     process.exit(1);
// } ); 

// //Graceful shutdown on SIGINT (Ctrl+C) or SIGTERM
// process.on("SIGTERM", async () => {
//     console.log("Received SIGTERM signal. Shutting down gracefully...");
//     await disconnectFromDatabase();
//     process.exit(0);
// });


const port = process.env.PORT || 4001;
const server = app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

// ── Global error handler — always return JSON, never HTML ─────────────────────
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ status: "Error", message: err.message || "Internal Server Error" });
});