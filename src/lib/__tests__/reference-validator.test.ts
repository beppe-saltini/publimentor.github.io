/**
 * Test Suite: Reference Validator (Parsing Functions)
 * Tests DOI/PMID extraction and reference parsing.
 * Does NOT test async API calls (Crossref, PubMed).
 *
 * TC-IDs: RV-001 through RV-009
 */

import { describe, it, expect } from "vitest";
import { parseReferences } from "../reference-validator";

// ============================================================
// parseReferences
// ============================================================
describe("parseReferences", () => {
  it("RV-001: extracts standard DOI from reference text", () => {
    const text = `[1] Smith, J. (2024). Testing in Practice. Journal of Testing, 15(3), 42-55. 10.1234/test.2024.001`;
    const refs = parseReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].doi).toBe("10.1234/test.2024.001");
  });

  it("RV-002: extracts DOI from URL format", () => {
    const text = `[1] Doe, J. (2023). Machine Learning Review. doi.org/10.5678/mlr.2023.100`;
    const refs = parseReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].doi).toBe("10.5678/mlr.2023.100");
  });

  it("RV-003: extracts DOI with 'doi:' prefix", () => {
    const text = `[1] Wang, L. (2024). AI Testing. doi: 10.9999/ait.2024.050`;
    const refs = parseReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].doi).toBe("10.9999/ait.2024.050");
  });

  it("RV-004: extracts PMID from text", () => {
    const text = `[1] Chen, X. (2023). Biomedical Study. PMID: 12345678`;
    const refs = parseReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].pmid).toBe("12345678");
  });

  it("RV-005: extracts PMID from PubMed URL", () => {
    const text = `[1] Kim, S. (2024). Clinical Trial. pubmed.ncbi.nlm.nih.gov/98765432`;
    const refs = parseReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].pmid).toBe("98765432");
  });

  it("RV-006: parses multi-line reference block", () => {
    const text = `[1] Smith, J. (2024). First Paper. Journal A, 1(1), 1-10. 10.1234/a.001
[2] Doe, J. (2023). Second Paper. Journal B, 2(2), 20-30. 10.1234/b.002
[3] Lee, W. (2024). Third Paper. Journal C, 3(3), 30-40. PMID: 11111111`;

    const refs = parseReferences(text);
    expect(refs.length).toBe(3);
  });

  it("RV-007: skips lines shorter than 20 characters", () => {
    const text = `[1] Short line.
[2] This is a properly long reference entry that should be parsed correctly.`;
    const refs = parseReferences(text);
    expect(refs.length).toBe(1);
  });

  it("RV-008: removes leading numbers and brackets", () => {
    const text = `[1] Smith, J. (2024). This is a reference with leading bracket number.`;
    const refs = parseReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].raw).not.toMatch(/^\[1\]/);
  });

  it("handles numbered references with period format", () => {
    const text = `1. Smith, J. (2024). First Paper with period numbering format reference.`;
    const refs = parseReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  it("RV-009: references without DOI or PMID have undefined values", () => {
    const text = `[1] Generic Reference. Some Journal, without any identifiers present in text.`;
    const refs = parseReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].doi).toBeUndefined();
    expect(refs[0].pmid).toBeUndefined();
  });

  it("handles both DOI and PMID in same reference", () => {
    const text = `[1] Smith, J. (2024). Dual ID Paper. 10.1234/dual.001 PMID: 99999999`;
    const refs = parseReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].doi).toBeDefined();
    expect(refs[0].pmid).toBe("99999999");
  });

  it("handles empty input", () => {
    const refs = parseReferences("");
    expect(refs).toHaveLength(0);
  });

  it("cleans trailing punctuation from DOIs", () => {
    const text = `[1] Paper with DOI at end of sentence 10.1234/test.001.`;
    const refs = parseReferences(text);
    if (refs.length > 0 && refs[0].doi) {
      expect(refs[0].doi).not.toMatch(/\.$/);
    }
  });
});
