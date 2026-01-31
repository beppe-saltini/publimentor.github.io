/**
 * LLM Service using Anthropic Claude API
 * For intelligent reviewer selection and ranking
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

interface ReviewerForAnalysis {
  name: string;
  affiliation: string;
  country: string;
  publicationCount: number;
  firstAuthorCount: number;
  lastAuthorCount: number;
  recentArticles: {
    title: string;
    journal: string;
    position: string;
  }[];
}

interface RankedReviewer {
  name: string;
  relevanceScore: number; // 0-100
  reasoning: string;
  topicalMatch: "excellent" | "good" | "moderate" | "weak";
  seniorityAssessment: string;
  recommendation: "highly_recommended" | "recommended" | "consider" | "not_recommended";
}

interface LLMRankingResult {
  rankedReviewers: RankedReviewer[];
  searchQuality: string;
  suggestions: string[];
}

interface SuggestedReviewer {
  name: string;
  affiliation: string;
  country: string;
  expertise: string[];
  reasoning: string;
  estimatedSeniority: "senior" | "mid-career" | "early-career";
  searchTerms: string[]; // Terms to verify in PubMed
}

interface LLMSuggestionResult {
  reviewers: SuggestedReviewer[];
  searchStrategy: string;
  caveats: string[];
}

/**
 * Use Claude to SUGGEST potential reviewers based on research area
 * This is the PRIMARY source - Claude uses its knowledge to suggest experts
 */
export async function suggestReviewersWithLLM(
  primaryKeywords: string[],
  secondaryKeywords: string[] | undefined,
  excludeAuthors: string[],
  count: number = 15,
  constraints: {
    requireSenior?: boolean;
    diversifyGeography?: boolean;
    diversifyInstitutions?: boolean;
  } = {}
): Promise<LLMSuggestionResult | null> {
  if (!ANTHROPIC_API_KEY) {
    console.log("[LLM] No Anthropic API key configured");
    return null;
  }

  const prompt = `You are an expert academic editor with deep knowledge of researchers across scientific fields.

## Task
Suggest ${count} potential peer reviewers who are experts in the following research area:

**Primary expertise needed:** ${primaryKeywords.join(", ")}
${secondaryKeywords?.length ? `**Secondary/additional expertise:** ${secondaryKeywords.join(", ")}` : ""}

${excludeAuthors.length > 0 ? `**Exclude these authors (manuscript authors):** ${excludeAuthors.join(", ")}` : ""}

## Constraints
${constraints.requireSenior ? "- Focus on SENIOR researchers (established PIs, professors, h-index typically >20)" : "- Include a mix of senior and mid-career researchers"}
${constraints.diversifyGeography ? "- DIVERSIFY geographically across different countries" : ""}
${constraints.diversifyInstitutions ? "- Suggest researchers from DIFFERENT institutions (no duplicates)" : ""}

## Important Guidelines
1. Suggest REAL researchers who are actively publishing in this field
2. Include their current institutional affiliation
3. Provide specific expertise areas
4. For each, suggest 2-3 search terms that would find their publications in PubMed
5. Focus on researchers who would be independent (not likely collaborators of excluded authors)

## Response Format (JSON only)
Respond with ONLY a valid JSON object:
{
  "reviewers": [
    {
      "name": "Full Name (as appears in publications)",
      "affiliation": "University/Institution, City, Country",
      "country": "Country",
      "expertise": ["specific area 1", "specific area 2"],
      "reasoning": "Why this person is a good reviewer for this topic",
      "estimatedSeniority": "senior|mid-career|early-career",
      "searchTerms": ["Author Name[Author]", "alternative spelling[Author]"]
    }
  ],
  "searchStrategy": "Brief explanation of how you selected these reviewers",
  "caveats": ["Any important caveats about the suggestions"]
}`;

  try {
    console.log("[LLM] Asking Claude to suggest reviewers...");
    
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LLM] API error:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;

    if (!content) {
      console.error("[LLM] No content in response");
      return null;
    }

    // Parse JSON from response
    let jsonStr = content;
    if (content.includes("```json")) {
      jsonStr = content.split("```json")[1].split("```")[0].trim();
    } else if (content.includes("```")) {
      jsonStr = content.split("```")[1].split("```")[0].trim();
    }

    const result: LLMSuggestionResult = JSON.parse(jsonStr);
    console.log(`[LLM] Claude suggested ${result.reviewers.length} potential reviewers`);
    
    return result;
  } catch (error) {
    console.error("[LLM] Error calling Claude API:", error);
    return null;
  }
}

/**
 * Use Claude to analyze and rank reviewer candidates
 */
export async function rankReviewersWithLLM(
  primaryKeywords: string[],
  secondaryKeywords: string[] | undefined,
  candidates: ReviewerForAnalysis[],
  maxResults: number = 10
): Promise<LLMRankingResult | null> {
  if (!ANTHROPIC_API_KEY) {
    console.log("[LLM] No Anthropic API key configured, skipping LLM ranking");
    return null;
  }

  if (candidates.length === 0) {
    return null;
  }

  // Prepare candidate summaries for the prompt
  const candidateSummaries = candidates.slice(0, 30).map((c, i) => {
    const articles = c.recentArticles.slice(0, 3)
      .map(a => `"${a.title}" (${a.journal}, ${a.position} author)`)
      .join("; ");
    
    return `${i + 1}. ${c.name}
   - Affiliation: ${c.affiliation}, ${c.country}
   - Publications: ${c.publicationCount} total, ${c.firstAuthorCount} as first author, ${c.lastAuthorCount} as last/PI
   - Recent articles: ${articles || "N/A"}`;
  }).join("\n\n");

  const prompt = `You are an expert academic editor helping to identify suitable peer reviewers for a scientific manuscript.

## Search Criteria
Primary expertise needed: ${primaryKeywords.join(", ")}
${secondaryKeywords?.length ? `Secondary/additional expertise: ${secondaryKeywords.join(", ")}` : ""}

## Candidate Reviewers (from PubMed search)
${candidateSummaries}

## Your Task
Analyze each candidate and determine their suitability as a reviewer based on:
1. **Topical relevance**: Do their publications match the required expertise?
2. **Seniority**: Are they established researchers (look at last/PI author papers)?
3. **Active research**: Recent publications in the field?
4. **Independence**: Diverse institutions are preferred

Rank the top ${Math.min(maxResults, candidates.length)} candidates.

## Response Format (JSON only)
Respond with ONLY a valid JSON object in this exact format:
{
  "rankedReviewers": [
    {
      "name": "Full Name",
      "relevanceScore": 85,
      "reasoning": "Brief explanation of why this person is suitable",
      "topicalMatch": "excellent|good|moderate|weak",
      "seniorityAssessment": "Brief assessment of their seniority level",
      "recommendation": "highly_recommended|recommended|consider|not_recommended"
    }
  ],
  "searchQuality": "Assessment of the overall candidate pool quality",
  "suggestions": ["Any suggestions to improve the search"]
}

Only include candidates with relevanceScore >= 50. Order by relevanceScore descending.`;

  try {
    console.log("[LLM] Calling Claude API for reviewer ranking...");
    
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LLM] API error:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;

    if (!content) {
      console.error("[LLM] No content in response");
      return null;
    }

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = content;
    if (content.includes("```json")) {
      jsonStr = content.split("```json")[1].split("```")[0].trim();
    } else if (content.includes("```")) {
      jsonStr = content.split("```")[1].split("```")[0].trim();
    }

    const result: LLMRankingResult = JSON.parse(jsonStr);
    console.log(`[LLM] Ranked ${result.rankedReviewers.length} reviewers`);
    
    return result;
  } catch (error) {
    console.error("[LLM] Error calling Claude API:", error);
    return null;
  }
}

/**
 * Use Claude to generate a reviewer invitation email
 */
export async function generateReviewerInvitation(
  reviewerName: string,
  manuscriptTitle: string,
  journalName: string,
  expertise: string[]
): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) {
    return null;
  }

  const prompt = `Write a brief, professional peer review invitation email.

Reviewer: ${reviewerName}
Manuscript topic: ${manuscriptTitle}
Journal: ${journalName}
Reviewer's expertise: ${expertise.join(", ")}

Write a concise 3-4 paragraph invitation that:
1. Addresses them by name
2. Briefly explains why they were selected (based on their expertise)
3. Mentions the manuscript topic
4. Includes a polite request with typical review timeline

Keep it professional but warm. Do not include subject line or sign-off placeholders.`;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.content?.[0]?.text || null;
  } catch (error) {
    console.error("[LLM] Error generating invitation:", error);
    return null;
  }
}
