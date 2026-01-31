/**
 * Reference Validation System
 * 
 * Validates manuscript references against public databases.
 * 
 * Checks performed:
 * - DOI existence and resolution via Crossref
 * - PubMed ID validation
 * - Retraction status (via Retraction Watch database when available)
 * - Basic metadata extraction
 * 
 * IMPORTANT: This is a screening tool. All findings require editorial review.
 */

export interface ReferenceInput {
  raw: string;
  doi?: string;
  pmid?: string;
}

export interface ReferenceValidation {
  input: ReferenceInput;
  doi: {
    found: boolean;
    valid: boolean | null;
    resolvedTitle?: string;
    resolvedAuthors?: string[];
    resolvedYear?: number;
    resolvedJournal?: string;
    issues: string[];
  };
  pmid: {
    found: boolean;
    valid: boolean | null;
    title?: string;
    issues: string[];
  };
  retraction: {
    checked: boolean;
    isRetracted: boolean | null;
    retractionDate?: string;
    issues: string[];
  };
  status: "valid" | "not_found" | "retracted" | "suspicious" | "unchecked";
  confidence: "high" | "medium" | "low" | "unverified";
  issues: string[];
}

export interface ReferenceValidationResult {
  references: ReferenceValidation[];
  summary: {
    total: number;
    valid: number;
    notFound: number;
    retracted: number;
    suspicious: number;
    unchecked: number;
  };
  disclaimer: string;
}

/**
 * Extract DOI from text
 */
function extractDoi(text: string): string | null {
  // DOI patterns
  const patterns = [
    /10\.\d{4,}\/[^\s\]>)]+/i,  // Standard DOI
    /doi\.org\/(10\.\d{4,}\/[^\s\]>)]+)/i, // URL format
    /doi:\s*(10\.\d{4,}\/[^\s\]>)]+)/i, // "doi:" prefix
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Clean up trailing punctuation
      let doi = match[1] || match[0];
      doi = doi.replace(/[.,;:]+$/, "");
      return doi;
    }
  }
  
  return null;
}

/**
 * Extract PubMed ID from text
 */
function extractPmid(text: string): string | null {
  const patterns = [
    /PMID:\s*(\d+)/i,
    /PubMed(?:\s+ID)?:\s*(\d+)/i,
    /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Parse references from text block
 */
export function parseReferences(text: string): ReferenceInput[] {
  const references: ReferenceInput[] = [];
  
  // Split by common reference delimiters
  // Numbered references: [1], 1., (1)
  const lines = text.split(/\n/).filter(line => line.trim());
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 20) continue;
    
    // Remove leading numbers/brackets
    const cleaned = trimmed.replace(/^[\[\(]?\d+[\]\)]?\.?\s*/, "");
    
    if (cleaned.length > 10) {
      const doi = extractDoi(cleaned);
      const pmid = extractPmid(cleaned);
      
      references.push({
        raw: cleaned,
        doi: doi || undefined,
        pmid: pmid || undefined,
      });
    }
  }
  
  return references;
}

/**
 * Validate DOI via Crossref API
 */
async function validateDoi(doi: string): Promise<{
  valid: boolean;
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
  error?: string;
}> {
  try {
    const encodedDoi = encodeURIComponent(doi);
    const response = await fetch(
      `https://api.crossref.org/works/${encodedDoi}`,
      {
        headers: {
          "User-Agent": "PubliMentor/1.0 (mailto:support@publimentor.com)",
        },
      }
    );
    
    if (!response.ok) {
      if (response.status === 404) {
        return { valid: false, error: "DOI not found in Crossref" };
      }
      throw new Error(`Crossref API error: ${response.status}`);
    }
    
    const data = await response.json();
    const work = data.message;
    
    const authors = (work.author || [])
      .map((a: { given?: string; family?: string }) => 
        `${a.given || ""} ${a.family || ""}`.trim()
      )
      .filter(Boolean);
    
    return {
      valid: true,
      title: work.title?.[0] || undefined,
      authors: authors.length > 0 ? authors : undefined,
      year: work.published?.["date-parts"]?.[0]?.[0] || 
            work["published-print"]?.["date-parts"]?.[0]?.[0] ||
            work["published-online"]?.["date-parts"]?.[0]?.[0],
      journal: work["container-title"]?.[0] || undefined,
    };
  } catch (error) {
    console.error("[RefValidator] Crossref error:", error);
    return { valid: false, error: "Could not validate DOI" };
  }
}

/**
 * Validate PubMed ID
 */
async function validatePmid(pmid: string): Promise<{
  valid: boolean;
  title?: string;
  error?: string;
}> {
  try {
    const response = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`
    );
    
    if (!response.ok) {
      throw new Error(`PubMed API error: ${response.status}`);
    }
    
    const data = await response.json();
    const result = data.result?.[pmid];
    
    if (!result || result.error) {
      return { valid: false, error: "PMID not found in PubMed" };
    }
    
    return {
      valid: true,
      title: result.title,
    };
  } catch (error) {
    console.error("[RefValidator] PubMed error:", error);
    return { valid: false, error: "Could not validate PMID" };
  }
}

/**
 * Check if a DOI is retracted (basic check via Crossref)
 */
async function checkRetraction(doi: string): Promise<{
  isRetracted: boolean | null;
  retractionDate?: string;
}> {
  try {
    const encodedDoi = encodeURIComponent(doi);
    const response = await fetch(
      `https://api.crossref.org/works/${encodedDoi}`,
      {
        headers: {
          "User-Agent": "PubliMentor/1.0 (mailto:support@publimentor.com)",
        },
      }
    );
    
    if (!response.ok) {
      return { isRetracted: null };
    }
    
    const data = await response.json();
    const work = data.message;
    
    // Check for retraction indicators
    const updateTo = work["update-to"];
    if (updateTo && Array.isArray(updateTo)) {
      const retraction = updateTo.find(
        (u: { type?: string }) => u.type === "retraction"
      );
      if (retraction) {
        return {
          isRetracted: true,
          retractionDate: retraction.updated?.["date-parts"]?.[0]?.join("-"),
        };
      }
    }
    
    // Also check type
    if (work.type === "retracted-article") {
      return { isRetracted: true };
    }
    
    return { isRetracted: false };
  } catch (error) {
    console.error("[RefValidator] Retraction check error:", error);
    return { isRetracted: null };
  }
}

/**
 * Validate a single reference
 */
async function validateReference(ref: ReferenceInput): Promise<ReferenceValidation> {
  const issues: string[] = [];
  
  // DOI validation
  let doiResult = {
    found: !!ref.doi,
    valid: null as boolean | null,
    resolvedTitle: undefined as string | undefined,
    resolvedAuthors: undefined as string[] | undefined,
    resolvedYear: undefined as number | undefined,
    resolvedJournal: undefined as string | undefined,
    issues: [] as string[],
  };
  
  if (ref.doi) {
    const validation = await validateDoi(ref.doi);
    doiResult.valid = validation.valid;
    if (validation.valid) {
      doiResult.resolvedTitle = validation.title;
      doiResult.resolvedAuthors = validation.authors;
      doiResult.resolvedYear = validation.year;
      doiResult.resolvedJournal = validation.journal;
    } else {
      doiResult.issues.push(validation.error || "DOI validation failed");
      issues.push(`DOI ${ref.doi}: ${validation.error || "not found"}`);
    }
  }
  
  // PMID validation
  let pmidResult = {
    found: !!ref.pmid,
    valid: null as boolean | null,
    title: undefined as string | undefined,
    issues: [] as string[],
  };
  
  if (ref.pmid) {
    const validation = await validatePmid(ref.pmid);
    pmidResult.valid = validation.valid;
    if (validation.valid) {
      pmidResult.title = validation.title;
    } else {
      pmidResult.issues.push(validation.error || "PMID validation failed");
      issues.push(`PMID ${ref.pmid}: ${validation.error || "not found"}`);
    }
  }
  
  // Retraction check (only if DOI is valid)
  let retractionResult = {
    checked: false,
    isRetracted: null as boolean | null,
    retractionDate: undefined as string | undefined,
    issues: [] as string[],
  };
  
  if (ref.doi && doiResult.valid) {
    const retraction = await checkRetraction(ref.doi);
    retractionResult.checked = true;
    retractionResult.isRetracted = retraction.isRetracted;
    retractionResult.retractionDate = retraction.retractionDate;
    
    if (retraction.isRetracted) {
      issues.push("⚠️ This paper has been RETRACTED");
    }
  }
  
  // Determine overall status
  let status: ReferenceValidation["status"] = "unchecked";
  let confidence: ReferenceValidation["confidence"] = "unverified";
  
  if (retractionResult.isRetracted) {
    status = "retracted";
    confidence = "high";
  } else if (doiResult.valid || pmidResult.valid) {
    status = "valid";
    confidence = doiResult.valid && pmidResult.valid ? "high" : "medium";
  } else if (doiResult.found && !doiResult.valid) {
    status = "not_found";
    confidence = "medium";
  } else if (pmidResult.found && !pmidResult.valid) {
    status = "not_found";
    confidence = "medium";
  } else if (!doiResult.found && !pmidResult.found) {
    status = "unchecked";
    confidence = "unverified";
  }
  
  return {
    input: ref,
    doi: doiResult,
    pmid: pmidResult,
    retraction: retractionResult,
    status,
    confidence,
    issues,
  };
}

/**
 * Validate multiple references
 */
export async function validateReferences(
  references: ReferenceInput[]
): Promise<ReferenceValidationResult> {
  const results: ReferenceValidation[] = [];
  
  // Process in small batches to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < references.length; i += batchSize) {
    const batch = references.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(ref => validateReference(ref))
    );
    results.push(...batchResults);
    
    // Small delay between batches
    if (i + batchSize < references.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Calculate summary
  const summary = {
    total: results.length,
    valid: results.filter(r => r.status === "valid").length,
    notFound: results.filter(r => r.status === "not_found").length,
    retracted: results.filter(r => r.status === "retracted").length,
    suspicious: results.filter(r => r.status === "suspicious").length,
    unchecked: results.filter(r => r.status === "unchecked").length,
  };
  
  return {
    references: results,
    summary,
    disclaimer: "These results are automated indicators only. Reference validation cannot determine citation relevance or accuracy of claims. Retraction checks may not be comprehensive. All findings require editorial review.",
  };
}

/**
 * Quick validation for a single DOI
 */
export async function quickValidateDoi(doi: string): Promise<{
  valid: boolean;
  metadata?: {
    title: string;
    authors: string[];
    year: number;
    journal: string;
  };
  isRetracted: boolean;
  error?: string;
}> {
  const doiResult = await validateDoi(doi);
  
  if (!doiResult.valid) {
    return { valid: false, isRetracted: false, error: doiResult.error };
  }
  
  const retraction = await checkRetraction(doi);
  
  return {
    valid: true,
    metadata: doiResult.title ? {
      title: doiResult.title,
      authors: doiResult.authors || [],
      year: doiResult.year || 0,
      journal: doiResult.journal || "",
    } : undefined,
    isRetracted: retraction.isRetracted || false,
  };
}
