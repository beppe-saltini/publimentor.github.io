/**
 * Unit tests for metadata-extractor internal functions
 *
 * Tests cover:
 * - normalizeAuthor: fullName splitting fallback (US-7)
 * - sanitizeReference: pmcid/arxivId support (US-1)
 * - parseExtractionResponse: extractionConfidence clamping
 */

import { describe, it, expect } from "vitest";
import {
  normalizeAuthor,
  sanitizeReference,
  parseExtractionResponse,
} from "../manuscript/metadata-extractor";

// ---------------------------------------------------------------------------
// normalizeAuthor -- Author name fallback (US-7)
// ---------------------------------------------------------------------------
describe("normalizeAuthor", () => {
  it("splits fullName into firstName/lastName when both are missing", () => {
    const result = normalizeAuthor({
      fullName: "John Smith",
      affiliationNumbers: [],
      isCorresponding: false,
    });

    expect(result.firstName).toBe("John");
    expect(result.lastName).toBe("Smith");
    expect(result.fullName).toBe("John Smith");
  });

  it("assigns all but the last token to firstName for multi-part names", () => {
    const result = normalizeAuthor({
      fullName: "John Michael Smith",
      affiliationNumbers: [],
      isCorresponding: false,
    });

    expect(result.firstName).toBe("John Michael");
    expect(result.lastName).toBe("Smith");
  });

  it("treats a mononymous name as lastName only", () => {
    const result = normalizeAuthor({
      fullName: "Madonna",
      affiliationNumbers: [],
      isCorresponding: false,
    });

    expect(result.firstName).toBeUndefined();
    expect(result.lastName).toBe("Madonna");
  });

  it("keeps both undefined when fullName is empty", () => {
    const result = normalizeAuthor({
      fullName: "",
      affiliationNumbers: [],
      isCorresponding: false,
    });

    expect(result.firstName).toBeUndefined();
    expect(result.lastName).toBeUndefined();
    expect(result.fullName).toBe("");
  });

  it("uses explicit firstName/lastName without fallback splitting", () => {
    const result = normalizeAuthor({
      fullName: "John Michael Smith",
      firstName: "J. Michael",
      lastName: "Smith-Jones",
      affiliationNumbers: [],
      isCorresponding: false,
    });

    expect(result.firstName).toBe("J. Michael");
    expect(result.lastName).toBe("Smith-Jones");
  });

  it("preserves other author fields alongside the fallback", () => {
    const result = normalizeAuthor({
      fullName: "Jane Doe",
      email: "jane@example.com",
      orcid: "0000-0001-2345-6789",
      affiliationNumbers: [1, 2],
      isCorresponding: true,
      equalContribution: true,
    });

    expect(result.firstName).toBe("Jane");
    expect(result.lastName).toBe("Doe");
    expect(result.email).toBe("jane@example.com");
    expect(result.orcid).toBe("0000-0001-2345-6789");
    expect(result.affiliationNumbers).toEqual([1, 2]);
    expect(result.isCorresponding).toBe(true);
    expect(result.equalContribution).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sanitizeReference -- pmcid / arxivId support (US-1)
// ---------------------------------------------------------------------------
describe("sanitizeReference", () => {
  it("stores pmcid correctly", () => {
    const result = sanitizeReference({
      number: 1,
      rawText: "Some reference text",
      pmcid: "PMC1234567",
    });

    expect(result.pmcid).toBe("PMC1234567");
  });

  it("stores arxivId correctly", () => {
    const result = sanitizeReference({
      number: 2,
      rawText: "Preprint reference",
      arxivId: "2301.12345",
    });

    expect(result.arxivId).toBe("2301.12345");
  });

  it("handles null pmcid/arxivId gracefully (returns undefined)", () => {
    const result = sanitizeReference({
      number: 3,
      rawText: "Reference without ids",
      pmcid: null,
      arxivId: null,
    });

    expect(result.pmcid).toBeUndefined();
    expect(result.arxivId).toBeUndefined();
  });

  it("handles undefined pmcid/arxivId gracefully", () => {
    const result = sanitizeReference({
      number: 4,
      rawText: "Another reference",
    });

    expect(result.pmcid).toBeUndefined();
    expect(result.arxivId).toBeUndefined();
  });

  it("sanitizes XSS attempt in pmcid", () => {
    const result = sanitizeReference({
      number: 5,
      rawText: "Malicious ref",
      pmcid: '<script>alert("xss")</script>PMC9999999',
    });

    // The script tag should be stripped by sanitizeLLMOutput
    expect(result.pmcid).not.toContain("<script>");
    expect(result.pmcid).toBeDefined();
  });

  it("sanitizes XSS attempt in arxivId", () => {
    const result = sanitizeReference({
      number: 6,
      rawText: "Malicious ref",
      arxivId: 'javascript:alert(1)//2301.00001',
    });

    // The javascript: protocol should be stripped by sanitizeLLMOutput
    expect(result.arxivId).not.toContain("javascript:");
    expect(result.arxivId).toBeDefined();
  });

  it("preserves all other reference fields alongside pmcid/arxivId", () => {
    const result = sanitizeReference({
      number: 7,
      rawText: "Full reference",
      authors: "Doe J, Smith A",
      title: "A Paper Title",
      journal: "Nature",
      year: 2024,
      volume: "42",
      issue: "3",
      pages: "100-110",
      doi: "10.1234/test",
      pmid: "12345678",
      pmcid: "PMC7654321",
      arxivId: "2301.54321",
      url: "https://example.com",
      refType: "journal",
    });

    expect(result.number).toBe(7);
    expect(result.authors).toBe("Doe J, Smith A");
    expect(result.title).toBe("A Paper Title");
    expect(result.journal).toBe("Nature");
    expect(result.year).toBe(2024);
    expect(result.doi).toBe("10.1234/test");
    expect(result.pmid).toBe("12345678");
    expect(result.pmcid).toBe("PMC7654321");
    expect(result.arxivId).toBe("2301.54321");
  });
});

// ---------------------------------------------------------------------------
// parseExtractionResponse -- extractionConfidence clamping
// ---------------------------------------------------------------------------
describe("parseExtractionResponse", () => {
  /**
   * Helper: build a minimal valid JSON response string that
   * parseExtractionResponse can consume.
   */
  function buildResponse(overrides: Record<string, unknown> = {}): string {
    const base = {
      title: "Test Title",
      abstract: "Test abstract",
      manuscriptType: "Original Research",
      keywords: ["test"],
      language: "English",
      authors: [],
      affiliations: [],
      correspondingAuthor: null,
      declarations: {},
      statistics: {},
      references: [],
      extractionConfidence: 0.85,
      extractionNotes: [],
      ...overrides,
    };
    return JSON.stringify(base);
  }

  it("keeps valid confidence (0.85) unchanged", () => {
    const result = parseExtractionResponse(buildResponse({ extractionConfidence: 0.85 }));
    expect(result.extractionConfidence).toBe(0.85);
  });

  it("clamps negative confidence to 0", () => {
    const result = parseExtractionResponse(buildResponse({ extractionConfidence: -1 }));
    expect(result.extractionConfidence).toBe(0);
  });

  it("clamps confidence above 1 down to 1", () => {
    const result = parseExtractionResponse(buildResponse({ extractionConfidence: 5 }));
    expect(result.extractionConfidence).toBe(1);
  });

  it("defaults to 0.5 when confidence is not a number", () => {
    const result = parseExtractionResponse(buildResponse({ extractionConfidence: "high" }));
    expect(result.extractionConfidence).toBe(0.5);
  });

  it("defaults to 0.5 when confidence is missing entirely", () => {
    const json = JSON.stringify({
      title: "No Confidence",
      keywords: [],
      authors: [],
      affiliations: [],
      declarations: {},
      statistics: {},
      references: [],
    });
    const result = parseExtractionResponse(json);
    expect(result.extractionConfidence).toBe(0.5);
  });

  it("handles JSON wrapped in markdown code fences", () => {
    const jsonStr = buildResponse({ extractionConfidence: 0.9 });
    const wrapped = "```json\n" + jsonStr + "\n```";
    const result = parseExtractionResponse(wrapped);
    expect(result.extractionConfidence).toBe(0.9);
    expect(result.title).toBe("Test Title");
  });

  it("returns fallback metadata when JSON is unparseable", () => {
    const result = parseExtractionResponse("this is not valid json at all");
    expect(result.extractionConfidence).toBe(0);
    expect(result.extractionNotes).toContain("Failed to parse LLM response");
    expect(result.authors).toEqual([]);
    expect(result.references).toEqual([]);
  });

  it("processes authors through normalizeAuthor within parsing", () => {
    const response = buildResponse({
      authors: [
        {
          fullName: "Alice Wonderland",
          affiliationNumbers: [1],
          isCorresponding: true,
        },
      ],
    });
    const result = parseExtractionResponse(response);

    expect(result.authors).toHaveLength(1);
    expect(result.authors[0].firstName).toBe("Alice");
    expect(result.authors[0].lastName).toBe("Wonderland");
  });

  it("processes references through sanitizeReference within parsing", () => {
    const response = buildResponse({
      references: [
        {
          number: 1,
          rawText: "A reference",
          pmcid: "PMC9876543",
          arxivId: "2310.00001",
        },
      ],
    });
    const result = parseExtractionResponse(response);

    expect(result.references).toHaveLength(1);
    expect(result.references[0].pmcid).toBe("PMC9876543");
    expect(result.references[0].arxivId).toBe("2310.00001");
  });
});
