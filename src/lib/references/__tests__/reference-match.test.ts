import { describe, it, expect } from "vitest";
import {
  normalizeTitle,
  titleSimilarity,
  extractAuthorSurnames,
  authorSimilarity,
  yearSimilarity,
  scoreCandidate,
  pickBestMatches,
  classifyReference,
  THRESHOLDS,
} from "../reference-match";
import type { CandidateWork } from "../reference-match";

describe("reference-match", () => {
  describe("normalizeTitle", () => {
    it("lowercases and strips punctuation", () => {
      expect(normalizeTitle("BERT: Pre-training of Deep Models")).toBe(
        "bert pre training of deep models"
      );
    });
  });

  describe("titleSimilarity", () => {
    it("scores identical titles highly", () => {
      const a = "Attention Is All You Need";
      expect(titleSimilarity(a, a)).toBeGreaterThan(0.9);
    });

    it("handles hyphenation variants", () => {
      const score = titleSimilarity(
        "Pre-trained Language Models",
        "Pre trained Language Models"
      );
      expect(score).toBeGreaterThan(0.5);
    });

    it("scores unrelated titles low", () => {
      expect(
        titleSimilarity(
          "Deep learning for image recognition",
          "Climate change in the arctic"
        )
      ).toBeLessThan(0.3);
    });
  });

  describe("extractAuthorSurnames", () => {
    it("parses comma format", () => {
      expect(extractAuthorSurnames("Smith, J., Doe, A.")).toContain("smith");
      expect(extractAuthorSurnames("Smith, J., Doe, A.")).toContain("doe");
    });

    it("parses 'and' separated authors", () => {
      const names = extractAuthorSurnames("Smith J and Doe A");
      expect(names.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("authorSimilarity", () => {
    it("returns 1 when no cited authors", () => {
      expect(authorSimilarity("", ["Alice Smith"])).toBe(1);
    });

    it("scores overlapping surnames", () => {
      const score = authorSimilarity("Smith, J.", ["John Smith", "Jane Doe"]);
      expect(score).toBe(1);
    });
  });

  describe("yearSimilarity", () => {
    it("exact year match", () => {
      expect(yearSimilarity(2020, 2020)).toBe(1);
    });

    it("±1 year tolerance", () => {
      expect(yearSimilarity(2020, 2021)).toBe(0.8);
    });

    it("large gap scores zero", () => {
      expect(yearSimilarity(2020, 2010)).toBe(0);
    });
  });

  describe("scoreCandidate and pickBestMatches", () => {
    const parsed = {
      title: "Attention Is All You Need",
      authors: "Vaswani, A.",
      year: 2017,
    };

    const candidates: CandidateWork[] = [
      {
        title: "Attention is all you need",
        authors: ["Ashish Vaswani", "Noam Shazeer"],
        year: 2017,
        source: "openalex",
      },
      {
        title: "Completely unrelated paper",
        authors: ["Someone Else"],
        year: 1999,
        source: "crossref",
      },
    ];

    it("picks the best matching candidate", () => {
      const { best } = pickBestMatches(parsed, candidates);
      expect(best?.candidate.title.toLowerCase()).toContain("attention");
      expect(best!.compositeScore).toBeGreaterThan(0.7);
    });
  });

  describe("classifyReference", () => {
    const parsed = { title: "Test Paper", authors: "Smith", year: 2020 };

    it("classifies high-confidence matches as validated", () => {
      const best = scoreCandidate(parsed, {
        title: "Test Paper",
        authors: ["John Smith"],
        year: 2020,
        source: "openalex",
      });
      expect(
        classifyReference({
          parsed,
          best,
          runnerUp: null,
          sourcesReached: 2,
          sourcesQueried: 3,
          isRetracted: false,
          doiTitleMismatch: false,
          hasParseableTitle: true,
          apiErrors: [],
        })
      ).toBe("validated");
    });

    it("classifies retracted as fake", () => {
      expect(
        classifyReference({
          parsed,
          best: null,
          runnerUp: null,
          sourcesReached: 0,
          sourcesQueried: 3,
          isRetracted: true,
          doiTitleMismatch: false,
          hasParseableTitle: true,
          apiErrors: [],
        })
      ).toBe("fake");
    });

    it("classifies no title as unsure", () => {
      expect(
        classifyReference({
          parsed: {},
          best: null,
          runnerUp: null,
          sourcesReached: 0,
          sourcesQueried: 0,
          isRetracted: false,
          doiTitleMismatch: false,
          hasParseableTitle: false,
          apiErrors: [],
        })
      ).toBe("unsure");
    });

    it("classifies low scores with multiple sources as fake", () => {
      const weak = scoreCandidate(parsed, {
        title: "Unrelated",
        authors: ["X"],
        year: 1990,
        source: "pubmed",
      });
      weak.compositeScore = 0.2;
      expect(
        classifyReference({
          parsed,
          best: weak,
          runnerUp: null,
          sourcesReached: 2,
          sourcesQueried: 3,
          isRetracted: false,
          doiTitleMismatch: false,
          hasParseableTitle: true,
          apiErrors: [],
        })
      ).toBe("fake");
    });

    it("uses THRESHOLDS constants", () => {
      expect(THRESHOLDS.validatedComposite).toBe(0.85);
      expect(THRESHOLDS.fakeComposite).toBe(0.45);
    });
  });
});
