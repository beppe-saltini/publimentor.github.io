import { describe, it, expect } from "vitest";
import { isProcessingStale, PROCESSING_TIMEOUT_MS } from "../processing-timeout";

describe("isProcessingStale", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");

  it("ignores manuscripts that are not being processed", () => {
    expect(isProcessingStale("READY", new Date(now - 10 * PROCESSING_TIMEOUT_MS), now)).toBe(false);
    expect(isProcessingStale("ERROR", null, now)).toBe(false);
  });

  it("flags an in-flight run older than the timeout", () => {
    expect(isProcessingStale("PROCESSING", new Date(now - PROCESSING_TIMEOUT_MS - 1), now)).toBe(true);
    expect(isProcessingStale("EXTRACTING", null, now)).toBe(true);
  });

  it("leaves a recent run alone", () => {
    expect(isProcessingStale("EMBEDDING", new Date(now - 60_000), now)).toBe(false);
  });
});
