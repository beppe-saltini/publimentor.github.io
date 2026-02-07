/**
 * Graceful Shutdown Handler
 *
 * Ensures in-flight requests complete and resources are cleaned up
 * before the process exits. Essential for container orchestration.
 */

import { logger } from "@/lib/logger";

type ShutdownHandler = () => Promise<void>;

const handlers: { name: string; fn: ShutdownHandler }[] = [];
let isShuttingDown = false;

/**
 * Register a cleanup handler to run during graceful shutdown.
 *
 * @example
 * ```ts
 * onShutdown("database", async () => {
 *   await prisma.$disconnect();
 * });
 * ```
 */
export function onShutdown(name: string, fn: ShutdownHandler): void {
  handlers.push({ name, fn });
}

/**
 * Execute all shutdown handlers and exit.
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Give in-flight requests time to complete (configurable)
  const drainTimeout = parseInt(process.env.SHUTDOWN_DRAIN_MS || "5000", 10);
  logger.info(`Draining in-flight requests (${drainTimeout}ms)...`);
  await new Promise((resolve) => setTimeout(resolve, drainTimeout));

  // Run all cleanup handlers
  for (const handler of handlers) {
    try {
      logger.info(`Shutting down: ${handler.name}`);
      await Promise.race([
        handler.fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${handler.name} shutdown timed out`)), 10_000)
        ),
      ]);
    } catch (error) {
      logger.error(`Error shutting down ${handler.name}`, error);
    }
  }

  logger.info("Graceful shutdown complete.");
  process.exit(0);
}

/**
 * Initialize signal handlers. Call once at application startup.
 */
export function initShutdownHandlers(): void {
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // Unhandled rejection / uncaught exception logging
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled Promise Rejection", reason as Error);
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception", error);
    gracefulShutdown("uncaughtException");
  });
}
