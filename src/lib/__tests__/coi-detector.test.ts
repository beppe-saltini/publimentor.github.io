/**
 * Test Suite: COI Detector (Pure Functions)
 * Tests severity calculation, time adjustment, and worst severity logic.
 * Does NOT test async functions that call external APIs.
 *
 * TC-IDs: COI-001 through COI-016
 */

import { describe, it, expect } from "vitest";
import {
  adjustSeverityByTime,
  getWorstSeverity,
  type ConflictSeverity,
} from "../coi-detector";

// ============================================================
// getBaseSeverity (tested indirectly through adjustSeverityByTime)
// We test the behavior via the exported adjustSeverityByTime function
// ============================================================

// ============================================================
// adjustSeverityByTime
// ============================================================
describe("adjustSeverityByTime", () => {
  // COI-007: 0-2 years - no downgrade
  it("COI-007: no downgrade for 0-2 years (critical stays critical)", () => {
    expect(adjustSeverityByTime("critical", 0)).toBe("critical");
    expect(adjustSeverityByTime("critical", 1)).toBe("critical");
    expect(adjustSeverityByTime("critical", 2)).toBe("critical");
  });

  it("no downgrade for 0-2 years (high stays high)", () => {
    expect(adjustSeverityByTime("high", 0)).toBe("high");
    expect(adjustSeverityByTime("high", 2)).toBe("high");
  });

  // COI-008: 3-5 years - one step downgrade
  it("COI-008: one-step downgrade for 3-5 years", () => {
    expect(adjustSeverityByTime("critical", 3)).toBe("high");
    expect(adjustSeverityByTime("critical", 4)).toBe("high");
    expect(adjustSeverityByTime("critical", 5)).toBe("high");
  });

  it("high -> medium for 3-5 years", () => {
    expect(adjustSeverityByTime("high", 3)).toBe("medium");
    expect(adjustSeverityByTime("high", 5)).toBe("medium");
  });

  // COI-009: 6-10 years - two step downgrade
  it("COI-009: two-step downgrade for 6-10 years", () => {
    expect(adjustSeverityByTime("critical", 6)).toBe("medium");
    expect(adjustSeverityByTime("critical", 8)).toBe("medium");
    expect(adjustSeverityByTime("critical", 10)).toBe("medium");
  });

  it("high -> low for 6-10 years", () => {
    expect(adjustSeverityByTime("high", 7)).toBe("low");
  });

  // COI-010: 10+ years - three step downgrade
  it("COI-010: three-step downgrade for 10+ years", () => {
    expect(adjustSeverityByTime("critical", 11)).toBe("low");
    expect(adjustSeverityByTime("critical", 15)).toBe("low");
    expect(adjustSeverityByTime("critical", 50)).toBe("low");
  });

  // COI-011: capped at minimal
  it("COI-011: severity capped at minimal (cannot go below)", () => {
    expect(adjustSeverityByTime("low", 15)).toBe("minimal");
    expect(adjustSeverityByTime("minimal", 15)).toBe("minimal");
    expect(adjustSeverityByTime("medium", 15)).toBe("minimal");
  });

  // COI-012: undefined years returns base severity
  it("COI-012: undefined yearsSince returns base severity", () => {
    expect(adjustSeverityByTime("critical", undefined)).toBe("critical");
    expect(adjustSeverityByTime("high", undefined)).toBe("high");
    expect(adjustSeverityByTime("low", undefined)).toBe("low");
  });

  // COI-013: negative years returns base severity
  it("COI-013: negative yearsSince returns base severity", () => {
    expect(adjustSeverityByTime("critical", -1)).toBe("critical");
    expect(adjustSeverityByTime("high", -5)).toBe("high");
  });

  // Boundary testing
  it("boundary: exactly 2 years (no downgrade)", () => {
    expect(adjustSeverityByTime("critical", 2)).toBe("critical");
  });

  it("boundary: exactly 3 years (one downgrade)", () => {
    expect(adjustSeverityByTime("critical", 3)).toBe("high");
  });

  it("boundary: exactly 5 years (one downgrade)", () => {
    expect(adjustSeverityByTime("critical", 5)).toBe("high");
  });

  it("boundary: exactly 6 years (two downgrades)", () => {
    expect(adjustSeverityByTime("critical", 6)).toBe("medium");
  });

  it("boundary: exactly 10 years (two downgrades)", () => {
    expect(adjustSeverityByTime("critical", 10)).toBe("medium");
  });

  it("boundary: exactly 11 years (three downgrades)", () => {
    expect(adjustSeverityByTime("critical", 11)).toBe("low");
  });

  // Full severity matrix test
  it("full severity matrix for 10+ years", () => {
    expect(adjustSeverityByTime("critical", 15)).toBe("low");
    expect(adjustSeverityByTime("high", 15)).toBe("minimal");
    expect(adjustSeverityByTime("medium", 15)).toBe("minimal");
    expect(adjustSeverityByTime("low", 15)).toBe("minimal");
    expect(adjustSeverityByTime("minimal", 15)).toBe("minimal");
  });
});

// ============================================================
// getWorstSeverity
// ============================================================
describe("getWorstSeverity", () => {
  it("COI-014: returns worst severity from list", () => {
    expect(getWorstSeverity(["low", "critical", "medium"])).toBe("critical");
  });

  it("returns critical when present", () => {
    expect(getWorstSeverity(["high", "critical"])).toBe("critical");
  });

  it("COI-015: returns null for empty list", () => {
    expect(getWorstSeverity([])).toBe(null);
  });

  it("COI-016: returns the single item for single-element list", () => {
    expect(getWorstSeverity(["medium"])).toBe("medium");
    expect(getWorstSeverity(["minimal"])).toBe("minimal");
    expect(getWorstSeverity(["critical"])).toBe("critical");
  });

  it("returns high when critical is absent", () => {
    expect(getWorstSeverity(["medium", "high", "low"])).toBe("high");
  });

  it("handles all minimal correctly", () => {
    expect(getWorstSeverity(["minimal", "minimal", "minimal"])).toBe("minimal");
  });

  it("handles duplicates correctly", () => {
    expect(getWorstSeverity(["medium", "medium", "low"])).toBe("medium");
  });

  it("correctly orders all severity levels", () => {
    const allSeverities: ConflictSeverity[] = ["minimal", "low", "medium", "high", "critical"];
    expect(getWorstSeverity(allSeverities)).toBe("critical");

    const withoutCritical: ConflictSeverity[] = ["minimal", "low", "medium", "high"];
    expect(getWorstSeverity(withoutCritical)).toBe("high");
  });
});
