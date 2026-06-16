/**
 * Semantic Scholar API client
 * Free API with H-index and citation data
 * https://api.semanticscholar.org/
 *
 * IMPORTANT: Semantic Scholar often fragments prolific authors across
 * multiple profiles. Always prefer OpenAlex h-index when available and
 * cross-validate with publication count.
 */

const SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1";

// Rate limiting: 100 requests per 5 minutes for unauthenticated
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function semanticScholarHeaders(): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

export interface SemanticScholarAuthor {
  authorId: string;
  name: string;
  url: string;
  affiliations: string[];
  homepage: string | null;
  paperCount: number;
  citationCount: number;
  hIndex: number;
  externalIds?: {
    ORCID?: string;
    DBLP?: string;
  };
}

export interface SemanticScholarPaper {
  paperId: string;
  title: string;
  year: number;
  citationCount: number;
  journal?: {
    name: string;
  };
  authors: {
    authorId: string;
    name: string;
  }[];
}

const AUTHOR_FIELDS = "authorId,name,url,affiliations,homepage,paperCount,citationCount,hIndex,externalIds";

/**
 * Pick the best author match from a list of candidates.
 *
 * Strategy:
 *  1. Exact name match with highest paperCount (avoids stub profiles)
 *  2. If no exact match, pick the candidate with the highest paperCount
 *     (more reliable than hIndex which can be 0 on fragmented profiles)
 *  3. If an expectedMinPapers hint is provided (e.g. from OpenAlex),
 *     prefer candidates whose paperCount is in the same ballpark.
 */
function pickBestMatch(
  candidates: SemanticScholarAuthor[],
  queryName: string,
  expectedMinPapers?: number,
): SemanticScholarAuthor {
  if (candidates.length === 1) return candidates[0];

  const nameLower = queryName.toLowerCase().trim();

  // Score each candidate
  const scored = candidates.map(c => {
    let score = 0;
    const cName = c.name.toLowerCase().trim();

    // Exact name match bonus
    if (cName === nameLower) score += 10000;

    // Partial / contains bonus (e.g. "T. Mak" inside "Tak W. Mak")
    if (cName.includes(nameLower) || nameLower.includes(cName)) score += 1000;

    // Primary sort: paperCount (most reliable disambiguation signal)
    score += c.paperCount;

    // If we have an expected publication count, boost candidates close to it
    if (expectedMinPapers && expectedMinPapers > 0) {
      const ratio = c.paperCount / expectedMinPapers;
      // Within 0.3x–3x of expected → big bonus
      if (ratio >= 0.3 && ratio <= 3) score += 5000;
    }

    return { author: c, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored[0].author;
}

/**
 * Search for an author by name.
 * Returns the best matching profile (highest paperCount among name matches).
 *
 * @param expectedMinPapers - Optional hint from OpenAlex to help disambiguation
 */
export async function searchAuthor(
  name: string,
  expectedMinPapers?: number,
): Promise<SemanticScholarAuthor | null> {
  try {
    const encodedName = encodeURIComponent(name);
    // Fetch more results (20) to improve disambiguation for common names
    const url = `${SEMANTIC_SCHOLAR_API}/author/search?query=${encodedName}&fields=${AUTHOR_FIELDS}&limit=20`;
    
    console.log(`[SemanticScholar] Searching for author: ${name}`);
    
    const response = await fetch(url, {
      headers: semanticScholarHeaders(),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.log("[SemanticScholar] Rate limited, waiting...");
        await delay(2000);
        return searchAuthor(name, expectedMinPapers); // Retry once
      }
      console.error(`[SemanticScholar] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      console.log(`[SemanticScholar] No results for: ${name}`);
      return null;
    }

    const bestMatch = pickBestMatch(data.data, name, expectedMinPapers);

    console.log(
      `[SemanticScholar] Best match for "${name}": ${bestMatch.name} ` +
      `(H-index: ${bestMatch.hIndex}, papers: ${bestMatch.paperCount}, ` +
      `citations: ${bestMatch.citationCount}) [from ${data.data.length} candidates]`
    );
    
    return bestMatch;
  } catch (error) {
    console.error("[SemanticScholar] Error searching author:", error);
    return null;
  }
}

/**
 * Search for an author by ORCID (most reliable disambiguation).
 */
export async function searchAuthorByOrcid(orcid: string): Promise<SemanticScholarAuthor | null> {
  try {
    // Semantic Scholar supports ORCID-based lookup via the external IDs endpoint
    const cleanOrcid = orcid.replace("https://orcid.org/", "");
    const url = `${SEMANTIC_SCHOLAR_API}/author/ORCID:${cleanOrcid}?fields=${AUTHOR_FIELDS}`;

    console.log(`[SemanticScholar] Looking up ORCID: ${cleanOrcid}`);

    const response = await fetch(url, {
      headers: semanticScholarHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[SemanticScholar] No author found for ORCID: ${cleanOrcid}`);
        return null;
      }
      if (response.status === 429) {
        await delay(2000);
        return searchAuthorByOrcid(orcid);
      }
      console.error(`[SemanticScholar] ORCID lookup error: ${response.status}`);
      return null;
    }

    const author: SemanticScholarAuthor = await response.json();
    console.log(
      `[SemanticScholar] ORCID match: ${author.name} ` +
      `(H-index: ${author.hIndex}, papers: ${author.paperCount})`
    );
    return author;
  } catch (error) {
    console.error("[SemanticScholar] Error looking up ORCID:", error);
    return null;
  }
}

/**
 * Get author details by ID
 */
export async function getAuthorById(authorId: string): Promise<SemanticScholarAuthor | null> {
  try {
    const url = `${SEMANTIC_SCHOLAR_API}/author/${authorId}?fields=${AUTHOR_FIELDS}`;
    
    const response = await fetch(url, {
      headers: semanticScholarHeaders(),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("[SemanticScholar] Error getting author:", error);
    return null;
  }
}

/**
 * Get author's recent papers
 */
export async function getAuthorPapers(
  authorId: string, 
  limit: number = 10
): Promise<SemanticScholarPaper[]> {
  try {
    const url = `${SEMANTIC_SCHOLAR_API}/author/${authorId}/papers?fields=paperId,title,year,citationCount,journal,authors&limit=${limit}`;
    
    const response = await fetch(url, {
      headers: semanticScholarHeaders(),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error("[SemanticScholar] Error getting papers:", error);
    return [];
  }
}

/**
 * Batch lookup authors (with rate limiting)
 */
export async function batchLookupAuthors(
  names: string[]
): Promise<Map<string, SemanticScholarAuthor>> {
  const results = new Map<string, SemanticScholarAuthor>();
  
  for (const name of names) {
    const author = await searchAuthor(name);
    if (author) {
      results.set(name, author);
    }
    // Rate limiting: wait between requests
    await delay(200);
  }
  
  return results;
}
