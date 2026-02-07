/**
 * DBLP API Client
 * 
 * Provides access to the DBLP computer science bibliography database
 * for COI detection via co-authorship analysis.
 * 
 * API Docs: https://dblp.org/faq/How+to+use+the+dblp+search+API.html
 * 
 * Inspired by: https://github.com/Hanchen-Wang/COI_checker (MIT license)
 * Adapted for TypeScript and integrated into Publimentor's COI pipeline.
 */

const DBLP_API_BASE = "https://dblp.org/search";
const DBLP_AUTHOR_API = "https://dblp.org/pid";

// Rate limiting: DBLP asks for max 1 request per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 1100; // 1.1s between requests

async function throttledFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
  
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "PubliMentor/1.0 (editorial-workflow-tool; contact@publimentor.io)",
    },
  });
  
  if (!response.ok) {
    throw new Error(`DBLP API error: ${response.status} ${response.statusText}`);
  }
  
  return response;
}

// --- Types ---

export interface DBLPAuthor {
  pid: string;         // DBLP person ID (e.g., "h/JamesHaber")
  name: string;        // Display name
  url: string;         // DBLP profile URL
  aliases?: string[];  // Alternative names
  affiliation?: string;
  notes?: { text: string; type: string }[];
}

export interface DBLPPublication {
  key: string;         // DBLP entry key
  title: string;
  authors: string[];
  year: number;
  venue: string;       // Journal or conference name
  type: string;        // "article", "inproceedings", "book", etc.
  doi?: string;
  url?: string;
  ee?: string;         // Electronic edition URL
}

export interface DBLPCoauthorship {
  coauthorName: string;
  coauthorPid: string;
  sharedPublications: DBLPPublication[];
  publicationCount: number;
  yearRange: { first: number; last: number };
}

// --- API Functions ---

/**
 * Search for an author by name in DBLP
 */
export async function searchAuthor(name: string, maxResults: number = 10): Promise<DBLPAuthor[]> {
  const encodedName = encodeURIComponent(name);
  const url = `${DBLP_API_BASE}/author/api?q=${encodedName}&format=json&h=${maxResults}`;
  
  const response = await throttledFetch(url);
  const data = await response.json();
  
  if (!data.result?.hits?.hit) {
    return [];
  }
  
  const hits = Array.isArray(data.result.hits.hit) 
    ? data.result.hits.hit 
    : [data.result.hits.hit];
  
  return hits.map((hit: Record<string, unknown>) => {
    const info = hit.info as Record<string, unknown>;
    const aliases = info.aliases 
      ? (typeof (info.aliases as Record<string, unknown>).alias === "string"
          ? [(info.aliases as Record<string, unknown>).alias as string]
          : ((info.aliases as Record<string, unknown>).alias as string[]) || [])
      : [];
    
    const notes = info.notes 
      ? (typeof (info.notes as Record<string, unknown>).note === "object" && !Array.isArray((info.notes as Record<string, unknown>).note)
          ? [(info.notes as Record<string, unknown>).note as { text: string; type: string }]
          : ((info.notes as Record<string, unknown>).note as { text: string; type: string }[]) || [])
      : [];
    
    return {
      pid: (info.url as string || "").replace("https://dblp.org/pid/", ""),
      name: info.author as string || "",
      url: info.url as string || "",
      aliases,
      notes,
    };
  });
}

/**
 * Get all publications for a DBLP author by PID
 */
export async function getAuthorPublications(
  pid: string, 
  fromYear?: number,
  maxResults: number = 200
): Promise<DBLPPublication[]> {
  // Fetch publications via DBLP search API scoped to the author
  const url = `${DBLP_AUTHOR_API}/${pid}.xml?view=bibtex`;
  
  // Use the search API instead which returns JSON
  const searchUrl = `${DBLP_API_BASE}/publ/api?q=author:${encodeURIComponent(pid)}&format=json&h=${maxResults}`;
  
  const response = await throttledFetch(searchUrl);
  const data = await response.json();
  
  if (!data.result?.hits?.hit) {
    return [];
  }
  
  const hits = Array.isArray(data.result.hits.hit) 
    ? data.result.hits.hit 
    : [data.result.hits.hit];
  
  const publications: DBLPPublication[] = [];
  
  for (const hit of hits) {
    const info = hit.info as Record<string, unknown>;
    const year = parseInt(info.year as string, 10);
    
    // Skip if before fromYear filter
    if (fromYear && year < fromYear) continue;
    
    // Parse authors - can be string or array
    const authorsRaw = (info.authors as Record<string, unknown>)?.author;
    let authors: string[] = [];
    if (typeof authorsRaw === "string") {
      authors = [authorsRaw];
    } else if (Array.isArray(authorsRaw)) {
      authors = authorsRaw.map((a: unknown) => {
        if (typeof a === "string") return a;
        if (typeof a === "object" && a !== null && "text" in a) return (a as { text: string }).text;
        return String(a);
      });
    }
    
    publications.push({
      key: info.key as string || "",
      title: info.title as string || "",
      authors,
      year,
      venue: (info.venue as string) || "",
      type: (info.type as string) || "article",
      doi: info.doi as string | undefined,
      url: info.url as string | undefined,
      ee: info.ee as string | undefined,
    });
  }
  
  return publications;
}

/**
 * Find co-authored publications between two authors
 * 
 * This is the core function used for COI detection.
 * It finds publications where both authors appear as co-authors.
 */
export async function findCoauthoredPublications(
  authorName1: string,
  authorName2: string,
  fromYear?: number
): Promise<DBLPPublication[]> {
  // Search for publications co-authored by both
  const query = `${authorName1} ${authorName2}`;
  const encodedQuery = encodeURIComponent(query);
  const url = `${DBLP_API_BASE}/publ/api?q=${encodedQuery}&format=json&h=50`;
  
  const response = await throttledFetch(url);
  const data = await response.json();
  
  if (!data.result?.hits?.hit) {
    return [];
  }
  
  const hits = Array.isArray(data.result.hits.hit) 
    ? data.result.hits.hit 
    : [data.result.hits.hit];
  
  const coauthored: DBLPPublication[] = [];
  const name1Lower = authorName1.toLowerCase();
  const name2Lower = authorName2.toLowerCase();
  
  for (const hit of hits) {
    const info = hit.info as Record<string, unknown>;
    const year = parseInt(info.year as string, 10);
    
    if (fromYear && year < fromYear) continue;
    
    // Parse authors
    const authorsRaw = (info.authors as Record<string, unknown>)?.author;
    let authors: string[] = [];
    if (typeof authorsRaw === "string") {
      authors = [authorsRaw];
    } else if (Array.isArray(authorsRaw)) {
      authors = authorsRaw.map((a: unknown) => {
        if (typeof a === "string") return a;
        if (typeof a === "object" && a !== null && "text" in a) return (a as { text: string }).text;
        return String(a);
      });
    }
    
    // Check if both authors appear in the author list
    const authorsLower = authors.map((a) => a.toLowerCase());
    const hasAuthor1 = authorsLower.some(
      (a) => a.includes(name1Lower) || name1Lower.includes(a)
    );
    const hasAuthor2 = authorsLower.some(
      (a) => a.includes(name2Lower) || name2Lower.includes(a)
    );
    
    if (hasAuthor1 && hasAuthor2) {
      coauthored.push({
        key: info.key as string || "",
        title: info.title as string || "",
        authors,
        year,
        venue: (info.venue as string) || "",
        type: (info.type as string) || "article",
        doi: info.doi as string | undefined,
        url: info.url as string | undefined,
        ee: info.ee as string | undefined,
      });
    }
  }
  
  return coauthored;
}

/**
 * Check if two researchers have co-authored papers (simple boolean check)
 */
export async function hasCoauthorship(
  authorName1: string,
  authorName2: string,
  fromYear?: number
): Promise<boolean> {
  const coauthored = await findCoauthoredPublications(authorName1, authorName2, fromYear);
  return coauthored.length > 0;
}

export const dblp = {
  searchAuthor,
  getAuthorPublications,
  findCoauthoredPublications,
  hasCoauthorship,
};

export default dblp;
