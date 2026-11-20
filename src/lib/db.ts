import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const testSchema = process.env.TRUSTFOLIO_TEST_SCHEMA;
  const useTestSchema = process.env.NODE_ENV !== "production" && testSchema && /^trustfolio_phase[123456]_(?:ui|test)_[a-f0-9]{32}$/.test(testSchema);
  // Cap the pool. `next build` prerenders pages in several worker processes and
  // each one used to open pg's default pool (10), which exhausts a small managed
  // Postgres connection limit with P2037 TooManyConnections. Two per process is
  // plenty for this site's query volume and leaves headroom for build workers.
  const adapter = new PrismaPg(
    { connectionString: process.env.DATABASE_URL, max: 2 },
    useTestSchema ? { schema: testSchema } : undefined,
  );
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/** Single Prisma instance per process (survives dev hot reloads). */
export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
