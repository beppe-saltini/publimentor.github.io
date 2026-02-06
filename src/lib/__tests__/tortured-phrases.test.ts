/**
 * Test Suite: Tortured Phrases Detection
 * Tests paper mill detection via tortured phrase scanning.
 *
 * TC-IDs: TP-001 through TP-010
 */

import { describe, it, expect } from "vitest";
import {
  detectTorturedPhrases,
  getCategoryDisplayName,
  getSeverityColor,
  getSeverityBadgeClass,
  TORTURED_PHRASES,
} from "../tortured-phrases";

// ============================================================
// detectTorturedPhrases
// ============================================================
describe("detectTorturedPhrases", () => {
  it("TP-001: clean academic text returns no matches", () => {
    const cleanText = `
      This study investigates the application of artificial intelligence 
      and deep learning techniques in the field of natural language processing. 
      We performed linear regression analysis on the dataset and found 
      statistically significant results. The neural network architecture 
      achieved state-of-the-art performance on the benchmark dataset.
    `;
    const result = detectTorturedPhrases(cleanText);
    expect(result.found).toBe(false);
    expect(result.matchCount).toBe(0);
    expect(result.severity).toBe("none");
  });

  it("TP-002: detects single high-severity tortured phrase", () => {
    const text = "We used counterfeit consciousness to analyze the data.";
    const result = detectTorturedPhrases(text);
    expect(result.found).toBe(true);
    expect(result.matchCount).toBeGreaterThanOrEqual(1);
    const match = result.matches.find(
      (m) => m.pattern.torturedPhrase === "counterfeit consciousness"
    );
    expect(match).toBeDefined();
  });

  it("TP-003: multiple high-severity matches yield high severity", () => {
    const text = `
      The counterfeit consciousness model was trained using profound learning.
      We applied the choice tree algorithm and irregular woodland classifier
      to the dataset.
    `;
    const result = detectTorturedPhrases(text);
    expect(result.found).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.matchCount).toBeGreaterThanOrEqual(3);
  });

  it("TP-004: case insensitive matching", () => {
    const text = "We used PROFOUND LEARNING techniques.";
    const result = detectTorturedPhrases(text);
    expect(result.found).toBe(true);
    const match = result.matches.find(
      (m) => m.pattern.torturedPhrase === "profound learning"
    );
    expect(match).toBeDefined();
  });

  it("TP-005: context extraction includes surrounding text", () => {
    const text =
      "In this paper, we propose a counterfeit consciousness approach for classification.";
    const result = detectTorturedPhrases(text);
    expect(result.found).toBe(true);
    expect(result.matches[0].location.context.length).toBeGreaterThan(
      result.matches[0].matchedText.length
    );
  });

  it("TP-006: summary includes category breakdown", () => {
    const text = `
      We used profound learning and straight relapse models.
    `;
    const result = detectTorturedPhrases(text);
    expect(result.found).toBe(true);
    expect(result.summary).toContain("indicator");
  });

  it("TP-007: disclaimer is always present and non-empty", () => {
    const cleanResult = detectTorturedPhrases("Normal text.");
    expect(cleanResult.disclaimer).toBeTruthy();
    expect(cleanResult.disclaimer.length).toBeGreaterThan(0);

    const dirtyResult = detectTorturedPhrases("counterfeit consciousness");
    expect(dirtyResult.disclaimer).toBeTruthy();
    expect(dirtyResult.disclaimer.length).toBeGreaterThan(0);
  });

  it("TP-008: matches sorted by severity (high first)", () => {
    const text = `
      This exploration paper uses information mining and counterfeit consciousness.
    `;
    const result = detectTorturedPhrases(text);
    if (result.matches.length >= 2) {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      for (let i = 1; i < result.matches.length; i++) {
        const prevSev =
          severityOrder[result.matches[i - 1].pattern.severity];
        const currSev =
          severityOrder[result.matches[i].pattern.severity];
        expect(prevSev).toBeLessThanOrEqual(currSev);
      }
    }
  });

  it("detects biology tortured phrases", () => {
    const text = "The quality articulation levels of the nucleic corrosive were measured.";
    const result = detectTorturedPhrases(text);
    expect(result.found).toBe(true);
    const bioMatch = result.matches.find(
      (m) => m.pattern.category === "biology"
    );
    expect(bioMatch).toBeDefined();
  });

  it("detects computing tortured phrases", () => {
    const text = "We stored enormous information on the square chain.";
    const result = detectTorturedPhrases(text);
    expect(result.found).toBe(true);
    const compMatch = result.matches.find(
      (m) => m.pattern.category === "computing"
    );
    expect(compMatch).toBeDefined();
  });

  it("medium severity threshold works correctly", () => {
    // 1 high + 0 medium should be medium overall
    const text = "We used counterfeit consciousness.";
    const result = detectTorturedPhrases(text);
    expect(result.severity).toBe("medium");
  });

  it("low severity for only low-severity matches", () => {
    const text = "This was earlier work.";
    const result = detectTorturedPhrases(text);
    if (result.found) {
      // If the phrase matches, severity should be low
      expect(["low", "medium"]).toContain(result.severity);
    }
  });
});

// ============================================================
// Helper functions
// ============================================================
describe("getCategoryDisplayName", () => {
  it("TP-009: maps category IDs to display names", () => {
    expect(getCategoryDisplayName("ai_ml")).toBe("AI/Machine Learning");
    expect(getCategoryDisplayName("statistics")).toBe("Statistics");
    expect(getCategoryDisplayName("methodology")).toBe("Methodology");
    expect(getCategoryDisplayName("biology")).toBe("Biology");
    expect(getCategoryDisplayName("chemistry")).toBe("Chemistry");
    expect(getCategoryDisplayName("physics")).toBe("Physics");
    expect(getCategoryDisplayName("computing")).toBe("Computing");
    expect(getCategoryDisplayName("general_academic")).toBe("General Academic");
  });
});

describe("getSeverityColor", () => {
  it("TP-010: returns correct color classes", () => {
    expect(getSeverityColor("none")).toContain("green");
    expect(getSeverityColor("low")).toContain("blue");
    expect(getSeverityColor("medium")).toContain("amber");
    expect(getSeverityColor("high")).toContain("orange");
  });
});

describe("getSeverityBadgeClass", () => {
  it("returns correct badge classes", () => {
    expect(getSeverityBadgeClass("high")).toContain("orange");
    expect(getSeverityBadgeClass("medium")).toContain("amber");
    expect(getSeverityBadgeClass("low")).toContain("blue");
  });
});

// ============================================================
// TORTURED_PHRASES data integrity
// ============================================================
describe("TORTURED_PHRASES data", () => {
  it("all patterns have required fields", () => {
    for (const pattern of TORTURED_PHRASES) {
      expect(pattern.id).toBeTruthy();
      expect(pattern.torturedPhrase).toBeTruthy();
      expect(pattern.originalPhrase).toBeTruthy();
      expect(pattern.category).toBeTruthy();
      expect(["high", "medium", "low"]).toContain(pattern.severity);
    }
  });

  it("all pattern IDs are unique", () => {
    const ids = TORTURED_PHRASES.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("all tortured phrases are unique", () => {
    const phrases = TORTURED_PHRASES.map((p) => p.torturedPhrase.toLowerCase());
    const uniquePhrases = new Set(phrases);
    expect(uniquePhrases.size).toBe(phrases.length);
  });
});
