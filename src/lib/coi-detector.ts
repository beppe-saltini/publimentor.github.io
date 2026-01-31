import { openAlex } from "./openalex";
import { matchNames, matchFullNames, normalizeString, getNameVariations, getChineseVariations } from "./name-matcher";
import type { COIReport, OpenAlexWork } from "@/types";

interface AuthorInfo {
  name: string;
  orcid?: string | null;
  openAlexId?: string;
}

interface ReviewerInfo {
  name: string;
  orcid?: string | null;
  openAlexId?: string;
}

/**
 * Parse a full name into first and last name parts
 * Handles middle initials by extracting just the first name for matching
 */
function parseNameParts(fullName: string): { firstName: string; lastName: string; firstNameOnly: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: "", lastName: parts[0], firstNameOnly: "" };
  }
  
  // First name is everything except the last part
  const firstName = parts.slice(0, -1).join(" ");
  
  // For matching purposes, just use the actual first name (no middle initials)
  // This handles "James E." -> "James" and "James Edward" -> "James"
  let firstNameOnly = parts[0];
  // Remove trailing periods from initials
  firstNameOnly = firstNameOnly.replace(/\.$/, "");
  
  return {
    firstName,
    lastName: parts[parts.length - 1],
    firstNameOnly,
  };
}

/**
 * Conflict of Interest Detector
 * Checks for co-authorship history between paper authors and potential reviewers
 */
export const coiDetector = {
  /**
   * Get all name variations to search for
   */
  getNameVariationsToSearch(name: string): string[] {
    const { firstName, lastName } = parseNameParts(name);
    const variations = new Set<string>([name]);
    
    // Add nickname variations
    const firstNameVariations = getNameVariations(firstName);
    for (const fnVar of firstNameVariations) {
      variations.add(`${fnVar} ${lastName}`);
    }
    
    // Add Chinese transliteration variations
    const surnameVariations = getChineseVariations(lastName);
    const firstNameChineseVariations = getChineseVariations(firstName);
    
    for (const lnVar of surnameVariations.slice(0, 5)) {
      variations.add(`${firstName} ${lnVar}`);
      for (const fnVar of firstNameChineseVariations.slice(0, 3)) {
        variations.add(`${fnVar} ${lnVar}`);
      }
    }
    
    return Array.from(variations);
  },

  /**
   * Get OpenAlex author ID from ORCID or name (with fuzzy matching)
   * Automatically tries name variations (nicknames, transliterations)
   */
  async resolveAuthorId(author: AuthorInfo): Promise<string | null> {
    if (author.openAlexId) {
      return author.openAlexId;
    }

    // Try ORCID first (most reliable)
    if (author.orcid) {
      const result = await openAlex.getAuthorByOrcid(author.orcid);
      if (result) {
        console.log(`[COI] Found "${author.name}" by ORCID: ${result.display_name}`);
        return result.id;
      }
    }

    // Get all name variations to try
    const nameVariations = this.getNameVariationsToSearch(author.name);
    const { firstNameOnly, lastName } = parseNameParts(author.name);
    
    console.log(`[COI] Searching for "${author.name}" with variations:`, nameVariations.slice(0, 10));
    
    // Try each variation - search with multiple results and pick best match
    for (const variantName of nameVariations) {
      try {
        // Search for more results to find the best match
        const searchResult = await openAlex.searchAuthors({ 
          query: variantName, 
          perPage: 10,
          minWorksCount: 1 
        });
        
        if (searchResult.results.length > 0) {
          console.log(`[COI] Search "${variantName}" returned ${searchResult.results.length} results:`, 
            searchResult.results.slice(0, 3).map(r => r.display_name));
          
          // Check each result for a good match
          for (const result of searchResult.results) {
            const resultParts = parseNameParts(result.display_name);
            
            // Use firstNameOnly to avoid middle initial issues
            // Compare "James" with "James" even if result is "James E. Haber"
            const match = matchFullNames(
              firstNameOnly, 
              lastName, 
              resultParts.firstNameOnly, 
              resultParts.lastName
            );
            
            console.log(`[COI] Comparing "${firstNameOnly} ${lastName}" with "${resultParts.firstNameOnly} ${resultParts.lastName}": ${match.isMatch ? 'MATCH' : 'NO MATCH'} (${(match.confidence * 100).toFixed(0)}%, ${match.matchType})`);
            
            if (match.isMatch && match.confidence >= 0.70) {
              console.log(`[COI] Found "${author.name}" as "${result.display_name}" via search "${variantName}" (${match.matchType}, ${(match.confidence * 100).toFixed(0)}% confidence)`);
              return result.id;
            }
          }
        }
      } catch (error) {
        // Continue to next variation
        console.log(`[COI] Error searching for "${variantName}":`, error);
      }
    }

    console.log(`[COI] Could not find author "${author.name}" in OpenAlex`);
    return null;
  },

  /**
   * Resolve multiple author IDs, trying all name variations
   */
  async resolveAllAuthorIds(author: AuthorInfo): Promise<string[]> {
    const ids: string[] = [];
    
    // Get the primary ID
    const primaryId = await this.resolveAuthorId(author);
    if (primaryId) {
      ids.push(primaryId);
    }
    
    return ids;
  },

  /**
   * Check if two author names likely refer to the same person
   */
  checkNameMatch(name1: string, name2: string): { isMatch: boolean; confidence: number; explanation: string } {
    const parts1 = parseNameParts(name1);
    const parts2 = parseNameParts(name2);
    
    // Use firstNameOnly to handle middle initials
    const result = matchFullNames(parts1.firstNameOnly, parts1.lastName, parts2.firstNameOnly, parts2.lastName);
    return {
      isMatch: result.isMatch,
      confidence: result.confidence,
      explanation: result.explanation,
    };
  },

  /**
   * Check for co-authorship between two individuals
   * @param authorId - Author's OpenAlex ID
   * @param reviewerId - Reviewer's OpenAlex ID
   * @param fromYear - Optional: only check papers from this year onwards
   */
  async checkCoauthorship(
    authorId: string,
    reviewerId: string,
    fromYear?: number
  ): Promise<OpenAlexWork[]> {
    try {
      const coauthoredWorks = await openAlex.findCoauthoredWorks(authorId, reviewerId, fromYear);
      return coauthoredWorks;
    } catch (error) {
      console.error("Error checking co-authorship:", error);
      return [];
    }
  },

  /**
   * Check for shared institutions between author and reviewer
   */
  async checkSharedInstitutions(
    authorOpenAlexId: string,
    reviewerOpenAlexId: string,
    withinYears?: number
  ): Promise<{
    id: string;
    name: string;
    type: "current_both" | "current_one" | "historical";
    years?: number[];
  }[]> {
    try {
      const result = await openAlex.checkSharedInstitution(
        authorOpenAlexId,
        reviewerOpenAlexId,
        withinYears
      );
      return result.sharedInstitutions;
    } catch (error) {
      console.error("[COI] Error checking shared institutions:", error);
      return [];
    }
  },

  /**
   * Generate a full COI report between paper authors and a reviewer
   * @param authors - List of paper authors
   * @param reviewer - Potential reviewer to check
   * @param fromYear - Optional: only check papers from this year onwards
   * @param checkAffiliations - Whether to check for shared affiliations (default: true)
   */
  async generateReport(
    authors: AuthorInfo[],
    reviewer: ReviewerInfo,
    fromYear?: number,
    checkAffiliations: boolean = true
  ): Promise<COIReport> {
    // Resolve reviewer's OpenAlex ID
    const reviewerOpenAlexId = await this.resolveAuthorId(reviewer);

    if (!reviewerOpenAlexId) {
      return {
        hasConflict: false,
        coauthoredPapers: [],
        sharedInstitutions: [],
        checkedAt: new Date().toISOString(),
        authorId: "unknown",
        reviewerId: reviewer.orcid || reviewer.name,
      };
    }

    const allCoauthoredPapers: {
      title: string;
      year: number;
      doi?: string;
      openAlexId: string;
      authorName: string;
    }[] = [];

    const allSharedInstitutions: {
      id: string;
      name: string;
      type: "current_both" | "current_one" | "historical";
      years?: number[];
      authorName: string;
    }[] = [];

    // Calculate years for affiliation check
    const currentYear = new Date().getFullYear();
    const affiliationWithinYears = fromYear ? currentYear - fromYear + 1 : 10; // Default to 10 years

    // Check each author against the reviewer
    for (const author of authors) {
      const authorOpenAlexId = await this.resolveAuthorId(author);

      if (authorOpenAlexId) {
        // Check co-authorship
        const coauthoredWorks = await this.checkCoauthorship(
          authorOpenAlexId,
          reviewerOpenAlexId,
          fromYear
        );

        for (const work of coauthoredWorks) {
          allCoauthoredPapers.push({
            title: work.title,
            year: work.publication_year,
            doi: work.doi,
            openAlexId: work.id,
            authorName: author.name,
          });
        }

        // Check shared affiliations
        if (checkAffiliations) {
          const sharedInstitutions = await this.checkSharedInstitutions(
            authorOpenAlexId,
            reviewerOpenAlexId,
            affiliationWithinYears
          );

          for (const inst of sharedInstitutions) {
            allSharedInstitutions.push({
              ...inst,
              authorName: author.name,
            });
          }
        }
      }
    }

    // Remove duplicates
    const uniquePapers = allCoauthoredPapers.filter(
      (paper, index, self) =>
        index === self.findIndex((p) => p.openAlexId === paper.openAlexId)
    );

    const uniqueInstitutions = allSharedInstitutions.filter(
      (inst, index, self) =>
        index === self.findIndex((i) => i.id === inst.id)
    );

    const hasConflict = uniquePapers.length > 0 || uniqueInstitutions.length > 0;

    return {
      hasConflict,
      coauthoredPapers: uniquePapers.map((p) => ({
        title: p.title,
        year: p.year,
        doi: p.doi,
        openAlexId: p.openAlexId,
      })),
      sharedInstitutions: uniqueInstitutions,
      checkedAt: new Date().toISOString(),
      authorId: authors[0]?.orcid || authors[0]?.name || "unknown",
      reviewerId: reviewer.orcid || reviewer.name,
    };
  },

  /**
   * Quick check if there's any COI (without full details)
   */
  async hasConflict(authors: AuthorInfo[], reviewer: ReviewerInfo): Promise<boolean> {
    const report = await this.generateReport(authors, reviewer);
    return report.hasConflict;
  },
};

export default coiDetector;
