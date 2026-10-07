import { describe, it, expect, vi, afterEach } from "vitest";
import { aggregateTopicAuthors, buildTopicSearchQuery, openAlex } from "../openalex";
import type { OpenAlexWork } from "@/types";

const work = (id: string, cites: number, authors: Array<[string, string, "first" | "middle" | "last", boolean?]>): OpenAlexWork => ({
  id, title: `Paper ${id}`, publication_year: 2025, cited_by_count: cites,
  primary_location: { source: { display_name: "Journal X" } },
  authorships: authors.map(([aid, name, pos, corr]) => ({
    author_position: pos, is_corresponding: corr, author: { id: aid, display_name: name },
    institutions: [{ id: "I1", display_name: "Uni A" }],
  })),
});

describe("buildTopicSearchQuery", () => {
  it("quotes phrases and joins with the operator", () => {
    expect(buildTopicSearchQuery(["CRISPR/CAS", "lung cancer"], undefined, "AND")).toBe('CRISPR/CAS AND "lung cancer"');
    expect(buildTopicSearchQuery(["CRISPR", "lung"], ["genetic modification"], "OR")).toBe('(CRISPR OR lung) OR "genetic modification"');
    expect(buildTopicSearchQuery(["CRISPR"], ["editing"])).toBe("CRISPR OR editing");
  });
});

describe("aggregateTopicAuthors", () => {
  it("counts works and author positions per author", () => {
    const works = [
      work("W1", 100, [["A1", "Ann Lee", "first"], ["A2", "Bo Chen", "last", true]]),
      work("W2", 50, [["A2", "Bo Chen", "first"], ["A3", "Cy Dax", "last"]]),
      work("W3", 10, [["A2", "Bo Chen", "middle"]]),
    ];
    const agg = aggregateTopicAuthors(works);
    const bo = agg.get("A2")!;
    expect(bo.worksInTopic).toBe(3);
    expect(bo.firstAuthorCount).toBe(1);
    expect(bo.lastAuthorCount).toBe(1);
    expect(bo.correspondingCount).toBe(1);
    expect(bo.topicCitations).toBe(160);
    expect(bo.recentWorks.map((w) => w.position)).toEqual(["last", "first", "middle"]);
    expect(agg.get("A1")!.institution?.display_name).toBe("Uni A");
  });
});

describe("openAlex.discoverReviewers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("searches works by topic, aggregates authors and hydrates them", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/works?")) {
        return new Response(JSON.stringify({ meta: {}, results: [
          work("W1", 100, [["https://openalex.org/A1", "Ann Lee", "first"], ["https://openalex.org/A2", "Bo Chen", "last", true]]),
          work("W2", 50, [["https://openalex.org/A2", "Bo Chen", "last"], ["https://openalex.org/A3", "Cy Dax", "middle"]]),
          work("W3", 10, [["https://openalex.org/A2", "Bo Chen", "first"], ["https://openalex.org/A4", "Excluded Person", "last"]]),
        ] }));
      }
      return new Response(JSON.stringify({ meta: {}, results: [
        { id: "https://openalex.org/A2", display_name: "Bo Chen", works_count: 120, cited_by_count: 5000, summary_stats: { h_index: 40, i10_index: 80 }, last_known_institutions: [{ id: "I1", display_name: "Uni A", country_code: "US" }] },
        { id: "https://openalex.org/A1", display_name: "Ann Lee", works_count: 20, cited_by_count: 300, summary_stats: { h_index: 8, i10_index: 10 }, last_known_institutions: [] },
      ] }));
    }));

    const result = await openAlex.discoverReviewers({
      primaryKeywords: ["CRISPR", "lung cancer"], keywordOperator: "AND", minWorksCount: 1,
      minHIndex: 10, requireCorresponding: true, excludeNames: ["Excluded Person"], maxResults: 10,
    });

    expect(decodeURIComponent(calls[0].replace(/\+/g, " "))).toContain('search=CRISPR AND "lung cancer"');
    expect(calls[0]).toContain("/works?");
    expect(calls.some((u) => u.includes("/authors?") && decodeURIComponent(u).includes("ids.openalex:A2|"))).toBe(true);
    expect(result.authors.map((a) => a.display_name)).toEqual(["Bo Chen"]); // Ann Lee fails h-index; Excluded Person removed
    const stats = result.stats.get("https://openalex.org/A2")!;
    expect(stats.worksInTopic).toBe(3);
    expect(stats.firstAuthorCount + stats.lastAuthorCount).toBe(3);
  });
});
