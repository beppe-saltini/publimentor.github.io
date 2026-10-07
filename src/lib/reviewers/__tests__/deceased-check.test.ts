import { describe, it, expect } from "vitest";
import { buildDeceasedQuery, evaluateDeceasedEvidence } from "../deceased-check";
import { parseDuckDuckGoHtml, googleSearchUrl } from "../web-search";
import { reviewerDisplaySortRank } from "../reviewer-list-utils";

const person = { name: "Jane Q. Example", firstName: "Jane", lastName: "Example" };

describe("deceased-check", () => {
  it("builds a quoted obituary query and a matching Google link", () => {
    const q = buildDeceasedQuery("Jane Example");
    expect(q).toBe('"Jane Example" (obituary OR "passed away" OR "in memoriam" OR died)');
    expect(googleSearchUrl(q)).toBe(`https://www.google.com/search?q=${encodeURIComponent(q)}`);
  });

  it("flags on one result whose title has the name and a death term", () => {
    const r = evaluateDeceasedEvidence(
      [
        {
          title: "Obituary: Professor Jane Example, 1950-2025",
          url: "https://example.edu/news/jane-example",
          snippet: "The department mourns the loss of a colleague.",
        },
      ],
      person
    );
    expect(r.possiblyDeceased).toBe(true);
    expect(r.evidence).toHaveLength(1);
  });

  it("needs two weaker results when the death term is only in snippets", () => {
    const hit = (url: string) => ({
      title: "Department news",
      url,
      snippet: "We are sad to report that Jane Example passed away last week.",
    });
    expect(evaluateDeceasedEvidence([hit("https://a.edu")], person).possiblyDeceased).toBe(false);
    expect(
      evaluateDeceasedEvidence([hit("https://a.edu"), hit("https://b.edu")], person).possiblyDeceased
    ).toBe(true);
  });

  it("ignores death terms about other people and surname-only matches", () => {
    const r = evaluateDeceasedEvidence(
      [
        { title: "Obituary: John Example", url: "https://x.org/1", snippet: "A life in music." },
        { title: "Jane Example lab page", url: "https://x.org/2", snippet: "Cells died after treatment." },
        { title: "Example obituary archive", url: "https://x.org/3", snippet: "Obituaries by surname." },
      ],
      person
    );
    expect(r.possiblyDeceased).toBe(false);
    expect(r.evidence).toHaveLength(0);
  });

  it("sorts possibly deceased reviewers after integrity concerns", () => {
    const base = { id: "1", name: "A" };
    const opts: [Record<string, string[]>, Record<string, "up" | "down" | null>, Record<string, { id: string; status: string }>] = [{}, {}, {}];
    expect(reviewerDisplaySortRank(base, ...opts)).toBe(3);
    expect(reviewerDisplaySortRank({ ...base, reputationSummary: { hasConcerns: true } }, ...opts)).toBe(4);
    expect(
      reviewerDisplaySortRank(
        { ...base, reputationSummary: { hasConcerns: true, deceased: { possiblyDeceased: true } } },
        ...opts
      )
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
