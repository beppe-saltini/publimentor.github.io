import { describe, it, expect, beforeEach } from "vitest";
import {
  parseReferenceFields,
  mergeParsedFields,
  validateReferenceByMetadata,
} from "../reference-metadata-validator";
import { vi } from "vitest";
import type { CandidateWork } from "../reference-match";

vi.mock("../reference-retrieval", () => ({
  retrieveCandidates: vi.fn(),
  resolveDoiMetadata: vi.fn().mockResolvedValue({ valid: false }),
  checkDoiRetracted: vi.fn().mockResolvedValue({ isRetracted: false }),
  checkDoiTitleMismatch: vi.fn().mockReturnValue(false),
}));

import { retrieveCandidates } from "../reference-retrieval";

const mockRetrieve = vi.mocked(retrieveCandidates);

function mockCandidates(candidates: CandidateWork[]) {
  mockRetrieve.mockResolvedValueOnce({
    candidates,
    sourcesQueried: ["openalex", "crossref", "pubmed"],
    sourcesReached: candidates.length > 0 ? 2 : 0,
    errors: [],
  });
}

describe("parseReferenceFields", () => {
  it("extracts year from raw text", () => {
    const fields = parseReferenceFields("Smith J (2023). Some long reference text here.");
    expect(fields.year).toBe(2023);
  });

  it("extracts quoted title", () => {
    const fields = parseReferenceFields(
      'Smith J. "Deep Learning for Testing" Journal 2024.'
    );
    expect(fields.title).toContain("Deep Learning");
  });
});

describe("mergeParsedFields", () => {
  it("prefers structured input over parsed raw", () => {
    const merged = mergeParsedFields({
      raw: "misc text 2019",
      title: "Structured Title",
      year: 2020,
    });
    expect(merged.title).toBe("Structured Title");
    expect(merged.year).toBe(2020);
  });
});

describe("validateReferenceByMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies strong match as validated", async () => {
    mockCandidates([
      {
        title: "Attention Is All You Need",
        authors: ["Ashish Vaswani"],
        year: 2017,
        source: "openalex",
      },
      {
        title: "Attention Is All You Need",
        authors: ["Ashish Vaswani"],
        year: 2017,
        source: "crossref",
      },
    ]);

    const result = await validateReferenceByMetadata({
      raw: "Vaswani et al. Attention Is All You Need. 2017.",
      title: "Attention Is All You Need",
      authors: "Vaswani, A.",
      year: 2017,
    });

    expect(result.classification).toBe("validated");
    expect(result.bestMatch).toBeDefined();
  });

  it("classifies no candidates from multiple sources as fake", async () => {
    mockRetrieve.mockResolvedValueOnce({
      candidates: [],
      sourcesQueried: ["openalex", "crossref", "pubmed"],
      sourcesReached: 0,
      errors: [],
    });

    const result = await validateReferenceByMetadata({
      raw: "Fake Author. Totally Invented Paper Title XYZ. 2099.",
      title: "Totally Invented Paper Title XYZ",
      authors: "Fake Author",
      year: 2099,
    });

    expect(result.classification).toBe("fake");
  });

  it("classifies partial match as unsure", async () => {
    mockCandidates([
      {
        title: "Something vaguely related but different",
        authors: ["Other Person"],
        year: 2015,
        source: "openalex",
      },
    ]);

    const result = await validateReferenceByMetadata({
      raw: "Smith. Neural Networks for Everything. 2020.",
      title: "Neural Networks for Image Classification",
      authors: "Smith, J.",
      year: 2020,
    });

    expect(["unsure", "fake"]).toContain(result.classification);
  });

  it("returns unsure when title cannot be parsed", async () => {
    const result = await validateReferenceByMetadata({
      raw: "short",
    });

    expect(result.classification).toBe("unsure");
    expect(mockRetrieve).not.toHaveBeenCalled();
  });
});
