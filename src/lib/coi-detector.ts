import { openAlex } from "./openalex";
import { matchNames, matchFullNames, normalizeString, getNameVariations, getChineseVariations } from "./name-matcher";
import type { COIReport, OpenAlexWork } from "@/types";

interface AuthorInfo {
  name: string;
  orcid?: string | null;
  openAlexId?: string;
  role?: "corresponding" | "first" | "last" | "middle_early" | "middle_late";
}

interface ReviewerInfo {
  name: string;
  orcid?: string | null;
  openAlexId?: string;
}

// Severity levels including the minimal level for very old conflicts
export type ConflictSeverity = "critical" | "high" | "medium" | "low" | "minimal";

// Conflict details for a reviewer
export interface ReviewerConflict {
  authorName: string;
  authorRole: string;
  type: "coauthorship" | "affiliation";
  baseSeverity: ConflictSeverity;  // Based on author role
  adjustedSeverity: ConflictSeverity;  // Time-adjusted
  yearsSince?: number;  // Years since conflict (for coauthorship)
  details: {
    title?: string;
    year?: number;
    doi?: string;
    openAlexId?: string;
    institutionName?: string;
    affiliationType?: "current_both" | "current_one" | "historical";
  };
}

// Summary of conflicts for a reviewer
export interface ReviewerCOISummary {
  hasConflict: boolean;
  worstSeverity: ConflictSeverity | null;
  conflictCount: number;
  conflicts: ReviewerConflict[];
  checkedAt: string;
}

/**
 * Get base severity from author role
 */
function getBaseSeverity(role?: string): ConflictSeverity {
  switch (role) {
    case "last":
    case "first":
    case "corresponding":
      return "critical";
    case "middle_early":
      return "high";
    case "middle_late":
      return "medium";
    default:
      return "medium"; // Default for unknown roles
  }
}

/**
 * Calculate time-adjusted severity based on years since conflict
 * 
 * | Base Severity | 0-2 years | 3-5 years | 6-10 years | 10+ years |
 * |--------------|-----------|-----------|------------|-----------|
 * | Critical     | critical  | high      | medium     | low       |
 * | High         | high      | medium    | low        | minimal   |
 * | Medium       | medium    | low       | minimal    | minimal   |
 * | Low          | low       | minimal   | minimal    | minimal   |
 */
export function adjustSeverityByTime(
  baseSeverity: ConflictSeverity,
  yearsSince?: number
): ConflictSeverity {
  // If no year info, return base severity
  if (yearsSince === undefined || yearsSince < 0) {
    return baseSeverity;
  }

  const severityLevels: ConflictSeverity[] = ["critical", "high", "medium", "low", "minimal"];
  const baseIndex = severityLevels.indexOf(baseSeverity);

  // Calculate downgrade steps based on years
  let downgradeSteps = 0;
  if (yearsSince <= 2) {
    downgradeSteps = 0;
  } else if (yearsSince <= 5) {
    downgradeSteps = 1;
  } else if (yearsSince <= 10) {
    downgradeSteps = 2;
  } else {
    downgradeSteps = 3;
  }

  // Calculate new index, capped at "minimal"
  const newIndex = Math.min(baseIndex + downgradeSteps, severityLevels.length - 1);
  return severityLevels[newIndex];
}

/**
 * Get the worst (most severe) severity from a list
 */
export function getWorstSeverity(severities: ConflictSeverity[]): ConflictSeverity | null {
  if (severities.length === 0) return null;
  
  const order: ConflictSeverity[] = ["critical", "high", "medium", "low", "minimal"];
  let worstIndex = order.length;
  
  for (const severity of severities) {
    const index = order.indexOf(severity);
    if (index < worstIndex) {
      worstIndex = index;
    }
  }
  
  return order[worstIndex];
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

  /**
   * Check conflicts for a single reviewer against manuscript authors
   * Returns a summary with time-adjusted severity
   */
  async checkReviewerConflicts(
    authors: AuthorInfo[],
    reviewer: ReviewerInfo,
    fromYear?: number
  ): Promise<ReviewerCOISummary> {
    const currentYear = new Date().getFullYear();
    const conflicts: ReviewerConflict[] = [];

    // Resolve reviewer's OpenAlex ID
    const reviewerOpenAlexId = await this.resolveAuthorId(reviewer);

    if (!reviewerOpenAlexId) {
      return {
        hasConflict: false,
        worstSeverity: null,
        conflictCount: 0,
        conflicts: [],
        checkedAt: new Date().toISOString(),
      };
    }

    // Calculate years for affiliation check
    const affiliationWithinYears = fromYear ? currentYear - fromYear + 1 : 10;

    // Check each author against the reviewer
    for (const author of authors) {
      const authorOpenAlexId = await this.resolveAuthorId(author);
      if (!authorOpenAlexId) continue;

      const baseSeverity = getBaseSeverity(author.role);

      // Check co-authorship
      try {
        const coauthoredWorks = await this.checkCoauthorship(
          authorOpenAlexId,
          reviewerOpenAlexId,
          fromYear
        );

        for (const work of coauthoredWorks) {
          const yearsSince = currentYear - work.publication_year;
          const adjustedSeverity = adjustSeverityByTime(baseSeverity, yearsSince);

          conflicts.push({
            authorName: author.name,
            authorRole: author.role || "unknown",
            type: "coauthorship",
            baseSeverity,
            adjustedSeverity,
            yearsSince,
            details: {
              title: work.title,
              year: work.publication_year,
              doi: work.doi,
              openAlexId: work.id,
            },
          });
        }
      } catch (error) {
        console.error(`[COI] Error checking coauthorship for ${author.name}:`, error);
      }

      // Check shared affiliations
      try {
        const sharedInstitutions = await this.checkSharedInstitutions(
          authorOpenAlexId,
          reviewerOpenAlexId,
          affiliationWithinYears
        );

        for (const inst of sharedInstitutions) {
          // Affiliation conflicts are generally less severe than coauthorship
          // Downgrade base severity by one level for affiliations
          const severityLevels: ConflictSeverity[] = ["critical", "high", "medium", "low", "minimal"];
          const baseIndex = severityLevels.indexOf(baseSeverity);
          const affiliationBaseSeverity = severityLevels[Math.min(baseIndex + 1, severityLevels.length - 1)];

          // For current affiliations, no time adjustment
          // For historical, we don't have exact year so use minimal downgrade
          let adjustedSeverity = affiliationBaseSeverity;
          if (inst.type === "historical") {
            adjustedSeverity = severityLevels[Math.min(severityLevels.indexOf(affiliationBaseSeverity) + 1, severityLevels.length - 1)];
          }

          conflicts.push({
            authorName: author.name,
            authorRole: author.role || "unknown",
            type: "affiliation",
            baseSeverity: affiliationBaseSeverity,
            adjustedSeverity,
            details: {
              institutionName: inst.name,
              affiliationType: inst.type,
            },
          });
        }
      } catch (error) {
        console.error(`[COI] Error checking affiliations for ${author.name}:`, error);
      }
    }

    // Remove duplicate conflicts (same author-type combination)
    const uniqueConflicts = conflicts.filter(
      (conflict, index, self) =>
        index === self.findIndex((c) =>
          c.authorName === conflict.authorName &&
          c.type === conflict.type &&
          c.details.title === conflict.details.title &&
          c.details.institutionName === conflict.details.institutionName
        )
    );

    // Sort by adjusted severity (worst first)
    const severityOrder: ConflictSeverity[] = ["critical", "high", "medium", "low", "minimal"];
    uniqueConflicts.sort((a, b) =>
      severityOrder.indexOf(a.adjustedSeverity) - severityOrder.indexOf(b.adjustedSeverity)
    );

    const worstSeverity = getWorstSeverity(uniqueConflicts.map(c => c.adjustedSeverity));

    return {
      hasConflict: uniqueConflicts.length > 0,
      worstSeverity,
      conflictCount: uniqueConflicts.length,
      conflicts: uniqueConflicts,
      checkedAt: new Date().toISOString(),
    };
  },

  /**
   * Batch check conflicts for multiple reviewers against manuscript authors
   * Returns a map of reviewer name to COI summary
   */
  async batchCheckReviewerConflicts(
    authors: AuthorInfo[],
    reviewers: ReviewerInfo[],
    fromYear?: number
  ): Promise<Map<string, ReviewerCOISummary>> {
    const results = new Map<string, ReviewerCOISummary>();

    // Process in parallel with concurrency limit to avoid rate limiting
    const BATCH_SIZE = 3;
    for (let i = 0; i < reviewers.length; i += BATCH_SIZE) {
      const batch = reviewers.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (reviewer) => {
          const summary = await this.checkReviewerConflicts(authors, reviewer, fromYear);
          return { name: reviewer.name, summary };
        })
      );

      for (const { name, summary } of batchResults) {
        results.set(name, summary);
      }
    }

    return results;
  },
};

export default coiDetector;
