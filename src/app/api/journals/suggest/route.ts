import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { suggestJournalsWithLLM } from "@/lib/llm";
import { openAlex, type OpenAlexSourceResult } from "@/lib/openalex";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export interface JournalSuggestion {
  id: string;
  name: string;
  publisher: string;
  reasoning: string;
  topicalMatch: "excellent" | "good" | "moderate" | "unknown";
  impactFactor: number | null;
  hIndex: number | null;
  isOpenAccess: boolean;
  isInDoaj: boolean;
  apcUsd: number | null;
  worksCount: number;
  homepageUrl: string | null;
  issnL: string | null;
  countryCode: string | null;
  source: "llm" | "openalex" | "both";
  verified: boolean;
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * POST /api/journals/suggest
 * Suggest journals for a manuscript based on its abstract and keywords.
 * Combines Claude LLM suggestions with OpenAlex source search.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { abstract, keywords, manuscriptType } = body;

    if (!abstract || typeof abstract !== "string" || abstract.trim().length < 20) {
      return NextResponse.json(
        { error: "Abstract is required (minimum 20 characters)" },
        { status: 400 }
      );
    }

    const keywordList: string[] = Array.isArray(keywords) ? keywords : [];

    console.log(`[JournalSuggest] Starting for ${keywordList.length} keywords, abstract length ${abstract.length}`);

    // Step 1: Run LLM suggestion and OpenAlex keyword searches in parallel
    const searchTerms = keywordList.length > 0
      ? keywordList.slice(0, 5)
      : abstract.split(/\s+/).slice(0, 8).join(" ").split(",").slice(0, 3);

    const [llmResult, ...oaResults] = await Promise.all([
      suggestJournalsWithLLM(abstract, keywordList, manuscriptType),
      ...searchTerms.map(async (term, i) => {
        await delay(i * 150);
        return openAlex.searchSources(term.trim(), 10);
      }),
    ]);

    // Step 2: Collect and deduplicate OpenAlex results
    const oaByName = new Map<string, OpenAlexSourceResult>();
    for (const results of oaResults) {
      for (const source of results) {
        const key = source.display_name.toLowerCase().trim();
        if (!oaByName.has(key)) {
          oaByName.set(key, source);
        }
      }
    }

    console.log(`[JournalSuggest] LLM suggested ${llmResult?.journals.length || 0} journals, OpenAlex found ${oaByName.size} unique sources`);

    // Step 3: Verify LLM suggestions against OpenAlex
    const suggestions: JournalSuggestion[] = [];
    const usedNames = new Set<string>();

    if (llmResult) {
      for (const llmJournal of llmResult.journals) {
        const nameKey = llmJournal.name.toLowerCase().trim();
        if (usedNames.has(nameKey)) continue;
        usedNames.add(nameKey);

        // Check if we already have this from keyword search
        let oaSource = oaByName.get(nameKey) || null;

        // If not found by exact key, try a lookup by name
        if (!oaSource) {
          try {
            oaSource = await openAlex.findSourceByName(llmJournal.name);
            await delay(100);
          } catch {
            // continue without verification
          }
        }

        if (oaSource) {
          suggestions.push({
            id: oaSource.id,
            name: oaSource.display_name,
            publisher: oaSource.publisher || llmJournal.publisher,
            reasoning: llmJournal.reasoning,
            topicalMatch: llmJournal.topicalMatch,
            impactFactor: oaSource.impact_factor,
            hIndex: oaSource.h_index,
            isOpenAccess: oaSource.is_oa,
            isInDoaj: oaSource.is_in_doaj,
            apcUsd: oaSource.apc_usd ?? null,
            worksCount: oaSource.works_count,
            homepageUrl: oaSource.homepage_url || null,
            issnL: oaSource.issn_l,
            countryCode: oaSource.country_code,
            source: "both",
            verified: true,
          });
        } else {
          // LLM-only suggestion (not verified)
          suggestions.push({
            id: `llm_${nameKey.replace(/\s+/g, "_")}`,
            name: llmJournal.name,
            publisher: llmJournal.publisher,
            reasoning: llmJournal.reasoning,
            topicalMatch: llmJournal.topicalMatch,
            impactFactor: llmJournal.estimatedImpactFactor ?? null,
            hIndex: null,
            isOpenAccess: llmJournal.isOpenAccess,
            isInDoaj: false,
            apcUsd: null,
            worksCount: 0,
            homepageUrl: null,
            issnL: null,
            countryCode: null,
            source: "llm",
            verified: false,
          });
        }
      }
    }

    // Step 4: Add OpenAlex-only results not already covered by LLM
    for (const [nameKey, oaSource] of oaByName) {
      if (usedNames.has(nameKey)) continue;
      // Only include journals with meaningful activity
      if (oaSource.works_count < 50) continue;
      usedNames.add(nameKey);

      suggestions.push({
        id: oaSource.id,
        name: oaSource.display_name,
        publisher: oaSource.publisher,
        reasoning: "",
        topicalMatch: "unknown",
        impactFactor: oaSource.impact_factor,
        hIndex: oaSource.h_index,
        isOpenAccess: oaSource.is_oa,
        isInDoaj: oaSource.is_in_doaj,
        apcUsd: oaSource.apc_usd ?? null,
        worksCount: oaSource.works_count,
        homepageUrl: oaSource.homepage_url || null,
        issnL: oaSource.issn_l,
        countryCode: oaSource.country_code,
        source: "openalex",
        verified: true,
      });
    }

    // Step 5: Sort — LLM-verified first (by match quality), then OA-only (by impact)
    const matchOrder = { excellent: 0, good: 1, moderate: 2, unknown: 3 };
    suggestions.sort((a, b) => {
      // Verified LLM suggestions first
      if (a.source === "both" && b.source !== "both") return -1;
      if (a.source !== "both" && b.source === "both") return 1;
      // Then by topical match
      const matchDiff = matchOrder[a.topicalMatch] - matchOrder[b.topicalMatch];
      if (matchDiff !== 0) return matchDiff;
      // Then by impact factor
      return (b.impactFactor ?? 0) - (a.impactFactor ?? 0);
    });

    console.log(`[JournalSuggest] Returning ${suggestions.length} journal suggestions`);

    return NextResponse.json({
      suggestions,
      searchStrategy: llmResult?.searchStrategy || "OpenAlex keyword search",
      totalCount: suggestions.length,
    });
  } catch (error) {
    console.error("[JournalSuggest] Error:", error);
    return NextResponse.json(
      { error: "Failed to suggest journals" },
      { status: 500 }
    );
  }
}
