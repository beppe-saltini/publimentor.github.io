import { describe, it, expect } from "vitest";
import { matchRankedReviewers, normalizeReviewerName } from "../llm";

const ranked = (candidateNumber: number, name: string, relevanceScore: number) => ({
  candidateNumber, name, relevanceScore, reasoning: "", topicalMatch: "good" as const,
  seniorityAssessment: "", recommendation: "recommended" as const,
});

describe("normalizeReviewerName", () => {
  it("keeps first name and surname, drops initials and punctuation", () => {
    expect(normalizeReviewerName("Jennifer A. Doudna")).toBe("jennifer doudna");
    expect(normalizeReviewerName("Tony S.K. Mok")).toBe("tony mok");
    expect(normalizeReviewerName("Doudna")).toBe("doudna");
  });
});

describe("matchRankedReviewers", () => {
  const candidates = [{ name: "Jennifer A. Doudna" }, { name: "Feng Zhang" }, { name: "Tony S.K. Mok" }];

  it("matches by candidate number first", () => {
    const m = matchRankedReviewers(candidates, [ranked(2, "F. Zhang", 80), ranked(1, "J. Doudna", 70)]);
    expect(m.get(candidates[0])?.relevanceScore).toBe(70);
    expect(m.get(candidates[1])?.relevanceScore).toBe(80);
    expect(m.has(candidates[2])).toBe(false);
  });

  it("falls back to exact and then loose name matching when numbers are missing", () => {
    const m = matchRankedReviewers(candidates, [ranked(0, "feng zhang", 65), ranked(0, "Tony Mok", 55)]);
    expect(m.get(candidates[1])?.relevanceScore).toBe(65);
    expect(m.get(candidates[2])?.relevanceScore).toBe(55);
  });
});
