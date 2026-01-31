import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { openAlex } from "@/lib/openalex";

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query");
    const page = parseInt(searchParams.get("page") || "1");
    const perPage = parseInt(searchParams.get("perPage") || "20");
    const minWorks = parseInt(searchParams.get("minWorks") || "10");
    const minCitations = parseInt(searchParams.get("minCitations") || "50");
    const excludeIds = searchParams.get("excludeIds")?.split(",").filter(Boolean) || [];

    if (!query) {
      return NextResponse.json(
        { error: "Search query is required" },
        { status: 400 }
      );
    }

    const results = await openAlex.findReviewers({
      keywords: query,
      excludeAuthorIds: excludeIds,
      minWorksCount: minWorks,
      minCitations: minCitations,
      page,
      perPage,
    });

    // Transform results for the frontend
    const reviewers = results.results.map((author) => ({
      id: author.id,
      name: author.display_name,
      orcid: author.orcid,
      worksCount: author.works_count,
      citedByCount: author.cited_by_count,
      hIndex: author.summary_stats?.h_index,
      institution: author.last_known_institutions?.[0]?.display_name,
      country: author.last_known_institutions?.[0]?.country_code,
      topics: author.topics?.slice(0, 5).map((t) => t.display_name) || [],
    }));

    return NextResponse.json({
      reviewers,
      meta: {
        count: results.meta.count,
        page: results.meta.page,
        perPage: results.meta.per_page,
        totalPages: Math.ceil(results.meta.count / results.meta.per_page),
      },
    });
  } catch (error) {
    console.error("Error searching reviewers:", error);
    return NextResponse.json(
      { error: "Failed to search reviewers" },
      { status: 500 }
    );
  }
}
