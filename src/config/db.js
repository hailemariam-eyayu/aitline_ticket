import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import "dotenv/config";

// 1. Create a PostgreSQL connection pool
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// 2. Initialize the adapter
const adapter = new PrismaPg(pool);

// 3. Pass the adapter to PrismaClient
const prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

const connectToDatabase = async () => {
    try {
        // With adapters, a simple query is often better to test the connection
        await prisma.$queryRaw`SELECT 1`;
        console.log("✅ Connected to the database successfully via Adapter.");
    } catch (error) {
        console.error("❌ Error connecting to the database:", error);
    }
};

const disconnectFromDatabase = async () => {
    try {
        await prisma.$disconnect();
        await pool.end(); // Also close the pg pool
        console.log("Disconnected from the database successfully.");   
    } catch (error) {
        console.error("Error disconnecting from the database:", error);
    }
};

export { prisma, connectToDatabase, disconnectFromDatabase };
