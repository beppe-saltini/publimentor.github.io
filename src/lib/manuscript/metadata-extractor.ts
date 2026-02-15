/**
 * LLM-based Metadata Extraction Service
 * 
 * Uses Claude to extract structured metadata from manuscript text
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// Maximum text length to send to LLM (to manage costs and context limits)
const MAX_TEXT_LENGTH = 100000; // ~25k tokens

/**
 * Sanitize string to prevent XSS when LLM output is displayed.
 * Uses an allowlist approach: strips ALL HTML tags and decodes entities,
 * leaving only plain text. This is safer than a denylist regex approach.
 */
function sanitizeLLMOutput(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  return input
    // Decode common HTML entities first (prevents encoded bypass)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    // Strip ALL HTML tags (allowlist: permit no tags at all)
    .replace(/<[^>]*>/g, "")
    // Remove any remaining javascript: / data: URI schemes (case-insensitive, whitespace-tolerant)
    .replace(/\b(?:java\s*script|data)\s*:/gi, "")
    .trim();
}

/**
 * Validate that a URL field contains a safe scheme (http/https only).
 * Returns undefined for unsafe or malformed URLs.
 */
function sanitizeUrl(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const cleaned = sanitizeLLMOutput(input);
  if (!cleaned) return undefined;
  // Only allow values that look like identifiers (DOIs, PMIDs) or http(s) URLs
  if (cleaned.match(/^https?:\/\//i)) return cleaned;
  // For non-URL identifier fields (DOI, PMID, ORCID), ensure no scheme is present
  if (cleaned.includes(":") && !cleaned.match(/^10\./)) return undefined;
  return cleaned;
}

export interface ExtractedAuthor {
  fullName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  orcid?: string;
  affiliationNumbers: number[];
  isCorresponding: boolean;
  equalContribution?: boolean;
}

export interface ExtractedAffiliation {
  number: number;
  rawText: string;
  institutionName?: string;
  department?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface ExtractedReference {
  number: number;
  rawText: string;
  authors?: string;
  title?: string;
  journal?: string;
  year?: number;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  arxivId?: string;
  url?: string;
  refType?: string;
}

export interface ExtractedMetadata {
  // Core fields
  title?: string;
  abstract?: string;
  manuscriptType?: string;
  keywords: string[];
  language?: string;
  detectedJournal?: string; // Journal name detected from manuscript content

  // Authors & affiliations
  authors: ExtractedAuthor[];
  affiliations: ExtractedAffiliation[];
  correspondingAuthor?: {
    name: string;
    email?: string;
    address?: string;
  };

  // Declarations
  declarations: {
    funding?: string;
    conflictOfInterest?: string;
    dataAvailability?: string;
    ethics?: string;
    authorContributions?: string;
  };

  // Statistics
  statistics: {
    wordCount?: number;
    figureCount?: number;
    tableCount?: number;
    referenceCount?: number;
  };

  // References
  references: ExtractedReference[];

  // Extraction metadata
  extractionConfidence: number; // 0-1
  extractionNotes?: string[];
}

/**
 * Extract metadata from manuscript text using Claude
 */
export async function extractMetadata(text: string): Promise<ExtractedMetadata> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  // Truncate text if too long
  const truncatedText = text.length > MAX_TEXT_LENGTH 
    ? text.substring(0, MAX_TEXT_LENGTH) + "\n\n[TEXT TRUNCATED FOR PROCESSING]"
    : text;

  const prompt = buildExtractionPrompt(truncatedText);

  try {
    console.log("[MetadataExtractor] Calling Claude API...");
    
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      // SECURITY: Don't log raw API error body (may contain sensitive data)
      console.error("[MetadataExtractor] API error: status", response.status);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;

    if (!content) {
      throw new Error("Empty response from Claude");
    }

    // Parse JSON from response
    const metadata = parseExtractionResponse(content);
    console.log(`[MetadataExtractor] Extracted: ${metadata.title?.substring(0, 50)}...`);
    
    return metadata;
  } catch (error) {
    console.error("[MetadataExtractor] Extraction failed:", error);
    throw error;
  }
}

/**
 * Build the extraction prompt
 */
function buildExtractionPrompt(text: string): string {
  return `You are an expert at extracting metadata from scientific manuscripts.

Analyze the following manuscript text and extract structured information.

<manuscript>
${text}
</manuscript>

Extract and return a JSON object with the following structure. Be thorough and accurate.

{
  "title": "Full manuscript title",
  "abstract": "Complete abstract text",
  "manuscriptType": "Original Research | Review | Case Report | Letter | Commentary | Meta-Analysis | Systematic Review | Protocol | Other",
  "keywords": ["keyword1", "keyword2", ...],
  "language": "English | Spanish | etc.",
  "detectedJournal": "The journal this manuscript appears to be written/formatted for, if detectable from headers, footers, formatting, or explicit mentions. null if not detectable.",
  
  "authors": [
    {
      "fullName": "First M. Last",
      "firstName": "First",
      "lastName": "Last",
      "email": "email@example.com or null",
      "orcid": "0000-0000-0000-0000 or null",
      "affiliationNumbers": [1, 2],
      "isCorresponding": true or false,
      "equalContribution": true or false
    }
  ],
  
  "affiliations": [
    {
      "number": 1,
      "rawText": "Full affiliation as written",
      "institutionName": "University Name",
      "department": "Department Name or null",
      "city": "City",
      "state": "State or null",
      "country": "Country"
    }
  ],
  
  "correspondingAuthor": {
    "name": "Corresponding author name",
    "email": "email@example.com",
    "address": "Postal address if available"
  },
  
  "declarations": {
    "funding": "Funding statement text or null",
    "conflictOfInterest": "COI statement text or null",
    "dataAvailability": "Data availability statement or null",
    "ethics": "Ethics approval statement or null",
    "authorContributions": "Author contributions or null"
  },
  
  "statistics": {
    "wordCount": estimated number,
    "figureCount": number of figures mentioned,
    "tableCount": number of tables mentioned,
    "referenceCount": number of references
  },
  
  "references": [
    {
      "number": 1,
      "rawText": "Original reference text",
      "authors": "Author names",
      "title": "Article title",
      "journal": "Journal name",
      "year": 2024,
      "volume": "vol",
      "issue": "issue number or null",
      "pages": "pp-pp",
      "doi": "10.xxxx/xxxxx or null",
      "pmid": "12345678 or null",
      "pmcid": "PMC1234567 or null",
      "arxivId": "2301.12345 or null",
      "url": "URL if present",
      "refType": "journal | book | conference | thesis | website | preprint | other"
    }
  ],
  
  "extractionConfidence": 0.0 to 1.0 (your confidence in the extraction accuracy),
  "extractionNotes": ["Any issues or uncertainties noted during extraction"]
}

Important extraction rules:
1. Extract ALL authors in their listed order
2. The corresponding author is usually marked with * or "Corresponding author" or "To whom correspondence..."
3. Parse affiliations with their superscript numbers (1, 2, 3, †, ‡, etc.)
4. Extract ALL references in order
5. For author names, parse into firstName and lastName when possible
6. Detect ORCID patterns (0000-0000-0000-0000)
7. Detect email patterns
8. If any field is uncertain, set it to null rather than guessing
9. For DOIs, extract the full DOI (10.xxxx/...)
10. For PMIDs, extract just the number
11. For PMCIDs, extract the full PMC ID (PMC followed by digits)
12. For arXiv IDs, extract the identifier (e.g., 2301.12345 or math/0601001)

Return ONLY valid JSON, no other text.`;
}

/**
 * Parse the extraction response from Claude
 */
export function parseExtractionResponse(content: string): ExtractedMetadata {
  // Try to extract JSON from the response
  let jsonStr = content.trim();

  // Handle markdown code blocks
  if (jsonStr.includes("```json")) {
    jsonStr = jsonStr.split("```json")[1].split("```")[0].trim();
  } else if (jsonStr.includes("```")) {
    jsonStr = jsonStr.split("```")[1].split("```")[0].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    
    // Validate, sanitize, and provide defaults
    // SECURITY: Sanitize all string outputs from LLM to prevent stored XSS
    return {
      title: sanitizeLLMOutput(parsed.title),
      abstract: sanitizeLLMOutput(parsed.abstract),
      manuscriptType: sanitizeLLMOutput(parsed.manuscriptType),
      keywords: Array.isArray(parsed.keywords) 
        ? parsed.keywords.map((k: string) => sanitizeLLMOutput(k)).filter(Boolean) as string[]
        : [],
      language: sanitizeLLMOutput(parsed.language) || "English",
      detectedJournal: sanitizeLLMOutput(parsed.detectedJournal),
      authors: Array.isArray(parsed.authors) ? parsed.authors.map(normalizeAuthor) : [],
      affiliations: Array.isArray(parsed.affiliations) 
        ? parsed.affiliations.map(sanitizeAffiliation) 
        : [],
      correspondingAuthor: parsed.correspondingAuthor 
        ? {
            name: sanitizeLLMOutput(parsed.correspondingAuthor.name) || "",
            email: sanitizeLLMOutput(parsed.correspondingAuthor.email),
            address: sanitizeLLMOutput(parsed.correspondingAuthor.address),
          }
        : undefined,
      declarations: {
        funding: sanitizeLLMOutput(parsed.declarations?.funding),
        conflictOfInterest: sanitizeLLMOutput(parsed.declarations?.conflictOfInterest),
        dataAvailability: sanitizeLLMOutput(parsed.declarations?.dataAvailability),
        ethics: sanitizeLLMOutput(parsed.declarations?.ethics),
        authorContributions: sanitizeLLMOutput(parsed.declarations?.authorContributions),
      },
      statistics: parsed.statistics || {},
      references: Array.isArray(parsed.references) 
        ? parsed.references.map(sanitizeReference) 
        : [],
      extractionConfidence: typeof parsed.extractionConfidence === "number" 
        ? Math.min(1, Math.max(0, parsed.extractionConfidence))
        : 0.5,
      extractionNotes: Array.isArray(parsed.extractionNotes) 
        ? parsed.extractionNotes.map((n: string) => sanitizeLLMOutput(n)).filter(Boolean) as string[]
        : undefined,
    };
  } catch (error) {
    console.error("[MetadataExtractor] Failed to parse JSON:", error);
    // SECURITY: Don't log manuscript content to server logs
    console.error("[MetadataExtractor] Content length:", jsonStr.length, "chars");
    
    // Return minimal metadata
    return {
      keywords: [],
      authors: [],
      affiliations: [],
      declarations: {},
      statistics: {},
      references: [],
      extractionConfidence: 0,
      extractionNotes: ["Failed to parse LLM response"],
    };
  }
}

/**
 * Normalize and sanitize author data
 */
export function normalizeAuthor(author: Record<string, unknown>): ExtractedAuthor {
  const fullName = sanitizeLLMOutput(String(author.fullName || "")) || "";
  let firstName = author.firstName ? sanitizeLLMOutput(String(author.firstName)) : undefined;
  let lastName = author.lastName ? sanitizeLLMOutput(String(author.lastName)) : undefined;

  // Fallback: if LLM returned only fullName, split into first/last
  if (fullName && !firstName && !lastName) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      firstName = parts.slice(0, -1).join(" ");
      lastName = parts[parts.length - 1];
    } else if (parts.length === 1) {
      lastName = parts[0];
    }
  }

  return {
    fullName,
    firstName,
    lastName,
    email: author.email ? sanitizeLLMOutput(String(author.email)) : undefined,
    orcid: normalizeOrcid(author.orcid),
    affiliationNumbers: Array.isArray(author.affiliationNumbers)
      ? author.affiliationNumbers.map(Number).filter(n => !isNaN(n) && n > 0 && n < 100)
      : [],
    isCorresponding: Boolean(author.isCorresponding),
    equalContribution: author.equalContribution ? Boolean(author.equalContribution) : undefined,
  };
}

/**
 * Sanitize affiliation data
 */
function sanitizeAffiliation(aff: Record<string, unknown>): ExtractedAffiliation {
  return {
    number: typeof aff.number === "number" ? Math.max(1, Math.min(100, aff.number)) : 0,
    rawText: sanitizeLLMOutput(String(aff.rawText || "")) || "",
    institutionName: sanitizeLLMOutput(aff.institutionName as string),
    department: sanitizeLLMOutput(aff.department as string),
    city: sanitizeLLMOutput(aff.city as string),
    state: sanitizeLLMOutput(aff.state as string),
    country: sanitizeLLMOutput(aff.country as string),
  };
}

/**
 * Sanitize reference data
 */
export function sanitizeReference(ref: Record<string, unknown>): ExtractedReference {
  return {
    number: typeof ref.number === "number" ? Math.max(1, Math.min(1000, ref.number)) : 0,
    rawText: sanitizeLLMOutput(String(ref.rawText || "")) || "",
    authors: sanitizeLLMOutput(ref.authors as string),
    title: sanitizeLLMOutput(ref.title as string),
    journal: sanitizeLLMOutput(ref.journal as string),
    year: typeof ref.year === "number" && ref.year > 1800 && ref.year < 2100 ? ref.year : undefined,
    volume: sanitizeLLMOutput(ref.volume as string),
    issue: sanitizeLLMOutput(ref.issue as string),
    pages: sanitizeLLMOutput(ref.pages as string),
    doi: sanitizeLLMOutput(ref.doi as string),
    pmid: sanitizeLLMOutput(ref.pmid as string),
    pmcid: normalizePmcid(ref.pmcid),
    arxivId: normalizeArxivId(ref.arxivId),
    url: sanitizeUrl(ref.url as string),
    refType: sanitizeLLMOutput(ref.refType as string),
  };
}

/**
 * Normalize ORCID format
 */
function normalizeOrcid(orcid: unknown): string | undefined {
  if (!orcid || typeof orcid !== "string") return undefined;

  // Extract ORCID pattern
  const match = orcid.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i);
  return match ? match[0].toUpperCase() : undefined;
}

/**
 * Normalize and validate PMCID format (e.g., PMC1234567)
 */
function normalizePmcid(pmcid: unknown): string | undefined {
  if (!pmcid || typeof pmcid !== "string") return undefined;
  const cleaned = sanitizeLLMOutput(pmcid);
  if (!cleaned) return undefined;
  const match = cleaned.match(/PMC\d{1,10}/i);
  return match ? match[0].toUpperCase() : undefined;
}

/**
 * Normalize and validate arXiv ID format (e.g., 2301.12345 or math/0601001)
 */
function normalizeArxivId(arxivId: unknown): string | undefined {
  if (!arxivId || typeof arxivId !== "string") return undefined;
  const cleaned = sanitizeLLMOutput(arxivId);
  if (!cleaned) return undefined;
  // New format: YYMM.NNNNN(vN)
  const newFormat = cleaned.match(/\d{4}\.\d{4,5}(v\d+)?/);
  if (newFormat) return newFormat[0];
  // Legacy format: area/YYMMNNN
  const legacyFormat = cleaned.match(/[a-z-]+\/\d{7}/i);
  if (legacyFormat) return legacyFormat[0];
  return undefined;
}
