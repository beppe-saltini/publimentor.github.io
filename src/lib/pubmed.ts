/**
 * PubMed E-utilities API Client
 * Searches PubMed and retrieves author information
 */

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const EMAIL = process.env.PUBMED_EMAIL || process.env.OPENALEX_EMAIL || "";

export interface PubMedAuthor {
  lastName: string;
  foreName: string;
  initials: string;
  affiliation?: string;
  fullName: string;
}

export interface PubMedArticle {
  pmid: string;
  title: string;
  authors: PubMedAuthor[];
  journal: string;
  pubDate: string;
  doi?: string;
}

interface ESearchResult {
  esearchresult: {
    count: string;
    idlist: string[];
    querytranslation?: string;
  };
}

interface EFetchResult {
  PubmedArticleSet?: {
    PubmedArticle?: PubmedArticle[];
  };
}

interface PubmedArticle {
  MedlineCitation: {
    PMID: { _text: string } | string;
    Article: {
      ArticleTitle: { _text: string } | string;
      AuthorList?: {
        Author?: Author | Author[];
      };
      Journal?: {
        Title?: { _text: string } | string;
      };
      ArticleDate?: {
        Year?: { _text: string } | string;
        Month?: { _text: string } | string;
        Day?: { _text: string } | string;
      };
    };
  };
  PubmedData?: {
    ArticleIdList?: {
      ArticleId?: ArticleId | ArticleId[];
    };
  };
}

interface Author {
  LastName?: { _text: string } | string;
  ForeName?: { _text: string } | string;
  Initials?: { _text: string } | string;
  AffiliationInfo?: {
    Affiliation?: { _text: string } | string;
  };
}

interface ArticleId {
  _attributes?: { IdType: string };
  _text?: string;
}

/**
 * Extract text from PubMed XML field (handles both string and object formats)
 */
function getText(field: { _text: string } | string | undefined): string {
  if (!field) return "";
  if (typeof field === "string") return field;
  return field._text || "";
}

/**
 * Search PubMed for articles matching a query
 */
export async function searchPubMed(
  query: string,
  maxResults: number = 20
): Promise<string[]> {
  const params = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmax: String(maxResults),
    retmode: "json",
    sort: "relevance",
    ...(EMAIL && { email: EMAIL }),
  });

  const response = await fetch(`${EUTILS_BASE}/esearch.fcgi?${params}`);
  
  if (!response.ok) {
    throw new Error(`PubMed search failed: ${response.statusText}`);
  }

  const data: ESearchResult = await response.json();
  return data.esearchresult?.idlist || [];
}

/**
 * Fetch article details from PubMed by PMIDs
 */
export async function fetchPubMedArticles(
  pmids: string[]
): Promise<PubMedArticle[]> {
  if (pmids.length === 0) return [];

  const params = new URLSearchParams({
    db: "pubmed",
    id: pmids.join(","),
    retmode: "xml",
    rettype: "abstract",
    ...(EMAIL && { email: EMAIL }),
  });

  const response = await fetch(`${EUTILS_BASE}/efetch.fcgi?${params}`);
  
  if (!response.ok) {
    throw new Error(`PubMed fetch failed: ${response.statusText}`);
  }

  const xmlText = await response.text();
  return parsePubMedXml(xmlText);
}

/**
 * Parse PubMed XML response into structured articles
 */
function parsePubMedXml(xmlText: string): PubMedArticle[] {
  const articles: PubMedArticle[] = [];
  
  // Simple XML parsing for PubMed response
  const articleMatches = xmlText.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g);
  
  for (const match of articleMatches) {
    const articleXml = match[1];
    
    // Extract PMID
    const pmidMatch = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const pmid = pmidMatch?.[1] || "";
    
    // Extract title
    const titleMatch = articleXml.match(/<ArticleTitle>([^<]+)<\/ArticleTitle>/);
    const title = titleMatch?.[1] || "";
    
    // Extract journal
    const journalMatch = articleXml.match(/<Title>([^<]+)<\/Title>/);
    const journal = journalMatch?.[1] || "";
    
    // Extract publication date
    const yearMatch = articleXml.match(/<Year>(\d+)<\/Year>/);
    const pubDate = yearMatch?.[1] || "";
    
    // Extract DOI
    const doiMatch = articleXml.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/);
    const doi = doiMatch?.[1];
    
    // Extract authors
    const authors: PubMedAuthor[] = [];
    const authorMatches = articleXml.matchAll(/<Author[^>]*>([\s\S]*?)<\/Author>/g);
    
    for (const authorMatch of authorMatches) {
      const authorXml = authorMatch[1];
      
      const lastNameMatch = authorXml.match(/<LastName>([^<]+)<\/LastName>/);
      const foreNameMatch = authorXml.match(/<ForeName>([^<]+)<\/ForeName>/);
      const initialsMatch = authorXml.match(/<Initials>([^<]+)<\/Initials>/);
      const affiliationMatch = authorXml.match(/<Affiliation>([^<]+)<\/Affiliation>/);
      
      const lastName = lastNameMatch?.[1] || "";
      const foreName = foreNameMatch?.[1] || "";
      const initials = initialsMatch?.[1] || "";
      
      if (lastName) {
        authors.push({
          lastName,
          foreName,
          initials,
          affiliation: affiliationMatch?.[1],
          fullName: foreName ? `${foreName} ${lastName}` : lastName,
        });
      }
    }
    
    if (pmid && authors.length > 0) {
      articles.push({
        pmid,
        title,
        authors,
        journal,
        pubDate,
        doi,
      });
    }
  }
  
  return articles;
}

/**
 * Find potential reviewers by searching for experts in a topic
 * Returns unique authors from relevant publications
 */
export async function findReviewersByTopic(
  keywords: string[],
  excludeAuthors: string[] = [],
  maxResults: number = 50
): Promise<PubMedAuthor[]> {
  // Build search query
  const query = keywords.map(k => `"${k}"[Title/Abstract]`).join(" OR ");
  
  // Search PubMed
  const pmids = await searchPubMed(query, maxResults);
  
  if (pmids.length === 0) return [];
  
  // Fetch article details
  const articles = await fetchPubMedArticles(pmids);
  
  // Extract unique authors
  const authorMap = new Map<string, PubMedAuthor>();
  const excludeSet = new Set(excludeAuthors.map(a => a.toLowerCase()));
  
  for (const article of articles) {
    for (const author of article.authors) {
      const key = `${author.lastName.toLowerCase()}_${author.foreName.toLowerCase()}`;
      
      // Skip if already in map or in exclude list
      if (authorMap.has(key)) continue;
      if (excludeSet.has(author.fullName.toLowerCase())) continue;
      if (excludeSet.has(author.lastName.toLowerCase())) continue;
      
      authorMap.set(key, author);
    }
  }
  
  return Array.from(authorMap.values());
}

/**
 * Find co-authors of specific authors to check for COI
 */
export async function findCoAuthors(
  authorName: string,
  years: number = 5
): Promise<{ author: PubMedAuthor; coauthorCount: number }[]> {
  // Search for publications by this author
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - years;
  
  const query = `${authorName}[Author] AND ${startYear}:${currentYear}[Date - Publication]`;
  const pmids = await searchPubMed(query, 100);
  
  if (pmids.length === 0) return [];
  
  const articles = await fetchPubMedArticles(pmids);
  
  // Count co-author occurrences
  const coauthorCounts = new Map<string, { author: PubMedAuthor; count: number }>();
  const authorLower = authorName.toLowerCase();
  
  for (const article of articles) {
    for (const author of article.authors) {
      // Skip the author themselves
      if (author.fullName.toLowerCase().includes(authorLower) ||
          authorLower.includes(author.lastName.toLowerCase())) {
        continue;
      }
      
      const key = `${author.lastName.toLowerCase()}_${author.foreName.toLowerCase()}`;
      const existing = coauthorCounts.get(key);
      
      if (existing) {
        existing.count++;
      } else {
        coauthorCounts.set(key, { author, count: 1 });
      }
    }
  }
  
  // Sort by co-authorship count
  return Array.from(coauthorCounts.values())
    .map(({ author, count }) => ({ author, coauthorCount: count }))
    .sort((a, b) => b.coauthorCount - a.coauthorCount);
}

/**
 * Search PubMed for papers matching a query and return structured results
 */
export async function searchPubMedArticles(
  query: string,
  maxResults: number = 20
): Promise<PubMedArticle[]> {
  const pmids = await searchPubMed(query, maxResults);
  return fetchPubMedArticles(pmids);
}
