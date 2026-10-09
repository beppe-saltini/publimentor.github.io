/**
 * Parse a raw reference string into structured fields.
 *
 * Handles the three list styles we meet most often:
 *  - Nature:     "1. Last, F.M., Other, A. & Third, B.C. Title. J Abbrev 23, 445–460 (2024)."
 *  - Cell Press: "Last, F.M., and Other, A. (2024). Title. J. Abbrev. 23, 445–460. https://doi.org/..."
 *  - Vancouver:  "1. Last FM, Other A. Title. J Abbrev. 2024;23(4):445-60."
 * Anything else falls back to the heuristic `parseReferenceFields` from the
 * reference-validation module. Output is best effort: missing fields are
 * simply undefined and the Crossref lookup fills the gaps.
 */
import { parseReferenceFields } from "@/lib/references/reference-metadata-validator";
import type { RepairedReference } from "./types";

export type ParsedAuthor = { family: string; given?: string };

export interface ParsedReference {
  authors: ParsedAuthor[];
  /** True when the author list ended with "et al." */
  truncated: boolean;
  title?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  year?: number;
  doi?: string;
  /** Which grammar matched; "fallback" means only the generic heuristics ran. */
  style: "nature" | "cell-press" | "vancouver" | "fallback";
}

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+?)(?=[.,;)\]]?(?:\s|$))/i;
/** Initials such as "F.M.", "A.M.M.", "J.-P.", "F. M." */
const INIT = String.raw`[A-Z](?:\.\s?-?[A-Z]|-[A-Z])*\.`;
/** Lower-case name particles that may precede a surname ("van der Berg", "de la Cruz"). */
const PARTICLE = String.raw`(?:(?:van|von|de|der|den|del|della|di|da|du|le|la|ter|ten|op|af|el|al|bin|ibn|dos|das|do)\s)`;
/** Surname: optional particles, then unicode letters, apostrophes, hyphens, spaces (van der Berg, D'Andrea). */
const SURNAME = String.raw`${PARTICLE}*[\p{Lu}][\p{L}'’\-]*(?:\s(?:[\p{Ll}]{1,3}\s)?[\p{Lu}][\p{L}'’\-]*)*(?:\s(?:Jr|Sr|II|III)\.?)?`;
const NAME = `${SURNAME},\\s*${INIT}`;
const SEP = String.raw`(?:,\s*&\s*|\s*&\s*|,\s*and\s+|\s+and\s+|,\s*)`;
const AUTHOR_SEQ = new RegExp(`^((?:${NAME})(?:${SEP}(?:${NAME}))*(?:,?\\s*et al\\.)?|${SURNAME},?\\s+et al\\.)\\s*`, "u");

export function extractDoi(raw: string): string | undefined {
  const m = raw.match(DOI_RE);
  if (!m) return undefined;
  return m[1].replace(/[.,;)]+$/, "");
}

/** Normalize dash variants in page ranges to an en dash. */
export function normalizePages(pages: string | undefined): string | undefined {
  if (!pages) return undefined;
  // "96–108 e106" (PDF text lost the dot) -> "96–108.e106"
  return pages
    .replace(/\s*[-‐‑–—]\s*/g, "–")
    .replace(/(\d)\s*\.?\s?(e\d+)$/, "$1.$2")
    .replace(/\s+/g, "")
    .trim();
}

/** Strip a leading list marker: "12. ", "[12] ", "12) ". */
export function stripIndex(raw: string): string {
  return raw.replace(/^\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s*/, "").trim();
}

/** Split a "Last, F.M." sequence into structured authors. */
export function splitAuthors(seq: string): { authors: ParsedAuthor[]; truncated: boolean } {
  const truncated = /\bet al\.?$/.test(seq.trim());
  const clean = seq.replace(/,?\s*et al\.?$/, "").trim();
  const authors: ParsedAuthor[] = [];
  const nameRe = new RegExp(`(${SURNAME}),\\s*(${INIT})`, "gu");
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(clean))) {
    authors.push({ family: m[1].trim(), given: m[2].replace(/\s+/g, "") });
  }
  if (authors.length === 0 && clean) {
    // "Smith et al." with no initials: keep the surname.
    authors.push({ family: clean.replace(/[,.]+$/, "") });
  }
  return { authors, truncated };
}

/** Nature: authors, title, journal volume, pages (year). */
function parseNature(body: string): ParsedReference | null {
  const tail = body.match(/\s\((\d{4})\)\.?\s*$/);
  if (!tail) return null;
  const year = Number(tail[1]);
  const head = body.slice(0, tail.index).trim();
  const authorMatch = head.match(AUTHOR_SEQ);
  if (!authorMatch) return null;
  const { authors, truncated } = splitAuthors(authorMatch[1]);
  let rest = head.slice(authorMatch[0].length).trim();
  // Title ends at the first ". " followed by the journal + volume part.
  // Journal part grammar: "J Abbrev 23, 445–460" | "J Abbrev 23" | "J Abbrev"
  const jvp = rest.match(/\.\s+([A-Z][A-Za-z.&:\-\s]*?)\s+(\d+[A-Za-z]?)(?:\s*\(([^)]+)\))?(?:,\s*([\deE\-‐‑–—a-z]+(?:\s?\.?e\d+)?))?\.?\s*$/);
  let title: string | undefined;
  let journal: string | undefined;
  let volume: string | undefined;
  let issue: string | undefined;
  let pages: string | undefined;
  if (jvp && jvp.index !== undefined) {
    title = rest.slice(0, jvp.index).trim();
    journal = jvp[1].trim();
    volume = jvp[2];
    issue = jvp[3];
    pages = normalizePages(jvp[4]);
  } else {
    // In-press form "Title. Nat Immunol" (no volume).
    const parts = rest.replace(/\.\s*$/, "").split(/\.\s+/);
    if (parts.length >= 2) {
      journal = parts.pop()!.trim();
      title = parts.join(". ").trim();
    } else {
      title = rest.replace(/\.\s*$/, "");
    }
  }
  rest = "";
  return { authors, truncated, title, journal, volume, issue, pages, year, style: "nature" };
}

/** Cell Press: authors (year). Title. J. Abbrev. vol, pages. doi */
function parseCellPress(body: string): ParsedReference | null {
  const m = body.match(/^(.*?)\s\((\d{4})\)\.\s+(.*)$/);
  if (!m) return null;
  const authorMatch = m[1].match(AUTHOR_SEQ);
  if (!authorMatch) return null;
  const { authors, truncated } = splitAuthors(authorMatch[1]);
  const year = Number(m[2]);
  let rest = m[3].replace(/\s*(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?10\.\d{4,9}\/\S+\s*$/i, "").trim();
  const jvp = rest.match(/\.\s+([A-Z][A-Za-z.&:\-\s]*?)\s+(\d+[A-Za-z]?)(?:\s*\(([^)]+)\))?(?:,\s*([\deE\-‐‑–—a-z]+(?:\s?\.?e\d+)?))?\.?\s*$/);
  let title: string | undefined, journal: string | undefined, volume: string | undefined, issue: string | undefined, pages: string | undefined;
  if (jvp && jvp.index !== undefined) {
    title = rest.slice(0, jvp.index).trim();
    journal = jvp[1].trim();
    volume = jvp[2];
    issue = jvp[3];
    pages = normalizePages(jvp[4]);
  } else {
    const parts = rest.replace(/\.\s*$/, "").split(/\.\s+/);
    if (parts.length >= 2) {
      journal = parts.pop()!.trim();
      title = parts.join(". ").trim();
    } else title = rest.replace(/\.\s*$/, "");
  }
  rest = "";
  return { authors, truncated, title, journal, volume, issue, pages, year, style: "cell-press" };
}

/** Vancouver: "Last FM, Other A, et al. Title. J Abbrev. 2024;23(4):445-60." */
function parseVancouver(body: string): ParsedReference | null {
  const m = body.match(/^((?:[\p{Lu}][\p{L}'’\-]+\s[A-Z]{1,3}(?:,\s*)?)+(?:\s*et al\.?)?)\s+(.+?)\.\s+([A-Z][A-Za-z.&:\-\s]*?)\.?\s+(\d{4})(?:\s[A-Za-z]{3})?;?(\d+[A-Za-z]?)?(?:\((\d+)\))?:?([\deE\-‐‑–—a-z]+)?\.?\s*$/u);
  if (!m) return null;
  const authors: ParsedAuthor[] = [];
  const truncated = /et al\.?$/.test(m[1].trim());
  for (const chunk of m[1].replace(/,?\s*et al\.?$/, "").split(/,\s*/)) {
    const nm = chunk.trim().match(/^(.+)\s([A-Z]{1,3})$/u);
    if (nm) authors.push({ family: nm[1], given: nm[2].split("").join(".") + "." });
  }
  return {
    authors,
    truncated,
    title: m[2].trim(),
    journal: m[3].trim(),
    year: Number(m[4]),
    volume: m[5],
    issue: m[6],
    pages: normalizePages(m[7]),
    style: "vancouver",
  };
}

/** Fallback to the generic heuristics of the reference validator. */
function parseFallback(body: string): ParsedReference {
  const f = parseReferenceFields(body);
  const authors = f.authors ? splitAuthors(f.authors).authors : [];
  return { authors, truncated: /et al/.test(body), title: f.title, journal: f.journal, year: f.year, style: "fallback" };
}

/** Parse one raw reference; never throws. */
export function parseRawReference(raw: string): ParsedReference {
  const doi = extractDoi(raw);
  // Collapse whitespace and re-join page ranges broken across lines ("445– 460").
  const body = stripIndex(raw)
    .replace(/\s+/g, " ")
    .replace(/(\d)\s*([-‐‑–—])\s*(\d)/g, "$1$2$3")
    .trim();
  const parsed = parseNature(body) || parseCellPress(body) || parseVancouver(body) || parseFallback(body);
  parsed.doi = doi;
  return parsed;
}

/** Convert parsed output to the public `fields` shape of RepairedReference. */
export function toReferenceFields(p: ParsedReference): RepairedReference["fields"] {
  return {
    authors: p.authors,
    year: p.year,
    title: p.title,
    journal: p.journal,
    journalAbbrev: p.journal,
    volume: p.volume,
    issue: p.issue,
    pages: p.pages,
  };
}
