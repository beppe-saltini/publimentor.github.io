import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { searchPubMed, fetchPubMedArticles, PubMedArticle } from "@/lib/pubmed";
import { parseAuthorList } from "@/lib/author-parser";
import { suggestReviewersWithLLM } from "@/lib/llm";
import { searchAuthor as searchSemanticScholar, searchAuthorByOrcid as searchSSByOrcid } from "@/lib/semantic-scholar";
import { openAlex } from "@/lib/openalex";
import { coiDetector, type ReviewerConflict, type ReviewerCOISummary, type ConflictSeverity } from "@/lib/coi-detector";
import {
  enrichReviewerEmailsBatch,
  extractEmailFromAffiliation,
  resolveEmailFromPubMedArticles,
  type EmailBatchMetrics,
  type EmailConfidence,
  type EmailSource,
} from "@/lib/reviewers/email-enrichment";
import { enrichReviewerReputationBatch } from "@/lib/reviewers/reputation-check";
import type { ReputationSummary } from "@/lib/reviewers/reputation-check";
import { z } from "zod";
import {
  checkRateLimit,
  getRateLimitResponse,
  sanitizeString,
  auditLog,
  getClientIp,
  getUserAgent,
} from "@/lib/security";

export const dynamic = "force-dynamic";

interface OrcidProfile {
  email: string | null;
  profileUrls: string[];
}

async function fetchOrcidProfile(orcid: string): Promise<OrcidProfile> {
  const empty: OrcidProfile = { email: null, profileUrls: [] };
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcid}/person`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return empty;
    const data = await res.json();

    // Extract primary email
    const emails = data?.emails?.email || [];
    const primaryEmail = emails.find((e: { primary?: boolean; email?: string }) => e.primary)?.email
      || emails[0]?.email || null;

    // Extract researcher URLs
    const urls: string[] = [];
    const researcherUrls = data?.["researcher-urls"]?.["researcher-url"] || [];
    for (const entry of researcherUrls) {
      const url = entry?.url?.value;
      if (url && typeof url === "string") urls.push(url);
    }

    return { email: primaryEmail, profileUrls: urls };
  } catch {
    return empty;
  }
}

function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    // Strip leading "www."
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function findInstitutionProfileUrl(
  profileUrls: string[],
  institutionDomain: string | null
): string | null {
  if (!institutionDomain || profileUrls.length === 0) return null;
  const domainLower = institutionDomain.toLowerCase();
  for (const url of profileUrls) {
    const urlDomain = extractDomain(url);
    if (urlDomain && urlDomain.toLowerCase().endsWith(domainLower)) {
      return url;
    }
  }
  return null;
}

// Rate limit: 10 requests per minute (expensive LLM calls)
const DISCOVER_RATE_LIMIT = { windowMs: 60000, maxRequests: 10 };

const discoverSchema = z.object({
  // Limit keyword lengths to prevent abuse
  primaryKeywords: z.array(z.string().max(200)).min(1).max(10),
  secondaryKeywords: z.array(z.string().max(200)).max(10).optional(),
  keywordOperator: z.enum(["AND", "OR"]).default("AND"),
  minHIndex: z.number().min(0).default(0),
  maxHIndex: z.number().min(0).default(100),
  minPublications: z.number().min(1).default(1),
  maxPublications: z.number().min(1).default(500),
  yearsActive: z.number().min(1).max(20).default(5),
  requireSeniorAuthor: z.boolean().default(true),
  maxResults: z.number().min(5).max(50).default(10),
  manuscriptAuthors: z.string().optional(),
  diversifyGeo: z.boolean().default(true),
  avoidSameInstitution: z.boolean().default(true),
  useLLM: z.boolean().default(true),
  checkCOI: z.boolean().default(true),  // Check for conflicts of interest
  focusKeywords: z.array(z.string().max(200)).max(10).optional(),
  coveredExpertise: z.array(z.string().max(200)).max(10).optional(),
});

interface ReviewerCandidate {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  emailSource?: EmailSource;
  emailConfidence?: EmailConfidence;
  affiliation: string;
  country: string;
  hIndex: number | null;
  citationCount: number | null;
  publicationCount: number;
  firstAuthorCount: number;
  lastAuthorCount: number;
  correspondingCount: number;
  seniorAuthorCount: number;
  recentArticles: {
    title: string;
    journal: string;
    year: string;
    pmid: string;
    position: "first" | "last" | "middle";
  }[];
  sources: ("PubMed" | "SemanticScholar" | "OpenAlex")[];
  verificationUrls: {
    pubmedSearchUrl: string;
    googleScholarUrl: string;
    institutionSearchUrl: string;
    institutionProfileUrl?: string;
    institutionDomain?: string;
    semanticScholarUrl?: string;
    semanticScholarHomepage?: string;
    openAlexUrl?: string;
    orcidProfileUrls?: string[];
    emailSource?: EmailSource;
    emailConfidence?: EmailConfidence;
  };
  llmAnalysis?: {
    relevanceScore: number;
    reasoning: string;
    topicalMatch: "excellent" | "good" | "moderate" | "weak";
    seniorityAssessment: string;
    recommendation: "highly_recommended" | "recommended" | "consider" | "not_recommended";
    expertise: string[];
  };
  // COI check results
  coiSummary?: {
    hasConflict: boolean;
    worstSeverity: ConflictSeverity | null;
    conflictCount: number;
    conflicts: ReviewerConflict[];
  };
  reputationSummary?: ReputationSummary;
  // Gender diversity
  inferredGender?: "likely_male" | "likely_female" | "unknown";
}

// Helper to delay between API calls
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIp = getClientIp(request);
    
    // Rate limiting - expensive API calls
    const rateLimit = checkRateLimit(
      `discover:${session.user.id}`,
      DISCOVER_RATE_LIMIT
    );
    if (!rateLimit.allowed) {
      auditLog({
        userId: session.user.id,
        action: "RATE_LIMIT_EXCEEDED",
        resource: "reviewers/discover",
        resourceId: "api",
        ip: clientIp,
        userAgent: getUserAgent(request),
        severity: "warning",
      });
      return getRateLimitResponse(rateLimit.resetIn);
    }

    const body = await request.json();
    const params = discoverSchema.parse(body);
    
    // Sanitize keyword inputs
    const sanitizedPrimary = params.primaryKeywords.map(k => sanitizeString(k));
    const sanitizedSecondary = params.secondaryKeywords?.map(k => sanitizeString(k));
    const sanitizedFocus = params.focusKeywords?.map(k => sanitizeString(k)).filter(Boolean);
    const sanitizedCovered = params.coveredExpertise?.map(k => sanitizeString(k)).filter(Boolean);
    const searchPrimary =
      sanitizedFocus && sanitizedFocus.length > 0 ? sanitizedFocus : sanitizedPrimary;

    console.log(`[Discover] Filters: H-index ${params.minHIndex}-${params.maxHIndex}, Pubs ${params.minPublications}-${params.maxPublications}, Years ${params.yearsActive}, Senior=${params.requireSeniorAuthor}, LLM=${params.useLLM}`);

    // Parse manuscript authors to exclude
    const parsedAuthors = params.manuscriptAuthors 
      ? parseAuthorList(params.manuscriptAuthors) 
      : [];
    const excludeNames = parsedAuthors.map(a => a.fullName);

    const candidates: ReviewerCandidate[] = [];
    const institutionDomainCache = new Map<string, string | null>();
    const orcidByReviewerName: Record<string, string> = {};
    let llmUsed = false;
    let searchStrategy = "";
    let caveats: string[] = [];

    // STEP 1: Use Claude as PRIMARY source to suggest reviewers
    if (params.useLLM) {
      console.log("[Discover] Using Claude as PRIMARY source for reviewer suggestions...");
      
      const llmResult = await suggestReviewersWithLLM(
        searchPrimary,
        params.secondaryKeywords,
        excludeNames,
        params.maxResults + 5, // Get a few extra in case some can't be verified
        {
          requireSenior: params.requireSeniorAuthor,
          diversifyGeography: params.diversifyGeo,
          diversifyInstitutions: params.avoidSameInstitution,
          keywordOperator: params.keywordOperator,
          deemphasizeExpertise:
            sanitizedCovered && sanitizedCovered.length > 0
              ? sanitizedCovered
              : undefined,
        }
      );

      if (llmResult && llmResult.reviewers.length > 0) {
        llmUsed = true;
        searchStrategy = llmResult.searchStrategy;
        caveats = llmResult.caveats || [];
        
        console.log(`[Discover] Claude suggested ${llmResult.reviewers.length} reviewers, verifying...`);

        // STEP 2: Verify each suggested reviewer with PubMed + enrich with Semantic Scholar/OpenAlex
        for (const suggested of llmResult.reviewers) {
          if (candidates.length >= params.maxResults) break;

          try {
            // Search PubMed for this author
            const currentYear = new Date().getFullYear();
            const startYear = currentYear - params.yearsActive;
            
            // Try each search term until we find results
            let articles: PubMedArticle[] = [];
            let usedSearchTerm = "";
            
            for (const searchTerm of suggested.searchTerms) {
              const query = `${searchTerm} AND ${startYear}:${currentYear}[Date - Publication]`;
              const pmids = await searchPubMed(query, 50);
              
              if (pmids.length > 0) {
                articles = await fetchPubMedArticles(pmids);
                usedSearchTerm = searchTerm;
                break;
              }
            }

            // If no articles found with search terms, try the name directly
            if (articles.length === 0) {
              const directQuery = `${suggested.name}[Author] AND ${startYear}:${currentYear}[Date - Publication]`;
              const pmids = await searchPubMed(directQuery, 50);
              if (pmids.length > 0) {
                articles = await fetchPubMedArticles(pmids);
                usedSearchTerm = `${suggested.name}[Author]`;
              }
            }

            if (articles.length === 0) {
              console.log(`[Discover] Could not verify ${suggested.name} in PubMed, skipping`);
              continue;
            }

            console.log(`[Discover] Verified ${suggested.name}: ${articles.length} articles found`);

            // Calculate author metrics from PubMed data
            let firstAuthorCount = 0;
            let lastAuthorCount = 0;
            const nameParts = suggested.name.split(" ");
            const lastName = nameParts[nameParts.length - 1].toLowerCase();

            for (const article of articles) {
              const authorIndex = article.authors.findIndex(a => 
                a.fullName.toLowerCase().includes(lastName) ||
                a.lastName.toLowerCase() === lastName
              );
              
              if (authorIndex === 0) {
                firstAuthorCount++;
              } else if (authorIndex === article.authors.length - 1 && article.authors.length > 1) {
                lastAuthorCount++;
              }
            }

            const seniorCount = firstAuthorCount + lastAuthorCount;

            // Skip if requiring senior and none found
            if (params.requireSeniorAuthor && seniorCount === 0 && articles.length < 3) {
              console.log(`[Discover] ${suggested.name} has no senior author papers, skipping`);
              continue;
            }

            // STEP 3: Enrich with H-index — OpenAlex first (better disambiguation),
            // then Semantic Scholar (use ORCID when available, name+paperCount hint otherwise).
            let hIndexSS: number | null = null;
            let hIndexOA: number | null = null;
            let oaPaperCount: number | null = null;
            let oaOrcid: string | null = null;
            let citationCount: number | null = null;
            let oaInstitutionId: string | null = null;
            const sources: ("PubMed" | "SemanticScholar" | "OpenAlex")[] = ["PubMed"];
            let semanticScholarUrl: string | undefined;
            let semanticScholarHomepage: string | undefined;
            let openAlexUrl: string | undefined;

            // 3a. OpenAlex FIRST — most reliable author disambiguation
            // Also use the verified display_name to correct LLM hallucinated first names
            let verifiedName: string | null = null;
            try {
              const oaAuthor = await openAlex.findAuthorByName(suggested.name);
              if (oaAuthor) {
                hIndexOA = oaAuthor.summary_stats?.h_index ?? null;
                oaPaperCount = oaAuthor.works_count;
                oaOrcid = oaAuthor.orcid?.replace("https://orcid.org/", "") || null;
                citationCount = oaAuthor.cited_by_count;
                openAlexUrl = oaAuthor.id;
                oaInstitutionId = oaAuthor.last_known_institutions?.[0]?.id || null;
                sources.push("OpenAlex");
                if (oaAuthor.display_name) {
                  const oaLast = oaAuthor.display_name.split(" ").pop()?.toLowerCase();
                  if (oaLast === lastName) {
                    verifiedName = oaAuthor.display_name;
                    if (verifiedName !== suggested.name) {
                      console.log(`[Discover] Name corrected: "${suggested.name}" → "${verifiedName}" (from OpenAlex)`);
                    }
                  }
                }
                console.log(`[Discover] OpenAlex: ${verifiedName || suggested.name} H-index=${hIndexOA}, papers=${oaPaperCount}, ORCID=${oaOrcid || "none"}`);
              }
              await delay(100);
            } catch (error) {
              console.log(`[Discover] OpenAlex lookup failed for ${suggested.name}`);
            }

            // 3b. Semantic Scholar — prefer ORCID lookup, fall back to name search with paperCount hint
            try {
              let ssAuthor = null;
              if (oaOrcid) {
                ssAuthor = await searchSSByOrcid(oaOrcid);
              }
              if (!ssAuthor) {
                ssAuthor = await searchSemanticScholar(suggested.name, oaPaperCount ?? undefined);
              }
              if (ssAuthor && ssAuthor.hIndex > 0) {
                hIndexSS = ssAuthor.hIndex;
                if (citationCount === null || ssAuthor.citationCount > (citationCount || 0)) {
                  citationCount = ssAuthor.citationCount;
                }
                semanticScholarUrl = ssAuthor.url;
                if (ssAuthor.homepage) semanticScholarHomepage = ssAuthor.homepage;
                sources.push("SemanticScholar");
                console.log(`[Discover] SemanticScholar: ${suggested.name} H-index=${hIndexSS}, papers=${ssAuthor.paperCount}`);
              }
              await delay(200);
            } catch (error) {
              console.log(`[Discover] SemanticScholar lookup failed for ${suggested.name}`);
            }

            // 3c. Merge H-index with cross-validation
            let hIndex: number | null = null;
            if (hIndexOA !== null && hIndexSS !== null) {
              // Cross-validate: if SS h-index is less than 1/3 of OA, SS likely matched
              // a wrong/fragmented profile — prefer OA only
              if (hIndexSS < hIndexOA / 3) {
                hIndex = hIndexOA;
                console.log(`[Discover] ${suggested.name}: SS H-index ${hIndexSS} looks wrong vs OA ${hIndexOA}, using OA only`);
              } else {
                hIndex = Math.max(hIndexSS, hIndexOA);
              }
            } else {
              // Prefer OA when only one is available (better disambiguation)
              hIndex = hIndexOA ?? hIndexSS;
            }

            // Apply H-index filter if specified
            if (hIndex !== null) {
              if (params.minHIndex > 0 && hIndex < params.minHIndex) {
                console.log(`[Discover] ${suggested.name} H-index ${hIndex} below minimum ${params.minHIndex}, skipping`);
                continue;
              }
              if (params.maxHIndex < 100 && hIndex > params.maxHIndex) {
                console.log(`[Discover] ${suggested.name} H-index ${hIndex} above maximum ${params.maxHIndex}, skipping`);
                continue;
              }
            }

            // Build recent articles list
            const recentArticles = articles.slice(0, 5).map(article => {
              const authorIndex = article.authors.findIndex(a => 
                a.lastName.toLowerCase() === lastName
              );
              let position: "first" | "last" | "middle" = "middle";
              if (authorIndex === 0) position = "first";
              else if (authorIndex === article.authors.length - 1) position = "last";

              return {
                title: article.title,
                journal: article.journal,
                year: article.pubDate,
                pmid: article.pmid,
                position,
              };
            });

            // Use verified name from OpenAlex when available (fixes LLM-hallucinated first names)
            const finalName = verifiedName || suggested.name;
            const finalNameParts = finalName.split(" ");

            // Fetch ORCID profile (email + researcher URLs) and resolve institution domain
            const orcidProfile = oaOrcid ? await fetchOrcidProfile(oaOrcid) : { email: null, profileUrls: [] };

            let instDomain: string | null = null;
            if (oaInstitutionId) {
              if (institutionDomainCache.has(oaInstitutionId)) {
                instDomain = institutionDomainCache.get(oaInstitutionId)!;
              } else {
                const inst = await openAlex.getInstitution(oaInstitutionId);
                instDomain = inst?.homepage_url ? extractDomain(inst.homepage_url) : null;
                institutionDomainCache.set(oaInstitutionId, instDomain);
              }
            }

            const institutionProfileUrl = findInstitutionProfileUrl(orcidProfile.profileUrls, instDomain) || undefined;
            const institutionSearchUrl = instDomain
              ? `https://www.google.com/search?q=site:${encodeURIComponent(instDomain)}+"${encodeURIComponent(finalName)}"`
              : `https://www.google.com/search?q="${encodeURIComponent(finalName)}"+"${encodeURIComponent(suggested.affiliation.slice(0, 50))}"`;

            if (oaOrcid) {
              orcidByReviewerName[finalName.toLowerCase().trim()] = oaOrcid;
            }

            const finalLastName = finalNameParts[finalNameParts.length - 1];
            const pubmedEmail = resolveEmailFromPubMedArticles(
              articles,
              finalLastName,
              finalNameParts.slice(0, -1).join(" ") || undefined
            );
            const affEmail = extractEmailFromAffiliation(suggested.affiliation);
            const resolvedEmail =
              orcidProfile.email || pubmedEmail || affEmail || null;
            const resolvedEmailSource = orcidProfile.email
              ? ("orcid" as const)
              : pubmedEmail
                ? ("pubmed" as const)
                : affEmail
                  ? ("affiliation" as const)
                  : undefined;

            const candidate: ReviewerCandidate = {
              id: `llm_${finalName.toLowerCase().replace(/\s+/g, "_")}`,
              name: finalName,
              firstName: finalNameParts.slice(0, -1).join(" "),
              lastName: finalLastName,
              email: resolvedEmail,
              emailSource: resolvedEmailSource,
              emailConfidence: resolvedEmailSource ? "high" : undefined,
              affiliation: suggested.affiliation,
              country: suggested.country,
              hIndex,
              citationCount,
              publicationCount: articles.length,
              firstAuthorCount,
              lastAuthorCount,
              correspondingCount: lastAuthorCount,
              seniorAuthorCount: seniorCount,
              recentArticles,
              sources,
              verificationUrls: {
                pubmedSearchUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(usedSearchTerm || finalName + "[Author]")}`,
                googleScholarUrl: `https://scholar.google.com/scholar?q=author:"${encodeURIComponent(finalName)}"`,
                institutionSearchUrl,
                institutionProfileUrl,
                institutionDomain: instDomain || undefined,
                semanticScholarUrl,
                semanticScholarHomepage,
                openAlexUrl,
                orcidProfileUrls:
                  orcidProfile.profileUrls.length > 0
                    ? orcidProfile.profileUrls
                    : undefined,
              },
              llmAnalysis: {
                relevanceScore: 85, // High score since Claude suggested them
                reasoning: suggested.reasoning,
                topicalMatch: "excellent",
                seniorityAssessment: suggested.estimatedSeniority === "senior" 
                  ? "Established senior researcher" 
                  : suggested.estimatedSeniority === "mid-career"
                  ? "Mid-career researcher with growing impact"
                  : "Early-career researcher",
                recommendation: "highly_recommended",
                expertise: suggested.expertise,
              },
            };

            candidates.push(candidate);
          } catch (error) {
            console.error(`[Discover] Error verifying ${suggested.name}:`, error);
          }
        }
      }
    }

    // STEP 4: Fallback to direct database search if LLM didn't provide results
    if (candidates.length === 0) {
      console.log("[Discover] Falling back to OpenAlex + PubMed search...");
      
      try {
        // Use OpenAlex for initial discovery (has H-index filtering)
        const oaResult = await openAlex.discoverReviewers({
          primaryKeywords: searchPrimary,
          secondaryKeywords: params.secondaryKeywords,
          minHIndex: params.minHIndex,
          maxHIndex: params.maxHIndex,
          minWorksCount: params.minPublications,
          yearsActive: params.yearsActive,
          requireCorresponding: params.requireSeniorAuthor,
          maxResults: params.maxResults * 2,
          excludeNames,
        });

        console.log(`[Discover] OpenAlex returned ${oaResult.authors.length} authors`);

        for (const oaAuthor of oaResult.authors) {
          if (candidates.length >= params.maxResults) break;

          const nameParts = oaAuthor.display_name.split(" ");
          const lastName = nameParts[nameParts.length - 1];
          const affiliation = oaAuthor.last_known_institutions?.[0]?.display_name || "Unknown";
          const country = oaAuthor.last_known_institutions?.[0]?.country_code || "Unknown";

          // OpenAlex h-index is the primary source (reliable disambiguation)
          let hIndex = oaAuthor.summary_stats?.h_index || null;
          let semanticScholarUrl: string | undefined;
          let semanticScholarHomepage: string | undefined;

          // Try Semantic Scholar — use ORCID first, then name with paperCount hint
          try {
            const oaOrcid = oaAuthor.orcid?.replace("https://orcid.org/", "") || null;
            let ssAuthor = oaOrcid ? await searchSSByOrcid(oaOrcid) : null;
            if (!ssAuthor) {
              ssAuthor = await searchSemanticScholar(oaAuthor.display_name, oaAuthor.works_count);
            }
            if (ssAuthor) {
              semanticScholarUrl = ssAuthor.url;
              if (ssAuthor.homepage) semanticScholarHomepage = ssAuthor.homepage;
              // Only use SS h-index if it's in the same ballpark as OA (cross-validate)
              if (hIndex && ssAuthor.hIndex > 0 && ssAuthor.hIndex < hIndex / 3) {
                console.log(`[Discover] Fallback: ${oaAuthor.display_name} SS H-index ${ssAuthor.hIndex} looks wrong vs OA ${hIndex}, ignoring SS`);
              } else if (ssAuthor.hIndex > (hIndex || 0)) {
                hIndex = ssAuthor.hIndex;
              }
            }
            await delay(200);
          } catch {
            // Ignore errors
          }

          // Apply H-index filter
          if (hIndex !== null) {
            if (params.minHIndex > 0 && hIndex < params.minHIndex) continue;
            if (params.maxHIndex < 100 && hIndex > params.maxHIndex) continue;
          }

          const oaOrcidClean = oaAuthor.orcid?.replace("https://orcid.org/", "") || null;
          const orcidProfile2 = oaOrcidClean ? await fetchOrcidProfile(oaOrcidClean) : { email: null, profileUrls: [] };

          const oaInstId2 = oaAuthor.last_known_institutions?.[0]?.id || null;
          let instDomain2: string | null = null;
          if (oaInstId2) {
            if (institutionDomainCache.has(oaInstId2)) {
              instDomain2 = institutionDomainCache.get(oaInstId2)!;
            } else {
              const inst = await openAlex.getInstitution(oaInstId2);
              instDomain2 = inst?.homepage_url ? extractDomain(inst.homepage_url) : null;
              institutionDomainCache.set(oaInstId2, instDomain2);
            }
          }

          const instProfileUrl2 = findInstitutionProfileUrl(orcidProfile2.profileUrls, instDomain2) || undefined;
          const instSearchUrl2 = instDomain2
            ? `https://www.google.com/search?q=site:${encodeURIComponent(instDomain2)}+"${encodeURIComponent(oaAuthor.display_name)}"`
            : `https://www.google.com/search?q="${encodeURIComponent(oaAuthor.display_name)}"+"${encodeURIComponent(affiliation.slice(0, 50))}"`;

          if (oaOrcidClean) {
            orcidByReviewerName[oaAuthor.display_name.toLowerCase().trim()] =
              oaOrcidClean;
          }

          let oaRecentArticles: ReviewerCandidate["recentArticles"] = [];
          let oaEmail =
            orcidProfile2.email || extractEmailFromAffiliation(affiliation);
          let oaEmailSource: EmailSource | undefined = orcidProfile2.email
            ? "orcid"
            : oaEmail
              ? "affiliation"
              : undefined;
          try {
            const oaPmids = await searchPubMed(
              `${oaAuthor.display_name}[Author]`,
              25
            );
            if (oaPmids.length > 0) {
              const oaPubmedArticles = await fetchPubMedArticles(oaPmids);
              const pubmedHit = resolveEmailFromPubMedArticles(
                oaPubmedArticles,
                lastName,
                nameParts.slice(0, -1).join(" ") || undefined
              );
              if (pubmedHit) {
                oaEmail = pubmedHit;
                oaEmailSource = "pubmed";
              }
              oaRecentArticles = oaPubmedArticles.slice(0, 5).map((article) => {
                const authorIndex = article.authors.findIndex(
                  (a) => a.lastName.toLowerCase() === lastName.toLowerCase()
                );
                let position: "first" | "last" | "middle" = "middle";
                if (authorIndex === 0) position = "first";
                else if (
                  authorIndex === article.authors.length - 1 &&
                  article.authors.length > 1
                ) {
                  position = "last";
                }
                return {
                  title: article.title,
                  journal: article.journal,
                  year: article.pubDate,
                  pmid: article.pmid,
                  position,
                };
              });
            }
          } catch {
            /* PubMed lookup optional for OpenAlex candidates */
          }

          candidates.push({
            id: oaAuthor.id,
            name: oaAuthor.display_name,
            firstName: nameParts.slice(0, -1).join(" "),
            lastName,
            email: oaEmail,
            emailSource: oaEmail ? oaEmailSource : undefined,
            emailConfidence: oaEmail ? "high" : undefined,
            affiliation,
            country,
            hIndex,
            citationCount: oaAuthor.cited_by_count,
            publicationCount: oaAuthor.works_count,
            firstAuthorCount: 0,
            lastAuthorCount: 0,
            correspondingCount: 0,
            seniorAuthorCount: 0,
            recentArticles: oaRecentArticles,
            sources: ["OpenAlex"],
            verificationUrls: {
              pubmedSearchUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(oaAuthor.display_name)}[Author]`,
              googleScholarUrl: `https://scholar.google.com/scholar?q=author:"${encodeURIComponent(oaAuthor.display_name)}"`,
              institutionSearchUrl: instSearchUrl2,
              institutionProfileUrl: instProfileUrl2,
              institutionDomain: instDomain2 || undefined,
              semanticScholarUrl,
              semanticScholarHomepage,
              openAlexUrl: oaAuthor.id,
              orcidProfileUrls:
                orcidProfile2.profileUrls.length > 0
                  ? orcidProfile2.profileUrls
                  : undefined,
            },
          });
        }
      } catch (error) {
        console.error("[Discover] OpenAlex fallback failed:", error);
        
        // Ultimate fallback: PubMed only
        const currentYear = new Date().getFullYear();
        const startYear = currentYear - params.yearsActive;
        const joiner = params.keywordOperator === "AND" ? " AND " : " OR ";
        const keywordQuery = [...params.primaryKeywords, ...(params.secondaryKeywords || [])]
          .map(k => `"${k}"[Title/Abstract]`)
          .join(joiner);
        const query = `(${keywordQuery}) AND ${startYear}:${currentYear}[Date - Publication]`;
        
        const pmids = await searchPubMed(query, 200);
        if (pmids.length > 0) {
          const articles = await fetchPubMedArticles(pmids);
          
          // Extract unique authors
          const authorStats = new Map<string, {
            name: string;
            firstName: string;
            lastName: string;
            articles: PubMedArticle[];
            firstAuthorCount: number;
            lastAuthorCount: number;
            affiliations: Set<string>;
          }>();

          const excludeSet = new Set(excludeNames.map(n => n.toLowerCase()));

          for (const article of articles) {
            article.authors.forEach((author, index) => {
              if (excludeSet.has(author.fullName.toLowerCase())) return;
              
              const key = `${author.lastName.toLowerCase()}_${author.foreName?.toLowerCase() || ""}`;
              let stats = authorStats.get(key);
              
              if (!stats) {
                stats = {
                  name: author.fullName,
                  firstName: author.foreName,
                  lastName: author.lastName,
                  articles: [],
                  firstAuthorCount: 0,
                  lastAuthorCount: 0,
                  affiliations: new Set(),
                };
                authorStats.set(key, stats);
              }
              
              stats.articles.push(article);
              if (index === 0) stats.firstAuthorCount++;
              else if (index === article.authors.length - 1) stats.lastAuthorCount++;
              if (author.affiliation) stats.affiliations.add(author.affiliation);
            });
          }

          // Convert to candidates
          for (const [, stats] of authorStats) {
            if (candidates.length >= params.maxResults) break;
            
            const pubCount = stats.articles.length;
            const seniorCount = stats.firstAuthorCount + stats.lastAuthorCount;
            
            if (pubCount < params.minPublications) continue;
            if (params.requireSeniorAuthor && seniorCount === 0) continue;
            
            const affiliation =
              [...stats.affiliations].find((a) => a.includes("@")) ||
              Array.from(stats.affiliations)[0] ||
              "Unknown";
            const country = extractCountry(affiliation);
            const pubmedEmail = resolveEmailFromPubMedArticles(
              stats.articles,
              stats.lastName,
              stats.firstName
            );
            const fallbackAffEmail = extractEmailFromAffiliation(affiliation);
            const fallbackEmail = pubmedEmail || fallbackAffEmail || null;
            const fallbackSource: EmailSource | undefined = pubmedEmail
              ? "pubmed"
              : fallbackAffEmail
                ? "affiliation"
                : undefined;

            candidates.push({
              id: `pubmed_${stats.lastName}_${stats.firstName}`.toLowerCase(),
              name: stats.name,
              firstName: stats.firstName,
              lastName: stats.lastName,
              email: fallbackEmail,
              emailSource: fallbackSource,
              emailConfidence: fallbackEmail ? "high" : undefined,
              affiliation,
              country,
              hIndex: null,
              citationCount: null,
              publicationCount: pubCount,
              firstAuthorCount: stats.firstAuthorCount,
              lastAuthorCount: stats.lastAuthorCount,
              correspondingCount: stats.lastAuthorCount,
              seniorAuthorCount: seniorCount,
              recentArticles: stats.articles.slice(0, 3).map(a => ({
                title: a.title,
                journal: a.journal,
                year: a.pubDate,
                pmid: a.pmid,
                position: "middle" as const,
              })),
              sources: ["PubMed"],
              verificationUrls: {
                pubmedSearchUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(stats.name)}[Author]`,
                googleScholarUrl: `https://scholar.google.com/scholar?q=author:"${encodeURIComponent(stats.name)}"`,
                institutionSearchUrl: `https://www.google.com/search?q="${encodeURIComponent(stats.name)}"`,
              },
            });
          }
        }
      }
    }

    // STEP 5: Enrich any still-missing emails (ORCID, web search, profile pages)
    const needsEmail = candidates.filter((c) => !c.email).length;
    const hasEmailBefore = candidates.length - needsEmail;
    console.log(
      `[Discover] Emails: ${hasEmailBefore}/${candidates.length} found before enrichment`
    );
    let emailMetrics: EmailBatchMetrics = {
      emailsFound: hasEmailBefore,
      emailsMissing: needsEmail,
      bySource: {},
    };
    for (const c of candidates) {
      if (c.email && c.emailSource) {
        emailMetrics.bySource[c.emailSource] =
          (emailMetrics.bySource[c.emailSource] || 0) + 1;
      } else if (c.email) {
        emailMetrics.bySource.affiliation =
          (emailMetrics.bySource.affiliation || 0) + 1;
      }
    }
    if (needsEmail > 0) {
      console.log(`[Discover] Enriching emails for ${needsEmail} reviewers...`);
      const batchMetrics = await enrichReviewerEmailsBatch(candidates, {
        orcidByName: orcidByReviewerName,
      });
      emailMetrics = batchMetrics;
      console.log(
        `[Discover] Emails after enrichment: ${batchMetrics.emailsFound}/${candidates.length}`,
        batchMetrics.bySource
      );
    }

    // STEP 5.5: PubPeer + For Better Science integrity screening
    if (candidates.length > 0) {
      console.log(`[Discover] Reputation screening for ${candidates.length} reviewers...`);
      try {
        await enrichReviewerReputationBatch(candidates);
        const flagged = candidates.filter((c) => c.reputationSummary?.hasConcerns).length;
        console.log(`[Discover] Reputation screening complete: ${flagged} with potential concerns`);
      } catch (error) {
        console.error("[Discover] Reputation screening failed:", error);
      }
    }

    // STEP 6: Run COI checks if authors are provided and checkCOI is enabled
    if (params.checkCOI && parsedAuthors.length > 0 && candidates.length > 0) {
      console.log(`[Discover] Running COI checks for ${candidates.length} reviewers against ${parsedAuthors.length} authors...`);
      
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
          candidates.map(c => ({ name: c.name }))
        );

        // Add COI summary to each candidate
        for (const candidate of candidates) {
          const coiSummary = coiResults.get(candidate.name);
          if (coiSummary) {
            candidate.coiSummary = {
              hasConflict: coiSummary.hasConflict,
              worstSeverity: coiSummary.worstSeverity,
              conflictCount: coiSummary.conflictCount,
              conflicts: coiSummary.conflicts,
            };
          }
        }

        const conflictCount = candidates.filter(c => c.coiSummary?.hasConflict).length;
        console.log(`[Discover] COI check complete: ${conflictCount} reviewers have potential conflicts`);
      } catch (error) {
        console.error("[Discover] COI check failed:", error);
        // Continue without COI data rather than failing the whole request
      }
    }

    // Build summary
    const countries = Array.from(new Set(candidates.map(c => c.country).filter(c => c !== "Unknown")));
    const avgPubs = candidates.length > 0
      ? Math.round(candidates.reduce((sum, c) => sum + c.publicationCount, 0) / candidates.length)
      : 0;
    const avgSenior = candidates.length > 0
      ? Math.round(candidates.reduce((sum, c) => sum + c.seniorAuthorCount, 0) / candidates.length)
      : 0;
    const candidatesWithHIndex = candidates.filter(c => c.hIndex !== null);
    const avgHIndex = candidatesWithHIndex.length > 0
      ? Math.round(candidatesWithHIndex.reduce((sum, c) => sum + (c.hIndex || 0), 0) / candidatesWithHIndex.length)
      : null;

    // STEP 6: Infer gender diversity from first names
    for (const c of candidates) {
      if (c.firstName) {
        c.inferredGender = openAlex.inferGender(c.firstName);
      }
    }

    candidates.sort((a, b) => {
      const aConcerns = a.reputationSummary?.hasConcerns ? 1 : 0;
      const bConcerns = b.reputationSummary?.hasConcerns ? 1 : 0;
      return aConcerns - bConcerns;
    });

    // Gender diversity stats
    const genderCounts = { likely_female: 0, likely_male: 0, unknown: 0 };
    for (const c of candidates) {
      genderCounts[c.inferredGender || "unknown"]++;
    }

    return NextResponse.json({
      reviewers: candidates,
      summary: {
        totalFound: candidates.length,
        returned: candidates.length,
        criteria: {
          minHIndex: params.minHIndex,
          maxHIndex: params.maxHIndex,
          minPublications: params.minPublications,
          maxPublications: params.maxPublications,
          yearsActive: params.yearsActive,
          requireSeniorAuthor: params.requireSeniorAuthor,
        },
        diversity: {
          countries,
          countryCount: countries.length,
          gender: genderCounts,
        },
        avgPublications: avgPubs,
        avgSeniorAuthorships: avgSenior,
        avgHIndex,
        llmEnhanced: llmUsed,
        searchStrategy: searchStrategy || undefined,
        caveats: caveats.length > 0 ? caveats : undefined,
        dataSources: {
          semanticScholar: candidates.filter(c => c.sources.includes("SemanticScholar")).length,
          openAlex: candidates.filter(c => c.sources.includes("OpenAlex")).length,
          pubMed: candidates.filter(c => c.sources.includes("PubMed")).length,
        },
        emailMetrics,
      },
      disclaimer: llmUsed 
        ? `Claude AI suggested these ${candidates.length} reviewers based on its knowledge of the research field, then verified each against PubMed, Semantic Scholar, and OpenAlex. All require independent verification before invitation.`
        : `These are automated suggestions from database search. All ${candidates.length} candidates require independent verification.`,
      selectionCriteria: {
        method: llmUsed ? "Claude AI suggested experts, verified with PubMed + enriched with Semantic Scholar/OpenAlex" : "OpenAlex/PubMed keyword search",
        hIndexRange: params.minHIndex > 0 || params.maxHIndex < 100 
          ? `H-index ${params.minHIndex}-${params.maxHIndex}` 
          : "No H-index filter",
        publications: `Verified ${params.yearsActive}-year publication history`,
        seniorAuthor: params.requireSeniorAuthor ? "Senior author papers required" : "Not required",
        verification: "PubMed, Semantic Scholar, OpenAlex, and Google Scholar links provided",
      },
    });
  } catch (error) {
    console.error("Error discovering reviewers:", error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid parameters", details: error.issues },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: "Failed to discover reviewers" },
      { status: 500 }
    );
  }
}

function extractCountry(affiliation: string): string {
  const aff = affiliation.toLowerCase();
  
  const countryPatterns: [RegExp, string][] = [
    [/\busa\b|\bunited states\b|\bu\.s\.a?\b/, "United States"],
    [/\buk\b|\bunited kingdom\b|\bengland\b|\bscotland\b|\bwales\b/, "United Kingdom"],
    [/\bgermany\b|\bdeutschland\b/, "Germany"],
    [/\bfrance\b/, "France"],
    [/\bitaly\b|\bitalia\b/, "Italy"],
    [/\bspain\b|\bespaña\b/, "Spain"],
    [/\bcanada\b/, "Canada"],
    [/\baustralia\b/, "Australia"],
    [/\bjapan\b/, "Japan"],
    [/\bchina\b|\bbeijing\b|\bshanghai\b/, "China"],
    [/\bsouth korea\b|\bkorea\b|\bseoul\b/, "South Korea"],
    [/\bnetherlands\b|\bholland\b/, "Netherlands"],
    [/\bswitzerland\b|\bschweiz\b/, "Switzerland"],
    [/\bsweden\b/, "Sweden"],
    [/\bdenmark\b/, "Denmark"],
    [/\bnorway\b/, "Norway"],
    [/\bfinland\b/, "Finland"],
    [/\bbelgium\b/, "Belgium"],
    [/\baustria\b/, "Austria"],
    [/\bportugal\b/, "Portugal"],
    [/\bpoland\b/, "Poland"],
    [/\bireland\b/, "Ireland"],
    [/\bisrael\b/, "Israel"],
    [/\bsingapore\b/, "Singapore"],
    [/\bindia\b/, "India"],
    [/\bbrazil\b/, "Brazil"],
    [/\bmexico\b/, "Mexico"],
    [/\bargentina\b/, "Argentina"],
    [/\bsouth africa\b/, "South Africa"],
    [/\bnew zealand\b/, "New Zealand"],
    [/\brussia\b/, "Russia"],
    [/\bturkey\b/, "Turkey"],
    [/\bgreece\b/, "Greece"],
    [/\btaiwan\b/, "Taiwan"],
    [/\bhong kong\b/, "Hong Kong"],
  ];
  
  for (const [pattern, country] of countryPatterns) {
    if (pattern.test(aff)) {
      return country;
    }
  }
  
  return "Unknown";
}
