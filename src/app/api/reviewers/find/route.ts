import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseAuthorList } from "@/lib/author-parser";
import { findReviewersByTopic, findCoAuthors, PubMedAuthor } from "@/lib/pubmed";
import { openAlex } from "@/lib/openalex";

export const dynamic = "force-dynamic";

interface ReviewerCandidate {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  affiliation?: string;
  source: "pubmed" | "openalex" | "both";
  worksCount?: number;
  citedByCount?: number;
  hIndex?: number;
  orcid?: string;
  coauthorCount?: number;
  topics?: string[];
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { authorList, keywords, excludeAuthors } = body;

    if (!authorList && !keywords) {
      return NextResponse.json(
        { error: "Author list or keywords required" },
        { status: 400 }
      );
    }

    // Parse authors to exclude (manuscript authors)
    const parsedAuthors = authorList ? parseAuthorList(authorList) : [];
    const excludeNames = [
      ...parsedAuthors.map(a => a.fullName),
      ...parsedAuthors.map(a => a.surname),
      ...(excludeAuthors || []),
    ];

    // Extract keywords from author names or use provided keywords
    const searchKeywords = keywords || [];
    
    const reviewerMap = new Map<string, ReviewerCandidate>();

    // Search PubMed for potential reviewers
    if (searchKeywords.length > 0) {
      try {
        const pubmedAuthors = await findReviewersByTopic(
          searchKeywords,
          excludeNames,
          50
        );

        for (const author of pubmedAuthors) {
          const key = `${author.lastName.toLowerCase()}_${author.foreName.toLowerCase()}`;
          
          reviewerMap.set(key, {
            id: `pubmed_${key}`,
            name: author.fullName,
            firstName: author.foreName,
            lastName: author.lastName,
            affiliation: author.affiliation,
            source: "pubmed",
          });
        }
      } catch (error) {
        console.error("PubMed search error:", error);
      }
    }

    // Search OpenAlex for potential reviewers
    if (searchKeywords.length > 0) {
      try {
        const openAlexResults = await openAlex.findReviewers(
          searchKeywords.join(" "),
          20
        );

        for (const result of openAlexResults) {
          const nameParts = result.display_name.split(" ");
          const lastName = nameParts[nameParts.length - 1];
          const firstName = nameParts.slice(0, -1).join(" ");
          const key = `${lastName.toLowerCase()}_${firstName.toLowerCase()}`;

          const existing = reviewerMap.get(key);
          
          if (existing) {
            // Merge with PubMed data
            existing.source = "both";
            existing.worksCount = result.works_count;
            existing.citedByCount = result.cited_by_count;
            existing.hIndex = result.summary_stats?.h_index;
            existing.orcid = result.orcid;
            if (result.last_known_institution?.display_name) {
              existing.affiliation = result.last_known_institution.display_name;
            }
            existing.topics = result.topics?.slice(0, 5).map(
              (t: { display_name: string }) => t.display_name
            );
          } else {
            reviewerMap.set(key, {
              id: result.id,
              name: result.display_name,
              firstName,
              lastName,
              affiliation: result.last_known_institution?.display_name,
              source: "openalex",
              worksCount: result.works_count,
              citedByCount: result.cited_by_count,
              hIndex: result.summary_stats?.h_index,
              orcid: result.orcid,
              topics: result.topics?.slice(0, 5).map(
                (t: { display_name: string }) => t.display_name
              ),
            });
          }
        }
      } catch (error) {
        console.error("OpenAlex search error:", error);
      }
    }

    // Also find co-authors of the manuscript authors (potential COI)
    const coauthorsWithCounts: { name: string; coauthorCount: number }[] = [];
    
    for (const author of parsedAuthors.slice(0, 3)) { // Limit to first 3 authors
      try {
        const coauthors = await findCoAuthors(author.fullName, 5);
        for (const { author: coauthor, coauthorCount } of coauthors.slice(0, 10)) {
          coauthorsWithCounts.push({
            name: coauthor.fullName,
            coauthorCount,
          });
        }
      } catch (error) {
        console.error(`Error finding co-authors for ${author.fullName}:`, error);
      }
    }

    // Convert map to array and sort
    const reviewers = Array.from(reviewerMap.values())
      .filter(r => {
        // Filter out manuscript authors
        const nameLC = r.name.toLowerCase();
        return !excludeNames.some(e => 
          nameLC.includes(e.toLowerCase()) || e.toLowerCase().includes(nameLC)
        );
      })
      .sort((a, b) => {
        // Prioritize those with more data
        if (a.source === "both" && b.source !== "both") return -1;
        if (b.source === "both" && a.source !== "both") return 1;
        
        // Then by citations
        const aCitations = a.citedByCount || 0;
        const bCitations = b.citedByCount || 0;
        return bCitations - aCitations;
      })
      .slice(0, 50);

    return NextResponse.json({
      reviewers,
      coauthors: coauthorsWithCounts,
      meta: {
        totalFound: reviewerMap.size,
        returned: reviewers.length,
        excludedAuthors: excludeNames.length,
      },
      disclaimer: "These are automated suggestions for editorial consideration only. All potential reviewers require verification of independence and suitability before invitation. This is not an automated assignment system.",
      metadata: {
        dataSources: ["PubMed", "OpenAlex"],
        limitations: [
          "May not capture all experts in the field",
          "Co-author detection is based on available publication data",
          "Affiliation information may be outdated"
        ]
      }
    });
  } catch (error) {
    console.error("Error finding reviewers:", error);
    return NextResponse.json(
      { error: "Failed to find reviewers" },
      { status: 500 }
    );
  }
}
