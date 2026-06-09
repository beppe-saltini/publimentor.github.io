import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseAuthorList } from "@/lib/author-parser";
import { findReviewersByTopic, findCoAuthors, PubMedAuthor } from "@/lib/pubmed";
import { openAlex } from "@/lib/openalex";
import { coiDetector, type ReviewerConflict, type ConflictSeverity } from "@/lib/coi-detector";
import { enrichReviewerEmailsBatch, extractDomainFromUrl } from "@/lib/reviewers/email-enrichment";

export const dynamic = "force-dynamic";

interface ReviewerCandidate {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  affiliation?: string;
  orcid?: string | null;
  source: "pubmed" | "openalex" | "both";
  verificationUrls?: {
    institutionSearchUrl?: string;
    institutionProfileUrl?: string;
    semanticScholarUrl?: string;
    openAlexUrl?: string;
  };
  worksCount?: number;
  citedByCount?: number;
  hIndex?: number;
  coauthorCount?: number;
  topics?: string[];
  // COI check results
  coiSummary?: {
    hasConflict: boolean;
    worstSeverity: ConflictSeverity | null;
    conflictCount: number;
    conflicts: ReviewerConflict[];
  };
  // Gender diversity
  inferredGender?: "likely_male" | "likely_female" | "unknown";
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { authorList, keywords, focusKeywords, excludeAuthors, checkCOI = true } = body;

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

    const allKeywords = Array.isArray(keywords) ? keywords : [];
    const focus =
      Array.isArray(focusKeywords) && focusKeywords.length > 0
        ? focusKeywords
        : null;
    const searchKeywords = focus || allKeywords;
    
    const reviewerMap = new Map<string, ReviewerCandidate>();
    const institutionDomainCache = new Map<string, string | null>();

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
        const openAlexResponse = await openAlex.findReviewers({
          keywords: searchKeywords.join(" "),
          perPage: 20
        });
        const openAlexResults = openAlexResponse.results;

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
            if (result.last_known_institutions?.[0]?.display_name) {
              existing.affiliation = result.last_known_institutions[0].display_name;
            }
            existing.topics = result.topics?.slice(0, 5).map(
              (t: { display_name: string }) => t.display_name
            );
          } else {
            const affiliation = result.last_known_institutions?.[0]?.display_name;
            const instId = result.last_known_institutions?.[0]?.id || null;
            let instDomain: string | null = null;
            if (instId) {
              if (institutionDomainCache.has(instId)) {
                instDomain = institutionDomainCache.get(instId)!;
              } else {
                const inst = await openAlex.getInstitution(instId);
                instDomain = inst?.homepage_url
                  ? extractDomainFromUrl(inst.homepage_url)
                  : null;
                institutionDomainCache.set(instId, instDomain);
              }
            }
            const instSearchUrl = instDomain
              ? `https://www.google.com/search?q=site:${encodeURIComponent(instDomain)}+"${encodeURIComponent(result.display_name)}"`
              : undefined;

            reviewerMap.set(key, {
              id: result.id,
              name: result.display_name,
              firstName,
              lastName,
              email: null,
              affiliation,
              source: "openalex",
              worksCount: result.works_count,
              citedByCount: result.cited_by_count,
              hIndex: result.summary_stats?.h_index,
              orcid: result.orcid,
              topics: result.topics?.slice(0, 5).map(
                (t: { display_name: string }) => t.display_name
              ),
              verificationUrls: {
                openAlexUrl: result.id,
                institutionSearchUrl: instSearchUrl,
              },
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

    const orcidByName: Record<string, string> = {};
    for (const r of reviewers) {
      if (r.orcid) {
        orcidByName[r.name.toLowerCase().trim()] = r.orcid.replace(
          /^https?:\/\/orcid\.org\//i,
          ""
        );
      }
    }
    const needsEmail = reviewers.filter((r) => !r.email).length;
    if (needsEmail > 0) {
      console.log(`[Find] Enriching emails for ${needsEmail} reviewers...`);
      await enrichReviewerEmailsBatch(reviewers, { orcidByName });
    }

    // Run COI checks if authors are provided and checkCOI is enabled
    if (checkCOI && parsedAuthors.length > 0 && reviewers.length > 0) {
      console.log(`[Find] Running COI checks for ${reviewers.length} reviewers against ${parsedAuthors.length} authors...`);
      
      try {
        // Prepare authors with roles (based on position)
        const authorsWithRoles = parsedAuthors.map((a, index) => {
          let role: "first" | "last" | "middle_early" | "middle_late" = "middle_late";
          if (index === 0) role = "first";
          else if (index === parsedAuthors.length - 1) role = "last";
          else if (index <= 2) role = "middle_early";
          
          return {
            name: a.fullName,
            role,
          };
        });

        // Batch check all reviewers
        const coiResults = await coiDetector.batchCheckReviewerConflicts(
          authorsWithRoles,
          reviewers.map(r => ({ name: r.name }))
        );

        // Add COI summary to each reviewer
        for (const reviewer of reviewers) {
          const coiSummary = coiResults.get(reviewer.name);
          if (coiSummary) {
            reviewer.coiSummary = {
              hasConflict: coiSummary.hasConflict,
              worstSeverity: coiSummary.worstSeverity,
              conflictCount: coiSummary.conflictCount,
              conflicts: coiSummary.conflicts,
            };
          }
        }

        const conflictCount = reviewers.filter(r => r.coiSummary?.hasConflict).length;
        console.log(`[Find] COI check complete: ${conflictCount} reviewers have potential conflicts`);
      } catch (error) {
        console.error("[Find] COI check failed:", error);
        // Continue without COI data rather than failing the whole request
      }
    }

    // Infer gender diversity from first names
    for (const r of reviewers) {
      if (r.firstName) {
        r.inferredGender = openAlex.inferGender(r.firstName);
      }
    }

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
