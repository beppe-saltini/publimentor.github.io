/**
 * Tests for COI Conflict External Link Generation
 *
 * Verifies that DOI, PubMed, and Google Scholar links are correctly
 * constructed from conflict details. Tests the URL generation logic
 * used in coi-details.tsx.
 */

import { describe, it, expect } from "vitest";

// Extract the link generation logic from the component for testability
// These functions mirror the inline URL construction in coi-details.tsx

function buildDoiUrl(doi: string): string {
  return doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
}

function buildPubMedUrl(title: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(title)}`;
}

function buildGoogleScholarUrl(title: string): string {
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
}

// ============================================================
// DOI Link Generation
// ============================================================

describe("COI Links - DOI", () => {
  it("CL-001: builds DOI link from bare DOI identifier", () => {
    const url = buildDoiUrl("10.1038/nature12373");
    expect(url).toBe("https://doi.org/10.1038/nature12373");
  });

  it("CL-002: preserves DOI link that already starts with https", () => {
    const url = buildDoiUrl("https://doi.org/10.1038/nature12373");
    expect(url).toBe("https://doi.org/10.1038/nature12373");
  });

  it("CL-003: preserves DOI link with http prefix", () => {
    const url = buildDoiUrl("http://doi.org/10.1038/nature12373");
    expect(url).toBe("http://doi.org/10.1038/nature12373");
  });

  it("CL-004: handles DOI with special characters", () => {
    const url = buildDoiUrl("10.1002/(SICI)1097-0258");
    expect(url).toBe("https://doi.org/10.1002/(SICI)1097-0258");
  });
});

// ============================================================
// PubMed Link Generation
// ============================================================

describe("COI Links - PubMed", () => {
  it("CL-010: builds PubMed search URL from paper title", () => {
    const url = buildPubMedUrl("COVID-19 vaccine effectiveness");
    expect(url).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/?term=COVID-19%20vaccine%20effectiveness"
    );
  });

  it("CL-011: URL-encodes special characters in title", () => {
    const url = buildPubMedUrl("Impact of α-synuclein on Parkinson's");
    expect(url).toContain("pubmed.ncbi.nlm.nih.gov/?term=");
    expect(url).toContain(encodeURIComponent("α-synuclein"));
    expect(url).toContain(encodeURIComponent("Parkinson's"));
  });

  it("CL-012: handles empty title", () => {
    const url = buildPubMedUrl("");
    expect(url).toBe("https://pubmed.ncbi.nlm.nih.gov/?term=");
  });
});

// ============================================================
// Google Scholar Link Generation (newly added)
// ============================================================

describe("COI Links - Google Scholar", () => {
  it("CL-020: builds Google Scholar search URL from paper title", () => {
    const url = buildGoogleScholarUrl("Meta-analysis of randomized trials");
    expect(url).toBe(
      "https://scholar.google.com/scholar?q=Meta-analysis%20of%20randomized%20trials"
    );
  });

  it("CL-021: URL-encodes special characters in title", () => {
    const title = "CRISPR-Cas9: A revolutionary tool (review)";
    const url = buildGoogleScholarUrl(title);
    expect(url).toContain("scholar.google.com/scholar?q=");
    expect(url).toBe(
      `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`
    );
  });

  it("CL-022: handles title with unicode characters", () => {
    const title = "Étude de la résistance aux antimicrobiens";
    const url = buildGoogleScholarUrl(title);
    expect(url).toContain("scholar.google.com/scholar?q=");
    expect(url).toContain(encodeURIComponent("Étude"));
  });

  it("CL-023: handles very long titles", () => {
    const title = "A".repeat(500);
    const url = buildGoogleScholarUrl(title);
    expect(url.startsWith("https://scholar.google.com/scholar?q=")).toBe(true);
    expect(url.length).toBeGreaterThan(500);
  });

  it("CL-024: Google Scholar and PubMed use same title encoding", () => {
    const title = "Systematic review & meta-analysis: COVID-19";
    const scholarUrl = buildGoogleScholarUrl(title);
    const pubmedUrl = buildPubMedUrl(title);
    
    const scholarQuery = new URL(scholarUrl).searchParams.get("q");
    const pubmedQuery = new URL(pubmedUrl).searchParams.get("term");
    expect(scholarQuery).toBe(title);
    expect(pubmedQuery).toBe(title);
  });
});

// ============================================================
// Link visibility rules (which links appear for which data)
// ============================================================

describe("COI Links - Visibility Rules", () => {
  interface ConflictDetails {
    doi?: string;
    title?: string;
  }

  function getVisibleLinks(details: ConflictDetails): string[] {
    const links: string[] = [];
    if (details.doi) links.push("DOI");
    if (details.title) {
      links.push("PubMed");
      links.push("Scholar");
    }
    return links;
  }

  it("CL-030: shows all three links when DOI and title present", () => {
    const links = getVisibleLinks({
      doi: "10.1038/nature12373",
      title: "Some paper title",
    });
    expect(links).toEqual(["DOI", "PubMed", "Scholar"]);
  });

  it("CL-031: shows PubMed and Scholar when only title present (no DOI)", () => {
    const links = getVisibleLinks({ title: "Some paper title" });
    expect(links).toEqual(["PubMed", "Scholar"]);
  });

  it("CL-032: shows only DOI when title is missing", () => {
    const links = getVisibleLinks({ doi: "10.1038/nature12373" });
    expect(links).toEqual(["DOI"]);
  });

  it("CL-033: shows no links when neither DOI nor title present", () => {
    const links = getVisibleLinks({});
    expect(links).toEqual([]);
  });
});
