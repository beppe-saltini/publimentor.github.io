import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    datasourceUrl: process.env.DATABASE_URL,
    // Connection pool configuration for production concurrency
    // Prisma uses a connection pool internally; tune via DATABASE_URL params:
    //   ?connection_limit=10&pool_timeout=30
    // Or via the `datasources` field in schema.prisma.
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Graceful shutdown: disconnect Prisma on process exit
const shutdownPrisma = async () => {
  await prisma.$disconnect();
};

process.on("beforeExit", shutdownPrisma);

export default prisma;
