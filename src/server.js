import express from 'express';
import cors from 'cors';
import flygateRoutes from "./routes/flygateRoutes.js";
import cbsTransferRoutes from "./routes/cbsTransferRoutes.js";
import rideRoutes from "./routes/rideRoutes.js";
import { connectToDatabase, disconnectFromDatabase } from './config/db.js';
import { config } from 'dotenv';
config();
connectToDatabase();
const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:3001")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server tools (Postman/curl), configured origins, and localhost dev ports.
    const isLocalhostDev =
      typeof origin === "string" &&
      /^http:\/\/localhost:\d+$/.test(origin);

    // Allow any origin from 10.1.12.* subnet
    const is10_1_12_Subnet =
      typeof origin === "string" &&
      /^http:\/\/10\.254\.100\.\d+:\d+$/.test(origin);

    if (!origin || allowedOrigins.includes(origin) || isLocalhostDev || is10_1_12_Subnet) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true
}));
app.options(/.*/, cors());

// Body parsing middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use("/airline", flygateRoutes);
app.use("/cbs", cbsTransferRoutes);
app.use("/ride", rideRoutes);

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