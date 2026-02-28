/**
 * Tests for withTimeout Promise.race Fix
 *
 * The withTimeout function was refactored to use Promise.race to properly
 * enforce timeouts even when the inner function ignores the AbortSignal.
 * These tests verify the fix works correctly.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// Mock the logger that resilience/index.ts imports
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { withTimeout, TimeoutError } from "../index";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout - Promise.race fix", () => {
  it("TO-001: resolves when function completes before timeout", async () => {
    const result = await withTimeout(async () => "success", 1000, "fast-op");
    expect(result).toBe("success");
  });

  it("TO-002: throws TimeoutError when function exceeds timeout", async () => {
    await expect(
      withTimeout(
        async () => new Promise((resolve) => setTimeout(resolve, 300)),
        50,
        "slow-op"
      )
    ).rejects.toThrow(TimeoutError);
  });

  it("TO-003: timeout error message includes label and duration", async () => {
    try {
      await withTimeout(
        async () => new Promise((resolve) => setTimeout(resolve, 300)),
        25,
        "my-operation"
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).message).toContain("my-operation");
      expect((error as TimeoutError).message).toContain("25ms");
    }
  });

  it("TO-004: passes AbortSignal to the function", async () => {
    let receivedSignal: AbortSignal | null = null;

    await withTimeout(
      async (signal) => {
        receivedSignal = signal;
        return "ok";
      },
      1000,
      "signal-test"
    );

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it("TO-005: aborts the signal when timeout fires", async () => {
    let signalAborted = false;

    try {
      await withTimeout(
        async (signal) => {
          return new Promise((resolve) => {
            const check = setInterval(() => {
              if (signal.aborted) {
                signalAborted = true;
                clearInterval(check);
              }
            }, 10);
            setTimeout(resolve, 500);
          });
        },
        50,
        "abort-test"
      );
    } catch {
      // Expected timeout
    }

    // Give the interval a moment to detect the abort
    await new Promise((r) => setTimeout(r, 30));
    expect(signalAborted).toBe(true);
  });

  it("TO-006: propagates non-timeout errors from function", async () => {
    await expect(
      withTimeout(
        async () => {
          throw new Error("business logic error");
        },
        1000,
        "error-test"
      )
    ).rejects.toThrow("business logic error");
  });

  it("TO-007: does not throw TimeoutError for non-timeout errors", async () => {
    try {
      await withTimeout(
        async () => {
          throw new Error("custom error");
        },
        1000,
        "custom-error-test"
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).not.toBeInstanceOf(TimeoutError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("TO-008: clears timeout when function completes successfully", async () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");

    await withTimeout(async () => "fast", 5000, "cleanup-test");

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("TO-009: uses default label 'operation' when not specified", async () => {
    try {
      await withTimeout(
        async () => new Promise((resolve) => setTimeout(resolve, 200)),
        25
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).message).toContain("operation");
    }
  });

  it("TO-010: timeout fires even if inner function ignores signal", async () => {
    // This is the specific bug that was fixed: previously, if the inner
    // function ignored the AbortSignal, withTimeout would wait forever.
    await expect(
      withTimeout(
        async (_signal) => {
          // Explicitly ignores signal - just waits
          return new Promise((resolve) => setTimeout(resolve, 500));
        },
        50,
        "ignore-signal"
      )
    ).rejects.toThrow(TimeoutError);
  });
});
