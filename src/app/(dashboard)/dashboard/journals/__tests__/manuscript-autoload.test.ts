/**
 * Tests for Manuscript Auto-Load Logic
 *
 * When a user clicks "Find Reviewers" on a manuscript page, the app navigates
 * to /dashboard/journals/[slug]/reviewers?manuscriptId=xxx. The reviewers page
 * should read this parameter, fetch manuscript data, and auto-populate:
 * - primaryKeywords (first 3 keywords)
 * - secondaryKeywords (keywords 4+)
 * - keywords (all keywords joined)
 * - authorList (all author full names, comma-separated)
 *
 * These tests verify the data transformation logic extracted from the useEffect.
 */

import { describe, it, expect } from "vitest";

// ============================================================
// Extract the pure transformation logic from the useEffect
// for testability without rendering React components
// ============================================================

interface ManuscriptData {
  title?: string;
  fileName?: string;
  keywords?: string[];
  authors?: Array<{ fullName: string }>;
}

interface AutoLoadResult {
  selectedManuscriptId: string;
  primaryKeywords: string;
  secondaryKeywords: string;
  keywords: string;
  authorList: string;
  toastMessage: string;
}

function computeAutoLoadState(
  manuscriptId: string,
  manuscript: ManuscriptData
): AutoLoadResult {
  let primaryKeywords = "";
  let secondaryKeywords = "";
  let keywords = "";
  let authorList = "";

  if (manuscript.keywords && manuscript.keywords.length > 0) {
    primaryKeywords = manuscript.keywords.slice(0, 3).join(", ");
    if (manuscript.keywords.length > 3) {
      secondaryKeywords = manuscript.keywords.slice(3).join(", ");
    }
    keywords = manuscript.keywords.join(", ");
  }

  if (manuscript.authors && manuscript.authors.length > 0) {
    authorList = manuscript.authors
      .map((a) => a.fullName)
      .join(", ");
  }

  const toastMessage =
    `Loaded manuscript: ${manuscript.title || manuscript.fileName}` +
    (manuscript.keywords?.length
      ? ` (${manuscript.keywords.length} keywords, ${manuscript.authors?.length || 0} authors)`
      : "");

  return {
    selectedManuscriptId: manuscriptId,
    primaryKeywords,
    secondaryKeywords,
    keywords,
    authorList,
    toastMessage,
  };
}

// ============================================================
// Tests
// ============================================================

describe("Manuscript Auto-Load - Query Parameter Handling", () => {
  it("MA-001: sets selectedManuscriptId from URL parameter", () => {
    const result = computeAutoLoadState("ms-abc-123", {
      title: "Test",
      keywords: [],
      authors: [],
    });
    expect(result.selectedManuscriptId).toBe("ms-abc-123");
  });

  it("MA-002: splits keywords into primary (first 3) and secondary (rest)", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Test",
      keywords: ["COVID-19", "epidemiology", "vaccine", "mRNA", "clinical trial"],
      authors: [],
    });
    expect(result.primaryKeywords).toBe("COVID-19, epidemiology, vaccine");
    expect(result.secondaryKeywords).toBe("mRNA, clinical trial");
  });

  it("MA-003: all keywords go to primary when 3 or fewer", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Test",
      keywords: ["biology", "genetics"],
      authors: [],
    });
    expect(result.primaryKeywords).toBe("biology, genetics");
    expect(result.secondaryKeywords).toBe("");
  });

  it("MA-004: joins all keywords into single comma-separated string", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Test",
      keywords: ["a", "b", "c", "d"],
      authors: [],
    });
    expect(result.keywords).toBe("a, b, c, d");
  });

  it("MA-005: builds author list from fullName fields", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Test",
      keywords: [],
      authors: [
        { fullName: "Jane Smith" },
        { fullName: "John Doe" },
        { fullName: "Maria Garcia" },
      ],
    });
    expect(result.authorList).toBe("Jane Smith, John Doe, Maria Garcia");
  });

  it("MA-006: handles empty keywords array", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Test",
      keywords: [],
      authors: [],
    });
    expect(result.primaryKeywords).toBe("");
    expect(result.secondaryKeywords).toBe("");
    expect(result.keywords).toBe("");
  });

  it("MA-007: handles undefined keywords", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Test",
      authors: [],
    });
    expect(result.primaryKeywords).toBe("");
    expect(result.keywords).toBe("");
  });

  it("MA-008: handles empty authors array", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Test",
      keywords: ["a"],
      authors: [],
    });
    expect(result.authorList).toBe("");
  });

  it("MA-009: handles single keyword", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Test",
      keywords: ["oncology"],
      authors: [],
    });
    expect(result.primaryKeywords).toBe("oncology");
    expect(result.secondaryKeywords).toBe("");
    expect(result.keywords).toBe("oncology");
  });

  it("MA-010: handles exactly 3 keywords (boundary)", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Test",
      keywords: ["one", "two", "three"],
      authors: [],
    });
    expect(result.primaryKeywords).toBe("one, two, three");
    expect(result.secondaryKeywords).toBe("");
  });

  it("MA-011: handles exactly 4 keywords (boundary)", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Test",
      keywords: ["one", "two", "three", "four"],
      authors: [],
    });
    expect(result.primaryKeywords).toBe("one, two, three");
    expect(result.secondaryKeywords).toBe("four");
  });

  it("MA-012: single author produces no trailing comma", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Test",
      keywords: [],
      authors: [{ fullName: "Solo Author" }],
    });
    expect(result.authorList).toBe("Solo Author");
    expect(result.authorList).not.toContain(",");
  });
});

describe("Manuscript Auto-Load - Toast Messages", () => {
  it("MA-020: toast shows title and keyword/author counts", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "My Great Paper",
      keywords: ["a", "b"],
      authors: [{ fullName: "Jane" }, { fullName: "John" }],
    });
    expect(result.toastMessage).toBe(
      "Loaded manuscript: My Great Paper (2 keywords, 2 authors)"
    );
  });

  it("MA-021: toast uses fileName when title is missing", () => {
    const result = computeAutoLoadState("ms-1", {
      fileName: "paper-v3.pdf",
      keywords: ["x"],
      authors: [{ fullName: "A" }],
    });
    expect(result.toastMessage).toBe(
      "Loaded manuscript: paper-v3.pdf (1 keywords, 1 authors)"
    );
  });

  it("MA-022: toast omits counts when no keywords", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "No Keywords Paper",
      keywords: [],
      authors: [],
    });
    expect(result.toastMessage).toBe("Loaded manuscript: No Keywords Paper");
    expect(result.toastMessage).not.toContain("keywords");
  });

  it("MA-023: toast handles undefined keywords", () => {
    const result = computeAutoLoadState("ms-1", {
      title: "Bare Paper",
    });
    expect(result.toastMessage).toBe("Loaded manuscript: Bare Paper");
  });
});
