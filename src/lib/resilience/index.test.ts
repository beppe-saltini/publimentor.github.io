/**
 * Tests for Resilience Utilities
 * Circuit Breaker, Retry, and Timeout patterns
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerError,
  withRetry,
  withTimeout,
  TimeoutError,
} from "./index";

// ============================================================
// Circuit Breaker Tests
// ============================================================

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      resetTimeout: 1000,
      successThreshold: 2,
    });
  });

  it("starts in CLOSED state", () => {
    expect(breaker.currentState).toBe(CircuitState.CLOSED);
  });

  it("stays CLOSED on successful calls", async () => {
    await breaker.execute(() => Promise.resolve("ok"));
    expect(breaker.currentState).toBe(CircuitState.CLOSED);
  });

  it("opens after reaching failure threshold", async () => {
    const fail = () => Promise.reject(new Error("fail"));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    expect(breaker.currentState).toBe(CircuitState.OPEN);
  });

  it("rejects immediately when OPEN", async () => {
    const fail = () => Promise.reject(new Error("fail"));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    await expect(
      breaker.execute(() => Promise.resolve("ok"))
    ).rejects.toThrow(CircuitBreakerError);
  });

  it("transitions to HALF_OPEN after reset timeout", async () => {
    const fail = () => Promise.reject(new Error("fail"));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    // Fast-forward time
    vi.useFakeTimers();
    vi.advanceTimersByTime(1100);

    expect(breaker.currentState).toBe(CircuitState.HALF_OPEN);
    vi.useRealTimers();
  });

  it("closes after success threshold in HALF_OPEN", async () => {
    const fail = () => Promise.reject(new Error("fail"));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    vi.useFakeTimers();
    vi.advanceTimersByTime(1100);

    // Two successes to close
    await breaker.execute(() => Promise.resolve("ok"));
    await breaker.execute(() => Promise.resolve("ok"));

    expect(breaker.currentState).toBe(CircuitState.CLOSED);
    vi.useRealTimers();
  });

  it("returns stats", () => {
    const stats = breaker.getStats();
    expect(stats.name).toBe("test");
    expect(stats.state).toBe(CircuitState.CLOSED);
    expect(stats.failureCount).toBe(0);
  });
});

// ============================================================
// Retry Tests
// ============================================================

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, initialDelay: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelay: 10,
      jitter: false,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after max attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fail"));

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelay: 10, jitter: false })
    ).rejects.toThrow("always fail");

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls onRetry callback", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    await withRetry(fn, {
      maxAttempts: 3,
      initialDelay: 10,
      jitter: false,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new CircuitBreakerError("open"));

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelay: 10 })
    ).rejects.toThrow(CircuitBreakerError);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Timeout Tests
// ============================================================

describe("withTimeout", () => {
  it("resolves before timeout", async () => {
    const result = await withTimeout(
      async () => "ok",
      1000,
      "test"
    );
    expect(result).toBe("ok");
  });

  it("throws TimeoutError when exceeded", async () => {
    await expect(
      withTimeout(
        async () => new Promise((resolve) => setTimeout(resolve, 200)),
        50,
        "test"
      )
    ).rejects.toThrow(TimeoutError);
  });

  it("passes AbortSignal to function", async () => {
    let receivedSignal: AbortSignal | null = null;

    await withTimeout(
      async (signal) => {
        receivedSignal = signal;
        return "ok";
      },
      1000,
      "test"
    );

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });
});
