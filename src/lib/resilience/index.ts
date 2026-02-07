/**
 * Resilience Utilities
 *
 * Provides circuit breaker, retry with exponential backoff,
 * and request timeout patterns for external API calls.
 */

import { logger } from "@/lib/logger";

// ============================================================
// Circuit Breaker
// ============================================================

export enum CircuitState {
  CLOSED = "CLOSED",       // Normal operation
  OPEN = "OPEN",           // Failing - reject requests immediately
  HALF_OPEN = "HALF_OPEN", // Testing if service recovered
}

export interface CircuitBreakerOptions {
  /** Name for logging */
  name: string;
  /** Number of failures before opening */
  failureThreshold: number;
  /** Time in ms before attempting recovery */
  resetTimeout: number;
  /** Number of successful probes to close circuit */
  successThreshold: number;
}

const DEFAULT_CB_OPTIONS: CircuitBreakerOptions = {
  name: "default",
  failureThreshold: 5,
  resetTimeout: 30_000, // 30 seconds
  successThreshold: 2,
};

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = { ...DEFAULT_CB_OPTIONS, ...options };
  }

  get currentState(): CircuitState {
    if (this.state === CircuitState.OPEN) {
      // Check if we should transition to half-open
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        logger.info(`Circuit breaker [${this.options.name}] transitioning to HALF_OPEN`);
      }
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.currentState;

    if (state === CircuitState.OPEN) {
      const retryIn = Math.ceil(
        (this.options.resetTimeout - (Date.now() - this.lastFailureTime)) / 1000
      );
      throw new CircuitBreakerError(
        `Circuit breaker [${this.options.name}] is OPEN. Retry in ${retryIn}s.`
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        logger.info(`Circuit breaker [${this.options.name}] CLOSED (recovered)`);
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (
      this.failureCount >= this.options.failureThreshold ||
      this.state === CircuitState.HALF_OPEN
    ) {
      this.state = CircuitState.OPEN;
      logger.warn(
        `Circuit breaker [${this.options.name}] OPENED after ${this.failureCount} failures`
      );
    }
  }

  /** Force reset for testing */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
  }

  getStats() {
    return {
      name: this.options.name,
      state: this.currentState,
      failureCount: this.failureCount,
      successCount: this.successCount,
    };
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitBreakerError";
  }
}

// ============================================================
// Retry with Exponential Backoff
// ============================================================

export interface RetryOptions {
  /** Maximum number of attempts (including the first) */
  maxAttempts: number;
  /** Initial delay in ms */
  initialDelay: number;
  /** Maximum delay in ms */
  maxDelay: number;
  /** Multiplier for exponential backoff */
  backoffFactor: number;
  /** Add random jitter to delays */
  jitter: boolean;
  /** Which errors are retryable (default: all) */
  retryableErrors?: (error: unknown) => boolean;
  /** Callback on each retry */
  onRetry?: (attempt: number, error: unknown, delay: number) => void;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30_000,
  backoffFactor: 2,
  jitter: true,
};

function isRetryableError(error: unknown): boolean {
  if (error instanceof CircuitBreakerError) return false;

  if (error instanceof Error) {
    // Network errors
    if (error.message.includes("fetch failed")) return true;
    if (error.message.includes("ECONNREFUSED")) return true;
    if (error.message.includes("ETIMEDOUT")) return true;
    if (error.message.includes("network")) return true;
  }

  return true; // Default: retry
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const retryable = opts.retryableErrors || isRetryableError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= opts.maxAttempts || !retryable(error)) {
        throw error;
      }

      // Calculate delay with exponential backoff
      let delay = Math.min(
        opts.initialDelay * Math.pow(opts.backoffFactor, attempt - 1),
        opts.maxDelay
      );

      // Add jitter
      if (opts.jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }

      opts.onRetry?.(attempt, error, delay);

      logger.warn(`Retry attempt ${attempt}/${opts.maxAttempts}`, {
        delay: Math.round(delay),
        error: error instanceof Error ? error.message : String(error),
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ============================================================
// Request Timeout
// ============================================================

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label = "operation"
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      fn(controller.signal),
      timeoutPromise,
    ]);
    return result;
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw error;
    }
    // If the function threw due to abort, wrap it as TimeoutError
    if (controller.signal.aborted) {
      throw new TimeoutError(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId!);
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

// ============================================================
// Resilient Fetch - Combines all patterns
// ============================================================

export interface ResilientFetchOptions {
  /** Request timeout in ms */
  timeout?: number;
  /** Retry configuration */
  retry?: Partial<RetryOptions>;
  /** Circuit breaker instance */
  circuitBreaker?: CircuitBreaker;
  /** Label for logging */
  label?: string;
}

/**
 * Fetch with built-in timeout, retry, and circuit breaker.
 *
 * @example
 * ```ts
 * const data = await resilientFetch("https://api.example.com/data", {
 *   timeout: 10_000,
 *   retry: { maxAttempts: 3 },
 *   circuitBreaker: myBreaker,
 *   label: "ExampleAPI",
 * });
 * ```
 */
export async function resilientFetch(
  url: string,
  init: RequestInit = {},
  options: ResilientFetchOptions = {}
): Promise<Response> {
  const {
    timeout = 30_000,
    retry = {},
    circuitBreaker,
    label = "fetch",
  } = options;

  const doFetch = async () => {
    return withTimeout(
      async (signal) => {
        const response = await fetch(url, { ...init, signal });

        // Treat 5xx as retryable errors
        if (response.status >= 500) {
          const body = await response.text();
          throw new Error(
            `${label}: HTTP ${response.status} - ${body.slice(0, 200)}`
          );
        }

        return response;
      },
      timeout,
      label
    );
  };

  const retryableErrors = (error: unknown) => {
    if (error instanceof CircuitBreakerError) return false;
    if (error instanceof TimeoutError) return true;
    return isRetryableError(error);
  };

  const withRetryFetch = () =>
    withRetry(doFetch, {
      ...retry,
      retryableErrors,
      onRetry: (attempt, error, delay) => {
        logger.warn(`[${label}] Retrying (attempt ${attempt})`, {
          error: error instanceof Error ? error.message : String(error),
          delay: Math.round(delay),
          url,
        });
      },
    });

  if (circuitBreaker) {
    return circuitBreaker.execute(withRetryFetch);
  }

  return withRetryFetch();
}

// ============================================================
// Pre-configured Circuit Breakers for External Services
// ============================================================

export const circuitBreakers = {
  anthropic: new CircuitBreaker({
    name: "Anthropic",
    failureThreshold: 3,
    resetTimeout: 60_000,
    successThreshold: 2,
  }),
  openAlex: new CircuitBreaker({
    name: "OpenAlex",
    failureThreshold: 5,
    resetTimeout: 30_000,
    successThreshold: 2,
  }),
  semanticScholar: new CircuitBreaker({
    name: "SemanticScholar",
    failureThreshold: 5,
    resetTimeout: 30_000,
    successThreshold: 2,
  }),
  pubmed: new CircuitBreaker({
    name: "PubMed",
    failureThreshold: 5,
    resetTimeout: 30_000,
    successThreshold: 2,
  }),
};

/** Get all circuit breaker stats for monitoring */
export function getCircuitBreakerStats() {
  return Object.values(circuitBreakers).map((cb) => cb.getStats());
}
