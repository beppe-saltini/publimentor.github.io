import { describe, it, expect } from "vitest";
import {
  buildDeceasedQuery,
  buildPubMedQuery,
  evaluateDeceasedEvidence,
  evaluatePubMedTitles,
  evaluateWikidataEntities,
  parseClaudeVerdict,
} from "../deceased-check";
import { parseDuckDuckGoHtml, googleSearchUrl } from "../web-search";
import { reviewerDisplaySortRank } from "../reviewer-list-utils";

const person = { name: "Jane Q. Example", firstName: "Jane", lastName: "Example" };
const now = new Date("2026-10-07T00:00:00Z");

describe("deceased-check queries", () => {
  it("builds the web and PubMed queries and a matching Google link", () => {
    const q = buildDeceasedQuery("Jane Example");
    expect(q).toBe('"Jane Example" (obituary OR "passed away" OR "in memoriam" OR died)');
    expect(googleSearchUrl(q)).toBe(`https://www.google.com/search?q=${encodeURIComponent(q)}`);
    expect(buildPubMedQuery("Jane Example")).toBe(
      '"Jane Example"[Title] AND (obituary[pt] OR biography[pt] OR "historical article"[pt])'
    );
  });
});

describe("PubMed layer", () => {
  it("accepts a memorial title with a life span or a death term", () => {
    const ev = evaluatePubMedTitles(
      [
        { pmid: "1", title: "Jane Example (1950–2025).", pubdate: "2025 Jun" },
        { pmid: "2", title: "In memoriam: Professor Jane Example", pubdate: "2025" },
        { pmid: "3", title: "Jane Example: a conversation about her career" },
        { pmid: "4", title: "Obituary: John Example (1940-2020)" },
      ],
      person
    );
    expect(ev.map((e) => e.url)).toEqual(["https://pubmed.ncbi.nlm.nih.gov/1/", "https://pubmed.ncbi.nlm.nih.gov/2/"]);
  });
});

describe("Wikidata layer", () => {
  const base = { id: "Q1", label: "Jane Example", description: "American biologist", isHuman: true };

  it("flags a recently deceased academic namesake", () => {
    const ev = evaluateWikidataEntities([{ ...base, dateOfDeath: "2024-03-02" }], person, now);
    expect(ev).toHaveLength(1);
    expect(ev[0].url).toBe("https://www.wikidata.org/wiki/Q1");
  });

  it("ignores historical namesakes, non-humans, the living, and non-academics", () => {
    expect(evaluateWikidataEntities([{ ...base, dateOfDeath: "1888-01-01" }], person, now)).toHaveLength(0);
    expect(evaluateWikidataEntities([{ ...base, isHuman: false, dateOfDeath: "2024-01-01" }], person, now)).toHaveLength(0);
    expect(evaluateWikidataEntities([{ ...base }], person, now)).toHaveLength(0);
    expect(
      evaluateWikidataEntities([{ ...base, description: "Scottish footballer", dateOfDeath: "2024-01-01" }], person, now)
    ).toHaveLength(0);
  });

  it("accepts a non-academic description when the ORCID matches", () => {
    const ev = evaluateWikidataEntities(
      [{ ...base, description: "", dateOfDeath: "2023-05-05", orcid: "0000-0001-2345-6789" }],
      { ...person, orcid: "https://orcid.org/0000-0001-2345-6789" },
      now
    );
    expect(ev).toHaveLength(1);
  });
});

describe("web search layer", () => {
  it("flags on one result whose title has the name and a death term", () => {
    const r = evaluateDeceasedEvidence(
      [{ title: "Obituary: Professor Jane Example, 1950-2025", url: "https://example.edu/news", snippet: "The department mourns." }],
      person
    );
    expect(r.possiblyDeceased).toBe(true);
  });

  it("needs two weaker results when the death term is only in snippets", () => {
    const hit = (url: string) => ({ title: "Department news", url, snippet: "We are sad to report that Jane Example passed away last week." });
    expect(evaluateDeceasedEvidence([hit("https://a.edu")], person).possiblyDeceased).toBe(false);
    expect(evaluateDeceasedEvidence([hit("https://a.edu"), hit("https://b.edu")], person).possiblyDeceased).toBe(true);
  });

  it("ignores death terms about other people and lab-page phrasing", () => {
    const r = evaluateDeceasedEvidence(
      [
        { title: "Obituary: John Example", url: "https://x.org/1", snippet: "A life in music." },
        { title: "Jane Example lab page", url: "https://x.org/2", snippet: "Cells died after treatment." },
      ],
      person
    );
    expect(r.possiblyDeceased).toBe(false);
    expect(r.evidence).toHaveLength(0);
  });
});

describe("Claude layer", () => {
  it("parses a JSON verdict and only flags confident yes answers", () => {
    const yes = parseClaudeVerdict('Here is my answer:\n```json\n{"deceased": true, "confidence": "high", "evidence": [{"title": "Obituary", "url": "https://u.edu/obit", "snippet": "died in 2025"}]}\n```');
    expect(yes?.possiblyDeceased).toBe(true);
    expect(yes?.evidence).toHaveLength(1);
    expect(parseClaudeVerdict('{"deceased": true, "confidence": "low", "evidence": []}')?.possiblyDeceased).toBe(false);
    expect(parseClaudeVerdict('{"deceased": "unknown", "confidence": "high", "evidence": []}')?.possiblyDeceased).toBe(false);
    expect(parseClaudeVerdict("no json here")).toBeNull();
  });
});

describe("display order", () => {
  it("sorts possibly deceased reviewers after integrity concerns", () => {
    const base = { id: "1", name: "A" };
    const opts: [Record<string, string[]>, Record<string, "up" | "down" | null>, Record<string, { id: string; status: string }>] = [{}, {}, {}];
    expect(reviewerDisplaySortRank(base, ...opts)).toBe(3);
    expect(reviewerDisplaySortRank({ ...base, reputationSummary: { hasConcerns: true } }, ...opts)).toBe(4);
    expect(
      reviewerDisplaySortRank({ ...base, reputationSummary: { hasConcerns: true, deceased: { possiblyDeceased: true } } }, ...opts)
    ).toBe(5);
  });
});

describe("web-search DuckDuckGo parser", () => {
  it("extracts title, target url and snippet", () => {
    const html = `
      <div class="result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.edu%2Fobit&amp;rut=1">Obituary: <b>Jane Example</b></a></h2>
      <a class="result__snippet" href="#">She passed away peacefully.</a></div>`;
    expect(parseDuckDuckGoHtml(html, 5)).toEqual([
      { title: "Obituary: Jane Example", url: "https://example.edu/obit", snippet: "She passed away peacefully." },
    ]);
  });
});
