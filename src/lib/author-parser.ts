/**
 * Author Name Parser
 * Parses raw author lists from manuscripts into structured author data
 * Similar to the PLOS Search String Generator macro
 */

import { matchFullNames, normalizeString } from "./name-matcher";

export interface ParsedAuthor {
  fullName: string;
  surname: string;
  firstName: string;
  middleInitials: string;
  surnamePrefix: string; // van, de, von, etc.
  pubmedFormat: string; // "Surname FI[au]"
  scholarFormat: string; // author:"First Surname"
  normalizedName: string; // for fuzzy matching
}

// Titles to remove
const TITLES = [
  "Prof.", "Prof", "Professor",
  "Dr.", "Dr", "Doctor",
  "Sir", "Lady", "Lord",
  "Mr.", "Mr", "Mrs.", "Mrs", "Ms.", "Ms", "Miss",
  "Rev.", "Rev",
];

// Suffixes to remove
const SUFFIXES = [
  "Jr.", "Jr", "Junior",
  "Sr.", "Sr", "Senior",
  "II", "III", "IV", "V",
  "PhD", "Ph.D.", "Ph.D",
  "MD", "M.D.", "M.D",
  "MSc", "M.Sc.", "M.Sc",
  "BSc", "B.Sc.", "B.Sc",
  "MBA", "M.B.A.",
  "Esq.", "Esq",
];

// Surname prefixes to keep with surname
const SURNAME_PREFIXES = [
  "van", "von", "de", "del", "della", "di", "da",
  "le", "la", "du", "des",
  "den", "der", "ten", "ter",
  "el", "al", "bin", "ibn",
  "mac", "mc", "o'",
];

/**
 * Parse a raw author list string into structured author data
 */
export function parseAuthorList(rawInput: string): ParsedAuthor[] {
  const authors: ParsedAuthor[] = [];
  
  // Clean the input
  let cleaned = rawInput
    // Remove superscript numbers (affiliations)
    .replace(/[\u2070-\u209F\u00B9\u00B2\u00B3]+/g, "")
    // Remove common affiliation patterns
    .replace(/\d+(?:,\d+)*/g, " ")
    // Remove special symbols
    .replace(/[☯†‡§¶#*∗⁎]/g, "")
    // Remove content in superscript-like positions
    .replace(/\s*[a-z],(?=[A-Z])/g, ",")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();

  // Split by common separators
  const authorStrings = cleaned
    .split(/\s*(?:,\s*(?:and\s+)?|;\s*|\s+and\s+)\s*/i)
    .filter(s => s.trim().length > 0);

  for (const authorStr of authorStrings) {
    const parsed = parseAuthorName(authorStr.trim());
    if (parsed && parsed.surname) {
      authors.push(parsed);
    }
  }

  // Remove duplicates using fuzzy matching
  const uniqueAuthors: ParsedAuthor[] = [];
  
  for (const author of authors) {
    let isDuplicate = false;
    
    for (const existing of uniqueAuthors) {
      const match = matchFullNames(
        author.firstName,
        author.surname,
        existing.firstName,
        existing.surname
      );
      
      if (match.isMatch && match.confidence >= 0.85) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      uniqueAuthors.push(author);
    }
  }
  
  return uniqueAuthors;
}

/**
 * Parse a single author name
 */
export function parseAuthorName(name: string): ParsedAuthor | null {
  if (!name || name.trim().length === 0) return null;

  let cleaned = name.trim();

  // Remove content in parentheses (alternative names)
  cleaned = cleaned.replace(/\([^)]*\)/g, "").trim();

  // Remove titles
  for (const title of TITLES) {
    const regex = new RegExp(`^${escapeRegex(title)}\\s+`, "i");
    cleaned = cleaned.replace(regex, "");
  }

  // Remove suffixes
  for (const suffix of SUFFIXES) {
    const regex = new RegExp(`[,\\s]+${escapeRegex(suffix)}\\.?$`, "i");
    cleaned = cleaned.replace(regex, "");
  }

  cleaned = cleaned.trim();
  if (!cleaned) return null;

  // Split into parts
  const parts = cleaned.split(/\s+/).filter(p => p.length > 0);
  if (parts.length === 0) return null;

  let firstName = "";
  let middleInitials = "";
  let surname = "";
  let surnamePrefix = "";

  if (parts.length === 1) {
    // Single name (mononym)
    surname = parts[0];
  } else if (parts.length === 2) {
    // First Last
    firstName = parts[0];
    surname = parts[1];
  } else {
    // Multiple parts - check for surname prefixes
    firstName = parts[0];
    
    // Check if any middle parts are surname prefixes
    let surnameStartIndex = parts.length - 1;
    
    for (let i = 1; i < parts.length - 1; i++) {
      const part = parts[i].toLowerCase().replace(/[.']/g, "");
      if (SURNAME_PREFIXES.includes(part)) {
        surnamePrefix = parts.slice(i, parts.length - 1).join(" ");
        surname = parts[parts.length - 1];
        middleInitials = parts.slice(1, i).map(extractInitial).join("");
        surnameStartIndex = i;
        break;
      }
    }

    if (!surnamePrefix) {
      // No prefix found - last part is surname, middle parts are initials
      surname = parts[parts.length - 1];
      middleInitials = parts.slice(1, parts.length - 1).map(extractInitial).join("");
    }
  }

  // Extract first initial
  const firstInitial = extractInitial(firstName);
  
  // Clean surname
  surname = surname.replace(/[,.:;]/g, "").trim();
  
  // Build full surname with prefix
  const fullSurname = surnamePrefix 
    ? `${surnamePrefix} ${surname}` 
    : surname;

  // Build formats
  const initials = firstInitial + middleInitials;
  const pubmedFormat = `${fullSurname} ${initials}[au]`;
  const scholarFormat = `author:"${firstName} ${fullSurname}"`;

  return {
    fullName: cleaned,
    surname: fullSurname,
    firstName,
    middleInitials,
    surnamePrefix,
    pubmedFormat,
    scholarFormat,
    normalizedName: normalizeString(`${firstName} ${fullSurname}`),
  };
}

/**
 * Extract initial from a name part
 */
function extractInitial(part: string): string {
  if (!part) return "";
  // Handle initials with periods (e.g., "J." -> "J")
  const cleaned = part.replace(/\./g, "").trim();
  if (cleaned.length <= 2) return cleaned.toUpperCase();
  return cleaned[0].toUpperCase();
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate PubMed search string for finding co-authored papers
 */
export function generatePubMedSearchString(
  authors: ParsedAuthor[],
  reviewerName?: string
): string {
  if (authors.length === 0) return "";

  const authorQueries = authors.map(a => a.pubmedFormat).join(" OR ");
  
  if (reviewerName) {
    const reviewer = parseAuthorName(reviewerName);
    if (reviewer) {
      return `${reviewer.pubmedFormat} AND (${authorQueries})`;
    }
  }

  return `Reviewer N[au] AND (${authorQueries})`;
}

/**
 * Generate PubMed URL
 */
export function generatePubMedUrl(
  authors: ParsedAuthor[],
  reviewerName?: string
): string {
  const query = generatePubMedSearchString(authors, reviewerName);
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
}

/**
 * Generate Google Scholar search string
 */
export function generateScholarSearchString(
  authors: ParsedAuthor[],
  reviewerName?: string
): string {
  if (authors.length === 0) return "";

  const authorQueries = authors.map(a => a.scholarFormat).join(" OR ");
  
  if (reviewerName) {
    const reviewer = parseAuthorName(reviewerName);
    if (reviewer) {
      return `${reviewer.scholarFormat} ${authorQueries}`;
    }
  }

  return authorQueries;
}

/**
 * Generate Google Scholar URL
 */
export function generateScholarUrl(
  authors: ParsedAuthor[],
  reviewerName?: string
): string {
  const query = generateScholarSearchString(authors, reviewerName);
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
}

/**
 * Generate OpenAlex search queries for each author
 */
export function generateOpenAlexQueries(authors: ParsedAuthor[]): string[] {
  return authors.map(a => `${a.firstName} ${a.surname}`.trim());
}
