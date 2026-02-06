/**
 * Test Suite: Author Parser
 * Tests author name parsing, search string generation,
 * and author list processing.
 *
 * TC-IDs: AP-001 through AP-015
 */

import { describe, it, expect } from "vitest";
import {
  parseAuthorName,
  parseAuthorList,
  generatePubMedSearchString,
  generatePubMedUrl,
  generateScholarSearchString,
  generateScholarUrl,
  generateOpenAlexQueries,
} from "../author-parser";

// ============================================================
// parseAuthorName
// ============================================================
describe("parseAuthorName", () => {
  it("AP-001: parses simple two-name author", () => {
    const result = parseAuthorName("John Smith");
    expect(result).not.toBeNull();
    expect(result!.firstName).toBe("John");
    expect(result!.surname).toBe("Smith");
  });

  it("AP-002: parses author with middle initial", () => {
    const result = parseAuthorName("John A. Smith");
    expect(result).not.toBeNull();
    expect(result!.firstName).toBe("John");
    expect(result!.surname).toBe("Smith");
    expect(result!.middleInitials).toBe("A");
  });

  it("AP-003: parses author with surname prefix", () => {
    const result = parseAuthorName("Ludwig van Beethoven");
    expect(result).not.toBeNull();
    expect(result!.firstName).toBe("Ludwig");
    expect(result!.surnamePrefix).toContain("van");
    expect(result!.surname).toContain("Beethoven");
  });

  it("AP-004: removes title (Dr.)", () => {
    const result = parseAuthorName("Dr. John Smith");
    expect(result).not.toBeNull();
    expect(result!.firstName).toBe("John");
    expect(result!.surname).toBe("Smith");
  });

  it("removes title (Prof.)", () => {
    const result = parseAuthorName("Prof. Jane Doe");
    expect(result).not.toBeNull();
    expect(result!.firstName).toBe("Jane");
    expect(result!.surname).toBe("Doe");
  });

  it("AP-005: removes suffix (PhD)", () => {
    const result = parseAuthorName("John Smith PhD");
    expect(result).not.toBeNull();
    expect(result!.firstName).toBe("John");
    expect(result!.surname).toBe("Smith");
  });

  it("removes suffix (Jr.)", () => {
    const result = parseAuthorName("John Smith Jr.");
    expect(result).not.toBeNull();
    expect(result!.surname).toBe("Smith");
  });

  it("AP-006: handles single name (mononym)", () => {
    const result = parseAuthorName("Madonna");
    expect(result).not.toBeNull();
    expect(result!.surname).toBe("Madonna");
    expect(result!.firstName).toBe("");
  });

  it("AP-012: returns null for empty input", () => {
    expect(parseAuthorName("")).toBeNull();
    expect(parseAuthorName("  ")).toBeNull();
  });

  it("handles parenthetical alternative names", () => {
    const result = parseAuthorName("John (Jack) Smith");
    expect(result).not.toBeNull();
    expect(result!.surname).toBe("Smith");
  });

  it("AP-010: generates PubMed format", () => {
    const result = parseAuthorName("John A. Smith");
    expect(result).not.toBeNull();
    expect(result!.pubmedFormat).toContain("Smith");
    expect(result!.pubmedFormat).toContain("[au]");
  });

  it("AP-011: generates Scholar format", () => {
    const result = parseAuthorName("John Smith");
    expect(result).not.toBeNull();
    expect(result!.scholarFormat).toContain('author:"');
    expect(result!.scholarFormat).toContain("John");
    expect(result!.scholarFormat).toContain("Smith");
  });

  it("generates normalized name for fuzzy matching", () => {
    const result = parseAuthorName("José García");
    expect(result).not.toBeNull();
    expect(result!.normalizedName).toBe("jose garcia");
  });
});

// ============================================================
// parseAuthorList
// ============================================================
describe("parseAuthorList", () => {
  it("AP-007: parses comma-separated author list", () => {
    const result = parseAuthorList("John Smith, Jane Doe");
    expect(result).toHaveLength(2);
    expect(result[0].firstName).toBe("John");
    expect(result[1].firstName).toBe("Jane");
  });

  it("AP-008: parses 'and'-separated authors", () => {
    const result = parseAuthorList("John Smith and Jane Doe");
    expect(result).toHaveLength(2);
  });

  it("parses comma + 'and' combination", () => {
    const result = parseAuthorList("Alice Brown, Bob White, and Charlie Green");
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("AP-009: removes duplicate authors", () => {
    const result = parseAuthorList("John Smith, John Smith");
    expect(result).toHaveLength(1);
  });

  it("AP-013: removes superscript characters", () => {
    const result = parseAuthorList("John Smith¹², Jane Doe³");
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Names should not contain superscript numbers
    for (const author of result) {
      expect(author.fullName).not.toMatch(/[\u2070-\u209F\u00B9\u00B2\u00B3]/);
    }
  });

  it("removes special symbols (†, ‡, etc.)", () => {
    const result = parseAuthorList("John Smith†, Jane Doe‡");
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("handles empty input", () => {
    const result = parseAuthorList("");
    expect(result).toHaveLength(0);
  });
});

// ============================================================
// Search string generation
// ============================================================
describe("generatePubMedSearchString", () => {
  it("AP-014: generates search string with reviewer", () => {
    const authors = [parseAuthorName("John Smith")!];
    const result = generatePubMedSearchString(authors, "Jane Doe");
    expect(result).toContain("[au]");
    expect(result).toContain("AND");
  });

  it("generates search string without reviewer", () => {
    const authors = [parseAuthorName("John Smith")!];
    const result = generatePubMedSearchString(authors);
    expect(result).toContain("[au]");
    expect(result).toContain("Reviewer");
  });

  it("returns empty string for no authors", () => {
    expect(generatePubMedSearchString([])).toBe("");
  });
});

describe("generatePubMedUrl", () => {
  it("generates valid PubMed URL", () => {
    const authors = [parseAuthorName("John Smith")!];
    const url = generatePubMedUrl(authors);
    expect(url).toContain("pubmed.ncbi.nlm.nih.gov");
  });
});

describe("generateScholarSearchString", () => {
  it("generates search string with reviewer", () => {
    const authors = [parseAuthorName("John Smith")!];
    const result = generateScholarSearchString(authors, "Jane Doe");
    expect(result).toContain('author:"');
  });

  it("returns empty string for no authors", () => {
    expect(generateScholarSearchString([])).toBe("");
  });
});

describe("generateScholarUrl", () => {
  it("generates valid Scholar URL", () => {
    const authors = [parseAuthorName("John Smith")!];
    const url = generateScholarUrl(authors);
    expect(url).toContain("scholar.google.com");
  });
});

describe("generateOpenAlexQueries", () => {
  it("AP-015: generates query strings for each author", () => {
    const authors = [
      parseAuthorName("John Smith")!,
      parseAuthorName("Jane Doe")!,
    ];
    const queries = generateOpenAlexQueries(authors);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain("John");
    expect(queries[0]).toContain("Smith");
    expect(queries[1]).toContain("Jane");
    expect(queries[1]).toContain("Doe");
  });
});
