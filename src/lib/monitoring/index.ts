/**
 * Monitoring & Error Tracking
 *
 * Provides Sentry integration for production error tracking
 * and performance monitoring. Falls back to console logging
 * when SENTRY_DSN is not configured.
 */

import { logger } from "@/lib/logger";

// ============================================================
// Types
// ============================================================

interface ErrorContext {
  userId?: string;
  requestId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

// ============================================================
// Sentry-compatible Interface
// ============================================================

let _sentryInitialized = false;

/**
 * Initialize error tracking. Call once at app startup.
 * Requires SENTRY_DSN environment variable.
 */
export async function initMonitoring(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    logger.info("[Monitoring] SENTRY_DSN not set - using console-only error tracking");
    return;
  }

  try {
    // Dynamic import to avoid bundling Sentry when not used
    // @ts-expect-error - @sentry/nextjs is an optional dependency, only installed when SENTRY_DSN is configured
    const Sentry = await import("@sentry/nextjs");

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      release: process.env.APP_VERSION || "0.1.0",
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
      // Don't send PII
      sendDefaultPii: false,
      // Ignore common non-errors
      ignoreErrors: [
        "AbortError",
        "NavigationDuplicated",
        "NEXT_NOT_FOUND",
      ],
    });

    _sentryInitialized = true;
    logger.info("[Monitoring] Sentry initialized successfully");
  } catch (error) {
    logger.warn("[Monitoring] Failed to initialize Sentry - using console-only", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Capture an exception for error tracking.
 */
export async function captureException(
  error: Error | unknown,
  context?: ErrorContext
): Promise<void> {
  // Always log locally
  logger.error(
    "Captured exception",
    error instanceof Error ? error : new Error(String(error)),
    context?.extra
  );

  if (!_sentryInitialized) return;

  try {
    // @ts-expect-error - @sentry/nextjs is an optional dependency, only installed when SENTRY_DSN is configured
    const Sentry = await import("@sentry/nextjs");

    Sentry.withScope((scope: any) => {
      if (context?.userId) scope.setUser({ id: context.userId });
      if (context?.requestId) scope.setTag("requestId", context.requestId);
      if (context?.tags) {
        Object.entries(context.tags).forEach(([key, value]) =>
          scope.setTag(key, value)
        );
      }
      if (context?.extra) {
        Object.entries(context.extra).forEach(([key, value]) =>
          scope.setExtra(key, value)
        );
      }

      Sentry.captureException(error);
    });
  } catch {
    // Sentry not available, already logged above
  }
}

/**
 * Capture a message for tracking.
 */
export async function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
  context?: ErrorContext
): Promise<void> {
  logger.info(message, context?.extra);

  if (!_sentryInitialized) return;

  try {
    // @ts-expect-error - @sentry/nextjs is an optional dependency, only installed when SENTRY_DSN is configured
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureMessage(message, level);
  } catch {
    // Sentry not available
  }
}

/**
 * Set user context for error tracking.
 */
export async function setUser(user: { id: string; email?: string }): Promise<void> {
  if (!_sentryInitialized) return;

  try {
    // @ts-expect-error - @sentry/nextjs is an optional dependency, only installed when SENTRY_DSN is configured
    const Sentry = await import("@sentry/nextjs");
    Sentry.setUser(user);
  } catch {
    // Sentry not available
  }
}

/**
 * Start a performance transaction.
 */
export async function startTransaction(
  name: string,
  op: string
): Promise<{ finish: () => void }> {
  if (!_sentryInitialized) {
    const start = Date.now();
    return {
      finish: () => {
        logger.debug(`Transaction [${name}] completed in ${Date.now() - start}ms`);
      },
    };
  }

  try {
    // @ts-expect-error - @sentry/nextjs is an optional dependency, only installed when SENTRY_DSN is configured
    const Sentry = await import("@sentry/nextjs");
    return Sentry.startInactiveSpan({ name, op }) || { finish: () => {} };
  } catch {
    return { finish: () => {} };
  }
}
