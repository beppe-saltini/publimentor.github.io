/**
 * Semantic Scholar API client
 * Free API with H-index and citation data
 * https://api.semanticscholar.org/
 */

const SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1";

// Rate limiting: 100 requests per 5 minutes for unauthenticated
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface SemanticScholarAuthor {
  authorId: string;
  name: string;
  url: string;
  affiliations: string[];
  homepage: string | null;
  paperCount: number;
  citationCount: number;
  hIndex: number;
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

/**
 * Search for an author by name
 */
export async function searchAuthor(name: string): Promise<SemanticScholarAuthor | null> {
  try {
    const encodedName = encodeURIComponent(name);
    const url = `${SEMANTIC_SCHOLAR_API}/author/search?query=${encodedName}&fields=authorId,name,url,affiliations,homepage,paperCount,citationCount,hIndex&limit=5`;
    
    console.log(`[SemanticScholar] Searching for author: ${name}`);
    
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.log("[SemanticScholar] Rate limited, waiting...");
        await delay(2000);
        return searchAuthor(name); // Retry once
      }
      console.error(`[SemanticScholar] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      console.log(`[SemanticScholar] No results for: ${name}`);
      return null;
    }

    // Find best match (exact or closest name match)
    const nameLower = name.toLowerCase();
    const bestMatch = data.data.find((a: SemanticScholarAuthor) => 
      a.name.toLowerCase() === nameLower
    ) || data.data[0];

    console.log(`[SemanticScholar] Found: ${bestMatch.name} (H-index: ${bestMatch.hIndex}, papers: ${bestMatch.paperCount})`);
    
    return bestMatch;
  } catch (error) {
    console.error("[SemanticScholar] Error searching author:", error);
    return null;
  }
}

/**
 * Get author details by ID
 */
export async function getAuthorById(authorId: string): Promise<SemanticScholarAuthor | null> {
  try {
    const url = `${SEMANTIC_SCHOLAR_API}/author/${authorId}?fields=authorId,name,url,affiliations,homepage,paperCount,citationCount,hIndex`;
    
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
      },
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
      headers: {
        "Accept": "application/json",
      },
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
