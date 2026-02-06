/**
 * Test Suite: Name Matcher
 * Tests fuzzy name matching including nicknames, Chinese transliterations,
 * diacritics, phonetic matching, and Jaro-Winkler similarity.
 *
 * TC-IDs: NM-001 through NM-020
 */

import { describe, it, expect } from "vitest";
import {
  normalizeString,
  getCanonicalName,
  getNameVariations,
  getChineseVariations,
  levenshteinDistance,
  jaroWinklerSimilarity,
  soundex,
  matchNames,
  matchFullNames,
  findBestMatches,
} from "../name-matcher";

// ============================================================
// normalizeString
// ============================================================
describe("normalizeString", () => {
  it("converts to lowercase and trims", () => {
    expect(normalizeString("  HELLO  ")).toBe("hello");
  });

  it("NM-007: replaces diacritics with ASCII equivalents", () => {
    expect(normalizeString("José")).toBe("jose");
    expect(normalizeString("François")).toBe("francois");
    expect(normalizeString("Müller")).toBe("muller");
    expect(normalizeString("Søren")).toBe("soren");
    expect(normalizeString("Łukasz")).toBe("lukasz");
  });

  it("NM-020: handles German ß", () => {
    expect(normalizeString("Straße")).toBe("strasse");
  });

  it("preserves hyphens and apostrophes in names", () => {
    expect(normalizeString("O'Brien")).toBe("o'brien");
    expect(normalizeString("Mary-Jane")).toBe("mary-jane");
  });

  it("removes other punctuation", () => {
    expect(normalizeString("Dr. Smith!")).toBe("dr smith");
  });
});

// ============================================================
// getCanonicalName
// ============================================================
describe("getCanonicalName", () => {
  it("returns canonical form for nicknames", () => {
    expect(getCanonicalName("Jim")).toBe("james");
    expect(getCanonicalName("Bill")).toBe("william");
    expect(getCanonicalName("Bob")).toBe("robert");
    expect(getCanonicalName("Dick")).toBe("richard");
  });

  it("returns normalized name if no canonical form exists", () => {
    expect(getCanonicalName("Zephyr")).toBe("zephyr");
  });
});

// ============================================================
// getNameVariations
// ============================================================
describe("getNameVariations", () => {
  it("NM-017: returns variations for a canonical name", () => {
    const variations = getNameVariations("James");
    expect(variations).toContain("james");
    expect(variations).toContain("jim");
    expect(variations).toContain("jimmy");
    expect(variations).toContain("jamie");
  });

  it("returns variations for a nickname", () => {
    const variations = getNameVariations("Jim");
    expect(variations).toContain("jim");
    expect(variations).toContain("james");
    expect(variations).toContain("jimmy");
  });

  it("returns only the name itself for unknown names", () => {
    const variations = getNameVariations("Zephyr");
    expect(variations).toEqual(["zephyr"]);
  });
});

// ============================================================
// getChineseVariations
// ============================================================
describe("getChineseVariations", () => {
  it("NM-018: returns Chinese transliteration variants", () => {
    const variations = getChineseVariations("zhang");
    expect(variations).toContain("zhang");
    expect(variations).toContain("chang");
    expect(variations).toContain("cheung");
  });

  it("returns variants for common surnames", () => {
    const liVariations = getChineseVariations("li");
    expect(liVariations).toContain("li");
    expect(liVariations).toContain("lee");

    const wangVariations = getChineseVariations("wang");
    expect(wangVariations).toContain("wang");
    expect(wangVariations).toContain("wong");
  });

  it("returns reverse variants (variant -> canonical)", () => {
    const variations = getChineseVariations("chang");
    expect(variations).toContain("zhang");
    expect(variations).toContain("chang");
  });

  it("returns only itself for non-Chinese names", () => {
    const variations = getChineseVariations("smith");
    expect(variations).toContain("smith");
  });
});

// ============================================================
// levenshteinDistance
// ============================================================
describe("levenshteinDistance", () => {
  it("NM-013: calculates correct distance", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });

  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  it("returns length for empty vs non-empty", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });

  it("returns 0 for two empty strings", () => {
    expect(levenshteinDistance("", "")).toBe(0);
  });

  it("handles single character differences", () => {
    expect(levenshteinDistance("cat", "bat")).toBe(1);
  });
});

// ============================================================
// jaroWinklerSimilarity
// ============================================================
describe("jaroWinklerSimilarity", () => {
  it("NM-014: returns 1.0 for identical strings", () => {
    expect(jaroWinklerSimilarity("abc", "abc")).toBe(1.0);
  });

  it("NM-015: returns 0 for one or both empty strings", () => {
    expect(jaroWinklerSimilarity("", "abc")).toBe(0);
    expect(jaroWinklerSimilarity("abc", "")).toBe(0);
  });

  it("returns high similarity for similar strings", () => {
    const similarity = jaroWinklerSimilarity("martha", "marhta");
    expect(similarity).toBeGreaterThan(0.9);
  });

  it("returns low similarity for very different strings", () => {
    const similarity = jaroWinklerSimilarity("abc", "xyz");
    expect(similarity).toBeLessThan(0.5);
  });
});

// ============================================================
// soundex
// ============================================================
describe("soundex", () => {
  it("NM-016: encodes 'Robert' correctly", () => {
    expect(soundex("Robert")).toBe("R163");
  });

  it("encodes 'Smith' and 'Smyth' the same (phonetic match)", () => {
    expect(soundex("Smith")).toBe(soundex("Smyth"));
  });

  it("returns empty string for empty input", () => {
    expect(soundex("")).toBe("");
  });

  it("pads to 4 characters", () => {
    expect(soundex("A")).toHaveLength(4);
    expect(soundex("A")).toBe("A000");
  });

  it("truncates to 4 characters", () => {
    expect(soundex("Schwarzenegger")).toHaveLength(4);
  });
});

// ============================================================
// matchNames
// ============================================================
describe("matchNames", () => {
  it("NM-001: exact match returns confidence 1.0", () => {
    const result = matchNames("John", "John");
    expect(result.isMatch).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.matchType).toBe("exact");
  });

  it("NM-002: case insensitive matching", () => {
    const result = matchNames("john", "JOHN");
    expect(result.isMatch).toBe(true);
    expect(result.matchType).toBe("exact");
  });

  it("NM-003: nickname matching (James/Jim)", () => {
    const result = matchNames("James", "Jim");
    expect(result.isMatch).toBe(true);
    expect(result.matchType).toBe("nickname");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("NM-004: nickname matching (William/Bill)", () => {
    const result = matchNames("William", "Bill");
    expect(result.isMatch).toBe(true);
    expect(result.matchType).toBe("nickname");
  });

  it("NM-005: Chinese transliteration (Zhang/Chang)", () => {
    const result = matchNames("Zhang", "Chang");
    expect(result.isMatch).toBe(true);
    expect(result.matchType).toBe("transliteration");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("NM-006: Chinese transliteration (Li/Lee)", () => {
    const result = matchNames("Li", "Lee");
    expect(result.isMatch).toBe(true);
    expect(result.matchType).toBe("transliteration");
  });

  it("NM-008: completely different names don't match", () => {
    const result = matchNames("John", "Maria");
    expect(result.isMatch).toBe(false);
    expect(result.matchType).toBe("none");
  });

  it("NM-009: phonetic matching (Smith/Smyth)", () => {
    const result = matchNames("Smith", "Smyth");
    expect(result.isMatch).toBe(true);
    expect(result.matchType).toBe("phonetic");
  });

  it("female nickname matching (Elizabeth/Liz)", () => {
    const result = matchNames("Elizabeth", "Liz");
    expect(result.isMatch).toBe(true);
    expect(result.matchType).toBe("nickname");
  });

  it("multiple nickname chains (Elizabeth/Beth)", () => {
    const result = matchNames("Elizabeth", "Beth");
    expect(result.isMatch).toBe(true);
  });
});

// ============================================================
// matchFullNames
// ============================================================
describe("matchFullNames", () => {
  it("NM-010: full name exact match", () => {
    const result = matchFullNames("John", "Smith", "John", "Smith");
    expect(result.isMatch).toBe(true);
    expect(result.matchType).toBe("exact");
  });

  it("NM-011: full name with nickname matching", () => {
    const result = matchFullNames("James", "Smith", "Jim", "Smith");
    expect(result.isMatch).toBe(true);
  });

  it("NM-012: different surnames don't match", () => {
    const result = matchFullNames("John", "Smith", "John", "Jones");
    expect(result.isMatch).toBe(false);
  });

  it("same surname different first names may not match", () => {
    const result = matchFullNames("Alice", "Smith", "Zara", "Smith");
    // Surname matches but first name very different - depends on confidence threshold
    expect(result.confidence).toBeLessThan(1.0);
  });

  it("Chinese full name transliteration match", () => {
    const result = matchFullNames("Wei", "Zhang", "Wei", "Chang");
    expect(result.isMatch).toBe(true);
  });
});

// ============================================================
// findBestMatches
// ============================================================
describe("findBestMatches", () => {
  it("NM-019: finds best matches from candidates", () => {
    const matches = findBestMatches("Jim", ["James", "John", "Jane"], 0.5);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].name).toBe("James");
    expect(matches[0].result.isMatch).toBe(true);
  });

  it("returns empty array when no matches above threshold", () => {
    const matches = findBestMatches("Zephyr", ["Alice", "Bob", "Charlie"], 0.95);
    expect(matches).toHaveLength(0);
  });

  it("returns matches sorted by confidence descending", () => {
    const matches = findBestMatches("John", ["John", "Johnny", "Jon", "Jane"], 0.5);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].result.confidence).toBeGreaterThanOrEqual(
        matches[i].result.confidence
      );
    }
  });
});
