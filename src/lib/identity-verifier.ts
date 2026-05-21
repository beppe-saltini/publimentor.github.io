/**
 * Author Identity Verification System
 * 
 * Provides automated screening indicators for author identity verification.
 * This is an editorial assistance tool - all findings require human review.
 * 
 * Checks performed:
 * - ORCID validation (existence, name match, affiliation match)
 * - Email domain validation (institutional vs personal, domain-affiliation match)
 * - Affiliation plausibility (institution exists via ROR)
 */

import { matchFullNames, normalizeString } from "./name-matcher";

// Common personal email domains that are not institutional
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de",
  "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "msn.com",
  "aol.com",
  "icloud.com", "me.com", "mac.com",
  "mail.com", "email.com",
  "protonmail.com", "proton.me",
  "zoho.com",
  "yandex.com", "yandex.ru",
  "163.com", "126.com", "qq.com", // Chinese
  "naver.com", "daum.net", // Korean
]);

// Known disposable email domains (subset - would be a larger list in production)
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "tempmail.com", "throwaway.com", "guerrillamail.com", "10minutemail.com",
  "mailinator.com", "yopmail.com", "temp-mail.org", "fakeinbox.com",
  "trashmail.com", "getnada.com", "discard.email",
]);

export interface AuthorIdentityCheck {
  name: string;
  email?: string;
  orcid?: string;
  affiliation?: string;
}

export interface ORCIDValidation {
  orcidProvided: boolean;
  orcidExists: boolean | null;
  nameMatch: "exact" | "partial" | "mismatch" | "unknown";
  affiliationMatch: "match" | "mismatch" | "not_available";
  orcidProfile?: {
    givenName?: string;
    familyName?: string;
    affiliations?: string[];
    worksCount?: number;
  };
  confidence: "high" | "medium" | "low" | "unverified";
  issues: string[];
}

export interface EmailValidation {
  emailProvided: boolean;
  domain?: string;
  domainType: "institutional" | "personal" | "disposable" | "unknown";
  matchesAffiliation: boolean | null;
  institutionFromDomain?: string;
  issues: string[];
}

export interface AffiliationValidation {
  affiliationProvided: boolean;
  institutionExists: boolean | null;
  rorId?: string;
  officialName?: string;
  country?: string;
  type?: string;
  issues: string[];
}

export interface IdentityVerificationResult {
  author: AuthorIdentityCheck;
  orcid: ORCIDValidation;
  email: EmailValidation;
  affiliation: AffiliationValidation;
  overallConfidence: "high" | "medium" | "low" | "unverified";
  indicatorsFound: number;
  summary: string;
  disclaimer: string;
}

/**
 * Parse an ORCID to standard format
 */
function normalizeOrcid(orcid: string): string | null {
  // Extract ORCID from URL or plain format
  const match = orcid.match(/(\d{4}-\d{4}-\d{4}-\d{4}|\d{4}-\d{4}-\d{4}-\d{3}X)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extract domain from email
 */
function extractEmailDomain(email: string): string | null {
  const match = email.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Check if a domain is likely institutional
 */
function classifyEmailDomain(domain: string): "institutional" | "personal" | "disposable" | "unknown" {
  const lowerDomain = domain.toLowerCase();
  
  if (DISPOSABLE_EMAIL_DOMAINS.has(lowerDomain)) {
    return "disposable";
  }
  
  if (PERSONAL_EMAIL_DOMAINS.has(lowerDomain)) {
    return "personal";
  }
  
  // Check for common institutional patterns
  if (lowerDomain.endsWith(".edu") || 
      lowerDomain.endsWith(".ac.uk") ||
      lowerDomain.endsWith(".edu.au") ||
      lowerDomain.endsWith(".ac.jp") ||
      lowerDomain.includes(".edu.") ||
      lowerDomain.includes(".ac.") ||
      lowerDomain.includes(".uni-") ||
      lowerDomain.includes("university") ||
      lowerDomain.includes("institute") ||
      lowerDomain.includes("hospital") ||
      lowerDomain.includes("medical") ||
      lowerDomain.endsWith(".gov") ||
      lowerDomain.endsWith(".org")) {
    return "institutional";
  }
  
  return "unknown";
}

/**
 * Validate ORCID via ORCID public API
 */
async function validateOrcid(orcid: string, authorName: string): Promise<ORCIDValidation> {
  const normalizedOrcid = normalizeOrcid(orcid);
  
  if (!normalizedOrcid) {
    return {
      orcidProvided: true,
      orcidExists: false,
      nameMatch: "unknown",
      affiliationMatch: "not_available",
      confidence: "unverified",
      issues: ["Invalid ORCID format"],
    };
  }
  
  try {
    const response = await fetch(`https://pub.orcid.org/v3.0/${normalizedOrcid}/person`, {
      headers: {
        "Accept": "application/json",
      },
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return {
          orcidProvided: true,
          orcidExists: false,
          nameMatch: "unknown",
          affiliationMatch: "not_available",
          confidence: "unverified",
          issues: ["ORCID not found in registry"],
        };
      }
      throw new Error(`ORCID API error: ${response.status}`);
    }
    
    const data = await response.json();
    const issues: string[] = [];
    
    // Extract name from ORCID
    const givenName = data.name?.["given-names"]?.value || "";
    const familyName = data.name?.["family-name"]?.value || "";
    
    // Check name match
    let nameMatch: ORCIDValidation["nameMatch"] = "unknown";
    if (givenName || familyName) {
      const authorParts = authorName.trim().split(/\s+/);
      const authorFirstName = authorParts[0] || "";
      const authorLastName = authorParts[authorParts.length - 1] || "";
      
      const match = matchFullNames(authorFirstName, authorLastName, givenName, familyName);
      
      if (match.confidence >= 0.9) {
        nameMatch = "exact";
      } else if (match.confidence >= 0.7) {
        nameMatch = "partial";
      } else {
        nameMatch = "mismatch";
        issues.push(`Name mismatch: ORCID shows "${givenName} ${familyName}", author listed as "${authorName}"`);
      }
    }
    
    // Get affiliations
    const affiliationsResponse = await fetch(`https://pub.orcid.org/v3.0/${normalizedOrcid}/employments`, {
      headers: { "Accept": "application/json" },
    });
    
    let affiliations: string[] = [];
    if (affiliationsResponse.ok) {
      const affData = await affiliationsResponse.json();
      affiliations = (affData["affiliation-group"] || [])
        .map((g: { summaries?: { "employment-summary"?: { organization?: { name: string } } }[] }) => 
          g.summaries?.[0]?.["employment-summary"]?.organization?.name
        )
        .filter(Boolean);
    }
    
    // Get works count
    const worksResponse = await fetch(`https://pub.orcid.org/v3.0/${normalizedOrcid}/works`, {
      headers: { "Accept": "application/json" },
    });
    
    let worksCount = 0;
    if (worksResponse.ok) {
      const worksData = await worksResponse.json();
      worksCount = worksData.group?.length || 0;
    }
    
    // Determine confidence
    let confidence: ORCIDValidation["confidence"] = "high";
    if (nameMatch === "mismatch") {
      confidence = "low";
    } else if (nameMatch === "partial") {
      confidence = "medium";
    } else if (worksCount === 0) {
      confidence = "medium";
      issues.push("ORCID has no associated works");
    }
    
    return {
      orcidProvided: true,
      orcidExists: true,
      nameMatch,
      affiliationMatch: affiliations.length > 0 ? "match" : "not_available",
      orcidProfile: {
        givenName,
        familyName,
        affiliations,
        worksCount,
      },
      confidence,
      issues,
    };
  } catch (error) {
    console.error("[Identity] ORCID validation error:", error);
    return {
      orcidProvided: true,
      orcidExists: null,
      nameMatch: "unknown",
      affiliationMatch: "not_available",
      confidence: "unverified",
      issues: ["Could not validate ORCID - API error"],
    };
  }
}

/**
 * Validate email address
 */
function validateEmail(
  email: string, 
  affiliation?: string
): EmailValidation {
  const domain = extractEmailDomain(email);
  
  if (!domain) {
    return {
      emailProvided: true,
      domainType: "unknown",
      matchesAffiliation: null,
      issues: ["Invalid email format"],
    };
  }
  
  const domainType = classifyEmailDomain(domain);
  const issues: string[] = [];
  
  if (domainType === "disposable") {
    issues.push("Email appears to be from a disposable email service");
  } else if (domainType === "personal") {
    issues.push("Email is from a personal email provider (not institutional)");
  }
  
  // Check if domain matches affiliation
  let matchesAffiliation: boolean | null = null;
  if (affiliation && domainType === "institutional") {
    const normalizedAff = normalizeString(affiliation);
    const domainParts = domain.split(".");
    
    // Simple heuristic: check if any part of the domain appears in the affiliation
    const domainWords = domainParts.slice(0, -1); // Remove TLD
    matchesAffiliation = domainWords.some(word => 
      word.length > 3 && normalizedAff.includes(word.toLowerCase())
    );
    
    if (!matchesAffiliation) {
      issues.push(`Email domain "${domain}" may not match stated affiliation "${affiliation}"`);
    }
  }
  
  return {
    emailProvided: true,
    domain,
    domainType,
    matchesAffiliation,
    issues,
  };
}

/**
 * Validate affiliation via ROR API
 */
async function validateAffiliation(affiliation: string): Promise<AffiliationValidation> {
  try {
    const encodedQuery = encodeURIComponent(affiliation);
    const response = await fetch(
      `https://api.ror.org/v2/organizations?query=${encodedQuery}`,
      { signal: AbortSignal.timeout(10000) }
    );
    
    if (!response.ok) {
      throw new Error(`ROR API error: ${response.status}`);
    }
    
    const data = await response.json();
    const issues: string[] = [];
    
    if (data.items && data.items.length > 0) {
      const bestMatch = data.items[0];

      const displayName = bestMatch.names?.find(
        (n: { types: string[] }) => n.types?.includes("ror_display")
      )?.value || bestMatch.names?.[0]?.value || "";
      const country = bestMatch.locations?.[0]?.geonames_details?.country_name;
      
      const normalizedInput = normalizeString(affiliation);
      const normalizedMatch = normalizeString(displayName);
      
      const similarity = normalizedInput === normalizedMatch ? 1 : 
        normalizedMatch.includes(normalizedInput) || normalizedInput.includes(normalizedMatch) ? 0.8 : 0.5;
      
      if (similarity < 0.8) {
        issues.push(`Affiliation "${affiliation}" closest match is "${displayName}" - verify spelling`);
      }
      
      return {
        affiliationProvided: true,
        institutionExists: true,
        rorId: bestMatch.id,
        officialName: displayName,
        country,
        type: bestMatch.types?.[0],
        issues,
      };
    }
    
    issues.push(`Institution "${affiliation}" not found in ROR database - may be misspelled or not registered`);
    
    return {
      affiliationProvided: true,
      institutionExists: false,
      issues,
    };
  } catch (error) {
    console.error("[Identity] ROR validation error:", error);
    return {
      affiliationProvided: true,
      institutionExists: null,
      issues: ["Could not validate institution - API error"],
    };
  }
}

/**
 * Perform full identity verification for an author
 */
export async function verifyAuthorIdentity(
  author: AuthorIdentityCheck
): Promise<IdentityVerificationResult> {
  // Run validations in parallel where possible
  const [orcidResult, affiliationResult] = await Promise.all([
    author.orcid ? validateOrcid(author.orcid, author.name) : Promise.resolve({
      orcidProvided: false,
      orcidExists: null,
      nameMatch: "unknown" as const,
      affiliationMatch: "not_available" as const,
      confidence: "unverified" as const,
      issues: ["No ORCID provided"],
    }),
    author.affiliation ? validateAffiliation(author.affiliation) : Promise.resolve({
      affiliationProvided: false,
      institutionExists: null,
      issues: ["No affiliation provided"],
    }),
  ]);
  
  const emailResult: EmailValidation = author.email 
    ? validateEmail(author.email, author.affiliation)
    : {
        emailProvided: false,
        domainType: "unknown",
        matchesAffiliation: null,
        issues: ["No email provided"],
      };
  
  // Calculate overall confidence and indicators
  const allIssues = [
    ...orcidResult.issues,
    ...emailResult.issues,
    ...affiliationResult.issues,
  ];
  
  const indicatorsFound = allIssues.filter(issue => 
    !issue.includes("No ") && !issue.includes("not provided")
  ).length;
  
  let overallConfidence: IdentityVerificationResult["overallConfidence"] = "high";
  
  if (indicatorsFound >= 3) {
    overallConfidence = "low";
  } else if (indicatorsFound >= 1) {
    overallConfidence = "medium";
  } else if (!author.orcid && !author.email) {
    overallConfidence = "unverified";
  }
  
  // Generate summary
  let summary: string;
  if (indicatorsFound === 0) {
    summary = "No verification issues detected in automated screening.";
  } else {
    summary = `${indicatorsFound} potential indicator(s) found. Editorial review recommended.`;
  }
  
  return {
    author,
    orcid: orcidResult,
    email: emailResult,
    affiliation: affiliationResult,
    overallConfidence,
    indicatorsFound,
    summary,
    disclaimer: "These results are automated indicators only. Identity verification involves many factors that cannot be fully assessed automatically. All findings require editorial review and human judgment.",
  };
}

/**
 * Verify multiple authors
 */
export async function verifyAuthors(
  authors: AuthorIdentityCheck[]
): Promise<IdentityVerificationResult[]> {
  // Process authors in batches to avoid overwhelming APIs
  const results: IdentityVerificationResult[] = [];
  
  for (const author of authors) {
    const result = await verifyAuthorIdentity(author);
    results.push(result);
    
    // Small delay between requests to be polite to APIs
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return results;
}
