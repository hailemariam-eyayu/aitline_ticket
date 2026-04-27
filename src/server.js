import express from 'express';
import movieRoutes from "./routes/MovieRoutes.js";
import authRoutes from "./routes/AuthRoutes.js";
import flygateRoutes from "./routes/flygateRoutes.js";
import watchlistRoutes from "./routes/watchListItemsRoute.js"
import { connectToDatabase, disconnectFromDatabase } from './config/db.js';
import { config } from 'dotenv';
import { watchlistStatus } from '@prisma/client';
config();
connectToDatabase();
const app = express();


// Body parsing middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//API Routes

console.log("Auth routes");
app.use("/auth", authRoutes);
console.log("Movie routes loaded");
app.use("/movies", movieRoutes);
console.log("Flygate routes loaded");
app.use("/airline", flygateRoutes);

//Handle unhandled promise rejection eg, DB connection errors
process.on("unhandledRejection", (err) => {
    console.error("Unhandled Rejection:", err);
    Server.close(async () => {
        await disconnectFromDatabase();
        process.exit(1);
    });
  });

// Handle uncaught exceptions 
process.on("uncaughtException", async (err) => {
    console.error("Uncaught Exception:", err);
    await disconnectFromDatabase();
    process.exit(1);
} ); 

//Graceful shutdown on SIGINT (Ctrl+C) or SIGTERM
process.on("SIGTERM", async () => {
    console.log("Received SIGTERM signal. Shutting down gracefully...");
    await disconnectFromDatabase();
    process.exit(0);
});


const port = process.env.PORT || 4001;
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});