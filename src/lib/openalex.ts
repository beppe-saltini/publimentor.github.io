import type { OpenAlexAuthor, OpenAlexWork, OpenAlexSearchResponse } from "@/types";

const BASE_URL = "https://api.openalex.org";

// Get email for polite pool (higher rate limits)
const getPoliteEmail = () => process.env.OPENALEX_EMAIL || "";

interface SearchAuthorsParams {
  query: string;
  page?: number;
  perPage?: number;
  minWorksCount?: number;
  institution?: string;
}

interface SearchWorksParams {
  authorId?: string;
  authorIds?: string[];
  query?: string;
  page?: number;
  perPage?: number;
}

export interface OpenAlexSourceResult {
  id: string;
  display_name: string;
  type: string;
  publisher: string;
  is_oa: boolean;
  is_in_doaj: boolean;
  works_count: number;
  cited_by_count: number;
  h_index: number;
  impact_factor: number | null;
  homepage_url?: string;
  apc_usd?: number;
  issn_l: string | null;
  country_code: string | null;
}

/**
 * OpenAlex API Client
 * Documentation: https://docs.openalex.org/
 */
export const openAlex = {
  /**
   * Search for authors by name or research topic
   */
  async searchAuthors({
    query,
    page = 1,
    perPage = 25,
    minWorksCount = 5,
    institution,
  }: SearchAuthorsParams): Promise<OpenAlexSearchResponse<OpenAlexAuthor>> {
    const params = new URLSearchParams({
      search: query,
      page: String(page),
      per_page: String(perPage),
      filter: `works_count:>${minWorksCount}`,
    });

    if (institution) {
      params.set("filter", `${params.get("filter")},last_known_institutions.display_name.search:${institution}`);
    }

    const email = getPoliteEmail();
    if (email) {
      params.set("mailto", email);
    }

    const response = await fetch(`${BASE_URL}/authors?${params}`);

    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.statusText}`);
    }

    return response.json();
  },

  /**
   * Get author by OpenAlex ID
   */
  async getAuthor(authorId: string): Promise<OpenAlexAuthor> {
    const params = new URLSearchParams();
    const email = getPoliteEmail();
    if (email) {
      params.set("mailto", email);
    }

    const response = await fetch(`${BASE_URL}/authors/${authorId}?${params}`);

    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.statusText}`);
    }

    return response.json();
  },

  /**
   * Get author by ORCID
   */
  async getAuthorByOrcid(orcid: string): Promise<OpenAlexAuthor | null> {
    const params = new URLSearchParams({
      filter: `orcid:${orcid}`,
    });

    const email = getPoliteEmail();
    if (email) {
      params.set("mailto", email);
    }

    const response = await fetch(`${BASE_URL}/authors?${params}`);

    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.statusText}`);
    }

    const data: OpenAlexSearchResponse<OpenAlexAuthor> = await response.json();
    return data.results[0] || null;
  },

  /**
   * Search for works (publications)
   */
  async searchWorks({
    authorId,
    authorIds,
    query,
    page = 1,
    perPage = 50,
  }: SearchWorksParams): Promise<OpenAlexSearchResponse<OpenAlexWork>> {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });

    const filters: string[] = [];

    if (authorId) {
      filters.push(`authorships.author.id:${authorId}`);
    }

    if (authorIds && authorIds.length > 0) {
      // Filter for works that have ALL these authors (co-authored)
      authorIds.forEach((id) => {
        filters.push(`authorships.author.id:${id}`);
      });
    }

    if (query) {
      params.set("search", query);
    }

    if (filters.length > 0) {
      params.set("filter", filters.join(","));
    }

    const email = getPoliteEmail();
    if (email) {
      params.set("mailto", email);
    }

    const response = await fetch(`${BASE_URL}/works?${params}`);

    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.statusText}`);
    }

    return response.json();
  },

  /**
   * Get works by a specific author
   */
  async getAuthorWorks(
    authorId: string,
    page = 1,
    perPage = 100
  ): Promise<OpenAlexSearchResponse<OpenAlexWork>> {
    return this.searchWorks({ authorId, page, perPage });
  },

  /**
   * Find co-authored works between two authors
   * @param authorId1 - First author's OpenAlex ID
   * @param authorId2 - Second author's OpenAlex ID
   * @param fromYear - Optional: only include papers from this year onwards
   */
  async findCoauthoredWorks(
    authorId1: string,
    authorId2: string,
    fromYear?: number
  ): Promise<OpenAlexWork[]> {
    const filters = [
      `authorships.author.id:${authorId1}`,
      `authorships.author.id:${authorId2}`,
    ];

    // Add year filter if specified
    if (fromYear) {
      filters.push(`publication_year:>${fromYear - 1}`);
    }

    const params = new URLSearchParams({
      filter: filters.join(","),
      per_page: "100",
    });

    const email = getPoliteEmail();
    if (email) {
      params.set("mailto", email);
    }

    const response = await fetch(`${BASE_URL}/works?${params}`);

    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.statusText}`);
    }

    const data: OpenAlexSearchResponse<OpenAlexWork> = await response.json();
    return data.results;
  },

  /**
   * Get author ID from name (best match)
   */
  async findAuthorByName(name: string): Promise<OpenAlexAuthor | null> {
    const result = await this.searchAuthors({ query: name, perPage: 1 });
    return result.results[0] || null;
  },

  /**
   * Get author's affiliations (current and historical)
   */
  async getAuthorAffiliations(authorId: string): Promise<{
    current: { id: string; name: string; ror?: string; country?: string }[];
    historical: { id: string; name: string; years: number[]; ror?: string; country?: string }[];
  }> {
    const author = await this.getAuthor(authorId);
    
    const current: { id: string; name: string; ror?: string; country?: string }[] = [];
    const historical: { id: string; name: string; years: number[]; ror?: string; country?: string }[] = [];
    
    // Current affiliation
    if (author.last_known_institutions) {
      for (const inst of author.last_known_institutions) {
        current.push({
          id: inst.id,
          name: inst.display_name,
          ror: inst.ror,
          country: inst.country_code,
        });
      }
    }
    
    // Historical affiliations from affiliations field
    if (author.affiliations) {
      for (const aff of author.affiliations) {
        if (aff.institution) {
          historical.push({
            id: aff.institution.id,
            name: aff.institution.display_name,
            years: aff.years || [],
            ror: aff.institution.ror,
            country: aff.institution.country_code,
          });
        }
      }
    }
    
    return { current, historical };
  },

  /**
   * Check if two authors share an institution
   */
  async checkSharedInstitution(
    authorId1: string,
    authorId2: string,
    withinYears?: number
  ): Promise<{
    hasSharedInstitution: boolean;
    sharedInstitutions: {
      id: string;
      name: string;
      type: "current_both" | "current_one" | "historical";
      years?: number[];
    }[];
  }> {
    const [affiliations1, affiliations2] = await Promise.all([
      this.getAuthorAffiliations(authorId1),
      this.getAuthorAffiliations(authorId2),
    ]);
    
    const sharedInstitutions: {
      id: string;
      name: string;
      type: "current_both" | "current_one" | "historical";
      years?: number[];
    }[] = [];
    
    // Check current affiliations
    const currentIds1 = new Set(affiliations1.current.map(a => a.id));
    const currentIds2 = new Set(affiliations2.current.map(a => a.id));
    
    // Both currently at same institution
    for (const aff of affiliations1.current) {
      if (currentIds2.has(aff.id)) {
        sharedInstitutions.push({
          id: aff.id,
          name: aff.name,
          type: "current_both",
        });
      }
    }
    
    // One current, one historical
    const currentYear = new Date().getFullYear();
    const cutoffYear = withinYears ? currentYear - withinYears : 0;
    
    for (const current of affiliations1.current) {
      const historical = affiliations2.historical.find(h => h.id === current.id);
      if (historical && !currentIds2.has(current.id)) {
        const recentYears = historical.years.filter(y => y >= cutoffYear);
        if (!withinYears || recentYears.length > 0) {
          sharedInstitutions.push({
            id: current.id,
            name: current.name,
            type: "current_one",
            years: recentYears,
          });
        }
      }
    }
    
    for (const current of affiliations2.current) {
      const historical = affiliations1.historical.find(h => h.id === current.id);
      if (historical && !currentIds1.has(current.id)) {
        const recentYears = historical.years.filter(y => y >= cutoffYear);
        if (!withinYears || recentYears.length > 0) {
          // Avoid duplicates
          if (!sharedInstitutions.some(s => s.id === current.id)) {
            sharedInstitutions.push({
              id: current.id,
              name: current.name,
              type: "current_one",
              years: recentYears,
            });
          }
        }
      }
    }
    
    // Historical overlap
    for (const hist1 of affiliations1.historical) {
      const hist2 = affiliations2.historical.find(h => h.id === hist1.id);
      if (hist2) {
        // Find overlapping years
        const overlappingYears = hist1.years.filter(y => 
          hist2.years.includes(y) && y >= cutoffYear
        );
        
        if (!withinYears || overlappingYears.length > 0) {
          // Avoid duplicates
          if (!sharedInstitutions.some(s => s.id === hist1.id)) {
            sharedInstitutions.push({
              id: hist1.id,
              name: hist1.name,
              type: "historical",
              years: overlappingYears,
            });
          }
        }
      }
    }
    
    return {
      hasSharedInstitution: sharedInstitutions.length > 0,
      sharedInstitutions,
    };
  },

  /**
   * Search for potential reviewers by topic/keywords
   */
  async findReviewers({
    keywords,
    excludeAuthorIds = [],
    minWorksCount = 10,
    minCitations = 50,
    page = 1,
    perPage = 20,
  }: {
    keywords: string;
    excludeAuthorIds?: string[];
    minWorksCount?: number;
    minCitations?: number;
    page?: number;
    perPage?: number;
  }): Promise<OpenAlexSearchResponse<OpenAlexAuthor>> {
    const filters = [
      `works_count:>${minWorksCount}`,
      `cited_by_count:>${minCitations}`,
    ];

    // Exclude specific authors (e.g., paper authors)
    if (excludeAuthorIds.length > 0) {
      excludeAuthorIds.forEach((id) => {
        filters.push(`!ids.openalex:${id}`);
      });
    }

    const params = new URLSearchParams({
      search: keywords,
      filter: filters.join(","),
      page: String(page),
      per_page: String(perPage),
      sort: "cited_by_count:desc",
    });

    const email = getPoliteEmail();
    if (email) {
      params.set("mailto", email);
    }

    const response = await fetch(`${BASE_URL}/authors?${params}`);

    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.statusText}`);
    }

    return response.json();
  },

  /**
   * Advanced reviewer discovery with comprehensive filters
   */
  async discoverReviewers({
    primaryKeywords,
    secondaryKeywords,
    minHIndex = 0,
    maxHIndex = 100,
    minWorksCount = 10,
    yearsActive = 5,
    requireCorresponding = false,
    maxResults = 50,
    excludeNames = [],
    excludeInstitutions = [],
  }: {
    primaryKeywords: string[];
    secondaryKeywords?: string[];
    minHIndex?: number;
    maxHIndex?: number;
    minWorksCount?: number;
    yearsActive?: number;
    requireCorresponding?: boolean;
    maxResults?: number;
    excludeNames?: string[];
    excludeInstitutions?: string[];
  }): Promise<{
    authors: OpenAlexAuthor[];
    concepts: { id: string; display_name: string; relevance: number }[];
  }> {
    // Build the search query
    const searchQuery = [...primaryKeywords, ...(secondaryKeywords || [])].join(" ");
    
    // Use simple, well-supported filters only
    // OpenAlex filter syntax: works_count:>N, cited_by_count:>N
    const filters = [
      `works_count:>${minWorksCount}`,
      `cited_by_count:>100`, // Ensure some level of impact
    ];

    const params = new URLSearchParams({
      search: searchQuery,
      filter: filters.join(","),
      per_page: String(Math.min(maxResults * 3, 200)), // Get more to filter locally
      sort: "cited_by_count:desc",
    });

    const email = getPoliteEmail();
    if (email) {
      params.set("mailto", email);
    }

    console.log(`[OpenAlex] Discovering reviewers with query: ${searchQuery}`);
    const response = await fetch(`${BASE_URL}/authors?${params}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[OpenAlex] API error: ${response.status} - ${errorText}`);
      throw new Error(`OpenAlex API error: ${response.statusText}`);
    }

    const data: OpenAlexSearchResponse<OpenAlexAuthor> = await response.json();
    console.log(`[OpenAlex] Found ${data.results?.length || 0} initial results`);
    
    // Post-filter results for h-index and other criteria
    let authors = data.results.filter(author => {
      // Filter by h-index range (done locally since API filter might not work reliably)
      const hIndex = author.summary_stats?.h_index || 0;
      if (minHIndex > 0 && hIndex < minHIndex) {
        return false;
      }
      if (maxHIndex && maxHIndex < 100 && hIndex > maxHIndex) {
        return false;
      }
      
      // Exclude by name
      const authorNameLC = author.display_name.toLowerCase();
      if (excludeNames.some(n => authorNameLC.includes(n.toLowerCase()))) {
        return false;
      }
      
      // Must have an institution
      if (!author.last_known_institutions || author.last_known_institutions.length === 0) {
        return false;
      }
      
      // Exclude by institution
      const instName = author.last_known_institutions[0]?.display_name?.toLowerCase() || "";
      if (excludeInstitutions.some(i => instName.includes(i.toLowerCase()))) {
        return false;
      }
      
      return true;
    });
    
    // Limit results
    authors = authors.slice(0, maxResults);
    
    // Extract top concepts from results
    const conceptMap = new Map<string, { display_name: string; count: number }>();
    for (const author of authors) {
      if (author.topics) {
        for (const topic of author.topics.slice(0, 3)) {
          const existing = conceptMap.get(topic.id);
          if (existing) {
            existing.count++;
          } else {
            conceptMap.set(topic.id, { display_name: topic.display_name, count: 1 });
          }
        }
      }
    }
    
    const concepts = Array.from(conceptMap.entries())
      .map(([id, { display_name, count }]) => ({
        id,
        display_name,
        relevance: count / authors.length,
      }))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10);
    
    return { authors, concepts };
  },

  /**
   * Get recent works for an author (with corresponding/senior author detection)
   * Uses both is_corresponding flag AND author_position (first/last) as indicators
   */
  async getRecentCorrespondingWorks(
    authorId: string,
    yearsBack = 5,
    minCitations = 0
  ): Promise<{
    works: OpenAlexWork[];
    correspondingCount: number;
    highImpactCount: number;
    firstAuthorCount: number;
    lastAuthorCount: number;
  }> {
    const currentYear = new Date().getFullYear();
    const fromYear = currentYear - yearsBack;
    
    const filters = [
      `authorships.author.id:${authorId}`,
      `publication_year:>=${fromYear}`,
    ];
    
    if (minCitations > 0) {
      filters.push(`cited_by_count:>${minCitations}`);
    }

    const params = new URLSearchParams({
      filter: filters.join(","),
      per_page: "50", // Reduce to speed up
      sort: "cited_by_count:desc",
    });

    const email = getPoliteEmail();
    if (email) {
      params.set("mailto", email);
    }

    const response = await fetch(`${BASE_URL}/works?${params}`);

    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.statusText}`);
    }

    const data: OpenAlexSearchResponse<OpenAlexWork> = await response.json();
    
    // Count corresponding/senior author papers
    let correspondingCount = 0;
    let firstAuthorCount = 0;
    let lastAuthorCount = 0;
    let highImpactCount = 0;
    
    // Normalize author ID for comparison (handle both full URL and short ID)
    const normalizedAuthorId = authorId.includes("openalex.org") 
      ? authorId 
      : `https://openalex.org/${authorId}`;
    const shortAuthorId = authorId.replace("https://openalex.org/", "");
    
    let debugFoundAuthor = false;
    
    for (const work of data.results) {
      if (work.authorships && work.authorships.length > 0) {
        // Find this author in the authorships - try both ID formats
        const authorship = work.authorships.find(a => {
          if (!a.author?.id) return false;
          const workAuthorId = a.author.id;
          return workAuthorId === normalizedAuthorId || 
                 workAuthorId === shortAuthorId ||
                 workAuthorId === authorId ||
                 workAuthorId.endsWith(shortAuthorId);
        });
        
        if (authorship) {
          debugFoundAuthor = true;
          // Check explicit corresponding flag
          if (authorship.is_corresponding === true) {
            correspondingCount++;
          }
          // Check position (first or last = senior contribution)
          const position = authorship.author_position;
          if (position === "first") {
            firstAuthorCount++;
          } else if (position === "last") {
            lastAuthorCount++;
          }
        }
      }
      
      // High impact = highly cited
      if (work.cited_by_count && work.cited_by_count > 50) {
        highImpactCount++;
      }
    }
    
    // Log for debugging
    if (data.results.length > 0) {
      console.log(`[OpenAlex] Author ${shortAuthorId}: ${data.results.length} works, found=${debugFoundAuthor}, first=${firstAuthorCount}, last=${lastAuthorCount}, corresp=${correspondingCount}`);
    }
    
    // If is_corresponding is not populated, use first+last as proxy
    // This is common as OpenAlex doesn't always have corresponding author data
    if (correspondingCount === 0 && (firstAuthorCount > 0 || lastAuthorCount > 0)) {
      correspondingCount = firstAuthorCount + lastAuthorCount;
    }
    
    return {
      works: data.results,
      correspondingCount,
      highImpactCount,
      firstAuthorCount,
      lastAuthorCount,
    };
  },

  /**
   * Get source (venue) information including metrics
   */
  async getSource(sourceId: string): Promise<OpenAlexSourceResult | null> {
    const params = new URLSearchParams();
    const email = getPoliteEmail();
    if (email) {
      params.set("mailto", email);
    }

    try {
      const response = await fetch(`${BASE_URL}/sources/${sourceId}?${params}`);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return {
        id: data.id,
        display_name: data.display_name,
        type: data.type,
        publisher: data.host_organization_name || "",
        is_oa: data.is_oa || false,
        is_in_doaj: data.is_in_doaj || false,
        works_count: data.works_count || 0,
        cited_by_count: data.cited_by_count || 0,
        h_index: data.summary_stats?.h_index || 0,
        impact_factor: data.summary_stats?.["2yr_mean_citedness"] ?? null,
        homepage_url: data.homepage_url,
        apc_usd: data.apc_usd,
        issn_l: data.issn_l || null,
        country_code: data.country_code || null,
      };
    } catch {
      return null;
    }
  },

  /**
   * Search for journals (sources) by keyword.
   * Returns matching journals with metrics, filtered to type=journal only.
   */
  async searchSources(
    query: string,
    perPage: number = 10
  ): Promise<OpenAlexSourceResult[]> {
    const params = new URLSearchParams({
      search: query,
      filter: "type:journal",
      per_page: String(perPage),
      sort: "cited_by_count:desc",
    });

    const email = getPoliteEmail();
    if (email) {
      params.set("mailto", email);
    }

    try {
      const response = await fetch(`${BASE_URL}/sources?${params}`);

      if (!response.ok) {
        console.log(`[OpenAlex] Source search failed: ${response.status}`);
        return [];
      }

      const data = await response.json();
      if (!data.results || !Array.isArray(data.results)) return [];

      return data.results.map((s: Record<string, unknown>) => ({
        id: s.id as string,
        display_name: s.display_name as string,
        type: s.type as string,
        publisher: (s.host_organization_name as string) || "",
        is_oa: (s.is_oa as boolean) || false,
        is_in_doaj: (s.is_in_doaj as boolean) || false,
        works_count: (s.works_count as number) || 0,
        cited_by_count: (s.cited_by_count as number) || 0,
        h_index: (s.summary_stats as Record<string, number>)?.h_index || 0,
        impact_factor: (s.summary_stats as Record<string, number>)?.["2yr_mean_citedness"] ?? null,
        homepage_url: (s.homepage_url as string) || undefined,
        apc_usd: (s.apc_usd as number) || undefined,
        issn_l: (s.issn_l as string) || null,
        country_code: (s.country_code as string) || null,
      }));
    } catch (error) {
      console.error("[OpenAlex] Error searching sources:", error);
      return [];
    }
  },

  /**
   * Look up a journal by its exact display name.
   * Returns the best match or null.
   */
  async findSourceByName(name: string): Promise<OpenAlexSourceResult | null> {
    const results = await this.searchSources(name, 5);
    if (results.length === 0) return null;

    const nameLower = name.toLowerCase().trim();
    // Prefer exact match
    const exact = results.find(
      r => r.display_name.toLowerCase().trim() === nameLower
    );
    return exact || results[0];
  },

  /**
   * Infer gender from first name using curated name lists.
   * Falls back to "unknown" rather than guessing from endings, since many
   * male names in Italian, Greek, Slavic etc. end in vowels (Luca, Andrea, Nicola).
   */
  inferGender(firstName: string): "likely_male" | "likely_female" | "unknown" {
    const name = firstName.toLowerCase().trim();
    // Handle initials like "L." or "T. W." — can't infer gender
    if (name.length <= 2 || /^[a-z]\.?(\s+[a-z]\.?)*$/.test(name)) {
      return "unknown";
    }

    // Names that are AMBIGUOUS across cultures — always return "unknown" for these
    const ambiguousNames = new Set([
      "andrea",   // male in Italian, female in English/German
      "simone",   // male in Italian, female in French/English
      "nicola",   // male in Italian, female in English
      "michele",  // male in Italian, female in French/English
      "daniele",  // male in Italian, could be confused with "Danielle"
      "sasha", "sascha", // both genders (Russian/German)
      "yuki",     // both genders (Japanese)
      "wei",      // both genders (Chinese)
      "li",       // both genders (Chinese)
      "min",      // both genders (Chinese/Korean)
      "jun",      // both genders (Chinese/Japanese)
      "claude",   // male in French, female in English sometimes
      "rene",     // male in French/Spanish, female in English
      "luca",     // male in Italian/Romanian, female in Hungarian
      "nikola",   // male in Slavic, could be confused with "Nicole"
      "misha",    // male in Russian, female elsewhere
      "alex",     // both genders
      "robin",    // both genders
      "kim",      // both genders
      "pat",      // both genders
      "sam",      // both genders
      "jordan",   // both genders
      "morgan",   // both genders
      "taylor",   // both genders
      "avery",    // both genders
    ]);

    if (ambiguousNames.has(name)) return "unknown";

    const femaleNames = new Set([
      // English
      "mary", "patricia", "jennifer", "linda", "elizabeth", "barbara", "susan",
      "jessica", "sarah", "karen", "lisa", "nancy", "betty", "margaret",
      "sandra", "ashley", "kimberly", "emily", "donna", "michelle", "dorothy",
      "carol", "amanda", "melissa", "deborah", "stephanie", "rebecca", "sharon",
      "laura", "cynthia", "kathleen", "amy", "angela", "anna", "maria", "eva",
      "lucia", "carmen", "rosa", "elena", "sara", "ana", "claire", "sophie",
      "emma", "olivia", "ava", "isabella", "mia", "charlotte", "amelia", "harper",
      "catherine", "virginia", "rachel", "samantha", "katherine", "christine",
      "debra", "carolyn", "janet", "diana", "alice", "julie", "heather", "teresa",
      "gloria", "evelyn", "joan", "victoria", "ruth", "judith", "megan", "cheryl",
      // Romance
      "marie", "anne", "isabelle", "françoise", "nathalie", "sylvie",
      "giulia", "francesca", "chiara", "giovanna", "valentina",
      "pilar", "dolores", "consuelo", "mercedes",
      // East Asian (unambiguous)
      "mei", "ling", "xin", "yan", "yun", "hui", "jie",
      "yoko", "keiko", "sachiko", "tomoko", "akiko", "noriko", "haruka",
      "minji", "soyeon", "jiyeon", "eunbi",
      // South Asian
      "priya", "ananya", "deepika", "pooja", "neha", "swati", "kavita",
    ]);
    
    const maleNames = new Set([
      // English
      "james", "michael", "john", "david", "richard", "joseph", "thomas",
      "charles", "christopher", "daniel", "matthew", "anthony", "mark", "donald",
      "steven", "paul", "andrew", "joshua", "kenneth", "kevin", "brian", "george",
      "timothy", "ronald", "edward", "jason", "jeffrey", "ryan", "jacob", "gary",
      "nicholas", "eric", "jonathan", "stephen", "william", "robert", "peter",
      "benjamin", "samuel", "henry", "alexander", "patrick", "jack", "dennis",
      "jerry", "tyler", "aaron", "nathan", "adam", "douglas", "scott", "alan",
      "raymond", "roger", "eugene", "bruce", "ralph", "roy", "louis", "russell",
      "lewis", "philip", "bobby", "harry", "vincent", "albert", "martin",
      // Italian/Romance (unambiguous male)
      "marco", "matteo", "pietro", "carlo", "fabio",
      "giuseppe", "giovanni", "alessandro", "davide",
      "enrique", "alejandro", "pablo", "diego", "rodrigo", "felipe", "bernardo",
      "pierre", "philippe", "alexandre", "andre",
      // Greek
      "nikos", "kostas", "giorgos", "dimitris", "yannis", "manolis",
      // Slavic (unambiguous)
      "ilya", "kolya", "luka",
      // East Asian (unambiguous)
      "taro", "kenji", "takeshi", "hiroshi", "akira", "takashi", "kazuki",
      "ryo", "yuto", "haruto", "minato", "ren",
      // Hispanic
      "carlos", "jose", "juan", "luis", "jorge", "antonio", "francisco", "miguel",
      // South Asian
      "raj", "amit", "rahul", "vikram", "suresh", "anil", "sanjay", "deepak",
    ]);
    
    // If in doubt, return "unknown" — conservative approach
    if (femaleNames.has(name)) return "likely_female";
    if (maleNames.has(name)) return "likely_male";
    
    // Do NOT fall back to suffix heuristics — too many false positives
    // (e.g. "Luca" → female because ends in "a", "Matteo" → female because ends in "e")
    return "unknown";
  },
};

export default openAlex;
