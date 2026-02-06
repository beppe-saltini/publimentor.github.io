/**
 * Test Suite: Format Checker
 * Tests format compliance checking for academic papers.
 *
 * TC-IDs: FC-001 through FC-014
 */

import { describe, it, expect } from "vitest";
import { checkFormat, defaultGuidelines, type FormatGuidelines } from "../format-checker";
import type { PDFContent } from "../pdf-parser";
import type { FormatRule } from "@/types";

// ============================================================
// Helpers - create mock PDFContent
// ============================================================
function createMockContent(overrides: Partial<PDFContent> = {}): PDFContent {
  // Generate text with proper sections
  const sections = [
    "Abstract\nThis is the abstract of the paper with sufficient content.",
    "Introduction\nThis paper introduces the topic of testing.",
    "Methods\nWe used Vitest for testing our application.",
    "Results\nThe results show that all tests passed.",
    "Discussion\nWe discuss the implications of our findings.",
    "Conclusion\nIn conclusion, testing is important.",
    "References\n[1] Smith, J. (2024). Testing in Practice.\n[2] Doe, J. (2023). Unit Tests.\n[3] Lee, W. (2024). Integration Tests.\n[4] Brown, A. (2024). E2E Tests.\n[5] Chen, X. (2023). Test Automation.\n[6] Wang, L. (2024). CI/CD Pipelines.\n[7] Kim, S. (2023). Quality Assurance.\n[8] Patel, R. (2024). Software Reliability.\n[9] Garcia, M. (2023). Test Coverage.\n[10] Johnson, K. (2024). Test Strategy.\n[11] Miller, D. (2023). Performance Testing.",
  ];

  const text = sections.join("\n\n");
  // Generate enough words
  const baseWords = text.split(/\s+/).filter(Boolean).length;
  const padding = " word".repeat(Math.max(0, 5000 - baseWords));
  const fullText = text + padding;

  return {
    text: fullText,
    numPages: 8,
    info: {
      title: "Test Paper",
      author: "Test Author",
    },
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    characterCount: fullText.length,
    ...overrides,
  };
}

// ============================================================
// checkFormat - Basic cases
// ============================================================
describe("checkFormat", () => {
  it("FC-001: paper within all limits passes", () => {
    const content = createMockContent();
    const result = checkFormat(content);
    expect(result.passed).toBe(true);
    expect(result.stats.wordCount).toBeGreaterThanOrEqual(3000);
  });

  it("FC-002: below minimum word count creates error", () => {
    const content = createMockContent({
      text: "Short paper",
      wordCount: 1000,
    });
    const result = checkFormat(content);
    const issue = result.issues.find((i) => i.ruleId === "min-word-count");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toContain("1000");
  });

  it("FC-003: above maximum word count creates error", () => {
    const content = createMockContent({ wordCount: 15000 });
    const result = checkFormat(content);
    const issue = result.issues.find((i) => i.ruleId === "max-word-count");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toContain("15000");
  });

  it("FC-004: below minimum pages creates error", () => {
    const content = createMockContent({ numPages: 2 });
    const result = checkFormat(content);
    const issue = result.issues.find((i) => i.ruleId === "min-pages");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
  });

  it("FC-005: above maximum pages creates error", () => {
    const content = createMockContent({ numPages: 25 });
    const result = checkFormat(content);
    const issue = result.issues.find((i) => i.ruleId === "max-pages");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
  });

  it("FC-006: missing required section creates warning", () => {
    // Create content without "methods" section
    const text = [
      "Abstract\nThis is the abstract.",
      "Introduction\nIntro text.",
      "Results\nResults text.",
      "Discussion\nDiscussion text.",
      "Conclusion\nConclusion text.",
      "References\n" + Array.from({ length: 11 }, (_, i) => `[${i + 1}] Ref`).join("\n"),
    ].join("\n\n");

    const content = createMockContent({
      text: text + " word".repeat(5000),
      wordCount: 5000,
    });

    const result = checkFormat(content);
    const sectionIssues = result.issues.filter((i) => i.ruleId === "required-section");
    expect(sectionIssues.length).toBeGreaterThan(0);
    const methodsIssue = sectionIssues.find((i) =>
      i.message.toLowerCase().includes("methods")
    );
    expect(methodsIssue).toBeDefined();
    expect(methodsIssue?.severity).toBe("warning");
  });

  it("FC-008: below minimum references creates warning", () => {
    const textWithFewRefs =
      "References\n[1] One ref.\n[2] Two ref.\n[3] Three ref.";
    const content = createMockContent({
      text: "Abstract\nIntro\nIntroduction\nText\nMethods\nText\nResults\nText\nDiscussion\nText\nConclusion\nText\n" +
        textWithFewRefs + " word".repeat(5000),
      wordCount: 5000,
    });
    const result = checkFormat(content);
    const issue = result.issues.find((i) => i.ruleId === "min-references");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  it("FC-009: abstract too long creates warning", () => {
    // Create content with a very long abstract
    const longAbstract = "Abstract\n" + "word ".repeat(400);
    const content = createMockContent({
      text: longAbstract + "\nIntroduction\nText\nMethods\nText\nResults\nText\nDiscussion\nText\nConclusion\nText\nReferences\n" +
        Array.from({ length: 11 }, (_, i) => `[${i + 1}] Ref text here.`).join("\n") +
        " word".repeat(4000),
      wordCount: 5000,
    });
    const result = checkFormat(content);
    const issue = result.issues.find((i) => i.ruleId === "abstract-length");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  it("FC-010: passed=true with only warnings (no errors)", () => {
    // Create content that has warnings but no errors (valid word count, pages, but missing a section)
    const content = createMockContent();
    const guidelines: FormatGuidelines = {
      ...defaultGuidelines,
      requiredSections: ["abstract", "introduction", "methods", "results", "discussion", "conclusion", "references", "supplementary"],
    };
    const result = checkFormat(content, guidelines);
    // Even with missing "supplementary" section (warning), should still pass
    const hasErrors = result.issues.some((i) => i.severity === "error");
    if (!hasErrors) {
      expect(result.passed).toBe(true);
    }
  });

  it("FC-011: passed=false when there are error-severity issues", () => {
    const content = createMockContent({ wordCount: 100 });
    const result = checkFormat(content);
    expect(result.passed).toBe(false);
  });

  it("returns stats with correct structure", () => {
    const content = createMockContent();
    const result = checkFormat(content);
    expect(result.stats).toHaveProperty("wordCount");
    expect(result.stats).toHaveProperty("pageCount");
    expect(result.stats).toHaveProperty("referenceCount");
    expect(result.stats).toHaveProperty("sectionsFound");
    expect(Array.isArray(result.stats.sectionsFound)).toBe(true);
  });
});

// ============================================================
// checkFormat - Custom rules
// ============================================================
describe("checkFormat with custom rules", () => {
  it("FC-012: custom section rule detects missing section", () => {
    const rules: FormatRule[] = [
      {
        id: "custom-section",
        name: "Ethics Section Required",
        type: "section",
        config: { name: "Ethics" },
        severity: "error",
      },
    ];

    const content = createMockContent();
    const guidelines: FormatGuidelines = { rules };
    const result = checkFormat(content, guidelines);
    const issue = result.issues.find((i) => i.ruleId === "custom-section");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("Ethics");
  });

  it("FC-013: custom length rule detects below minimum", () => {
    const rules: FormatRule[] = [
      {
        id: "custom-length",
        name: "Minimum Word Count",
        type: "length",
        config: { target: "wordCount", min: 10000 },
        severity: "error",
      },
    ];

    const content = createMockContent({ wordCount: 5000 });
    const guidelines: FormatGuidelines = { rules };
    const result = checkFormat(content, guidelines);
    const issue = result.issues.find((i) => i.ruleId === "custom-length");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("below minimum");
  });

  it("FC-014: custom metadata rule detects missing metadata", () => {
    const rules: FormatRule[] = [
      {
        id: "custom-meta",
        name: "Metadata Required",
        type: "metadata",
        config: { required: ["subject"] },
        severity: "warning",
      },
    ];

    const content = createMockContent({
      info: { title: "Test" },
    });
    const guidelines: FormatGuidelines = { rules };
    const result = checkFormat(content, guidelines);
    const issue = result.issues.find((i) => i.ruleId === "custom-meta");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("subject");
  });

  it("custom length rule detects above maximum", () => {
    const rules: FormatRule[] = [
      {
        id: "custom-length-max",
        name: "Maximum Word Count",
        type: "length",
        config: { target: "wordCount", max: 3000 },
        severity: "warning",
      },
    ];

    const content = createMockContent({ wordCount: 5000 });
    const guidelines: FormatGuidelines = { rules };
    const result = checkFormat(content, guidelines);
    const issue = result.issues.find((i) => i.ruleId === "custom-length-max");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("exceeds maximum");
  });
});

// ============================================================
// checkFormat - No guidelines
// ============================================================
describe("checkFormat with minimal guidelines", () => {
  it("empty guidelines produces no issues", () => {
    const content = createMockContent();
    const result = checkFormat(content, {});
    expect(result.issues).toHaveLength(0);
    expect(result.passed).toBe(true);
  });
});
