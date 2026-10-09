/**
 * Render structured reference fields in a journal style.
 *
 * Numbering is NOT included in the output: the document renderer supplies
 * it through a Word numbered list, and the change log adds "n." itself.
 * Styles implemented: cell-press (default for iScience), nature,
 * vancouver and apa. Each style only differs in author punctuation, where
 * the year goes and how volume/pages/DOI are joined, so they share helpers.
 */
import type { RepairedReference, TargetStructure } from "./types";

type Fields = RepairedReference["fields"];
type Author = Fields["authors"][number];
export type ReferenceStyle = TargetStructure["references"]["style"];

export interface RenderOptions {
  /** List all authors up to this count, then truncate with "et al." */
  etAlAfter?: number;
  includeDoi?: boolean;
  doiAsUrl?: boolean;
  doi?: string;
}

const DEFAULTS: Record<ReferenceStyle, Required<Omit<RenderOptions, "doi">>> = {
  "cell-press": { etAlAfter: 10, includeDoi: true, doiAsUrl: true },
  nature: { etAlAfter: 5, includeDoi: true, doiAsUrl: true },
  vancouver: { etAlAfter: 6, includeDoi: true, doiAsUrl: false },
  apa: { etAlAfter: 20, includeDoi: true, doiAsUrl: true },
};

/** "Francesco Maria" -> "F.M."; "Jean-Pierre" -> "J.-P."; "F.M." stays. */
export function initials(given: string | undefined, spaced = false): string {
  if (!given) return "";
  const cleaned = given.replace(/\./g, ". ").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(" ").filter(Boolean);
  const out = parts.map((p) =>
    p
      .split("-")
      .map((h) => (h ? h[0].toUpperCase() + "." : ""))
      .join("-")
  );
  return spaced ? out.join(" ") : out.join("");
}

function nameLastFirst(a: Author, spaced = false): string {
  const ini = initials(a.given, spaced);
  return ini ? `${a.family}, ${ini}` : a.family;
}

/** Cell Press: "A, B., C, D., and E, F." / "A, B., and C, D." / "A, B." */
function authorsCellPress(authors: Author[], etAlAfter: number): string {
  if (authors.length === 0) return "";
  const names = authors.map((a) => nameLastFirst(a));
  if (authors.length > etAlAfter) return names.slice(0, etAlAfter).join(", ") + ", et al.";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, and ${names[1]}`;
  return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
}

/** Nature: "A, B., C, D. & E, F." ; more than etAlAfter -> "A, B. et al." */
function authorsNature(authors: Author[], etAlAfter: number): string {
  if (authors.length === 0) return "";
  const names = authors.map((a) => nameLastFirst(a));
  if (authors.length > etAlAfter) return `${names[0]} et al.`;
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
}

/** Vancouver: "Last FM, Other A, et al." */
function authorsVancouver(authors: Author[], etAlAfter: number): string {
  const names = authors.map((a) => `${a.family} ${initials(a.given).replace(/[.\-]/g, "")}`.trim());
  if (names.length > etAlAfter) return names.slice(0, etAlAfter).join(", ") + ", et al.";
  return names.join(", ");
}

/** APA 7: "Last, F. M., Other, A., & Third, B." ; > 20 authors uses ellipsis. */
function authorsApa(authors: Author[], etAlAfter: number): string {
  const names = authors.map((a) => nameLastFirst(a, true));
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length > etAlAfter) return names.slice(0, etAlAfter - 1).join(", ") + ", ... " + names[names.length - 1];
  return names.slice(0, -1).join(", ") + ", & " + names[names.length - 1];
}

function doiPart(doi: string | undefined, asUrl: boolean): string {
  if (!doi) return "";
  const bare = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  return asUrl ? `https://doi.org/${bare}` : bare;
}

/** Title without a trailing period (we add our own punctuation). */
function cleanTitle(title: string | undefined): string {
  return (title || "").replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
}

/** Journal abbreviation preferred; container title as fallback. */
function journalName(f: Fields): string {
  return (f.journalAbbrev || f.journal || "").trim();
}

/** Append a period unless the text already ends with one ("Nat. Immunol." stays). */
function withPeriod(text: string): string {
  return /\.$/.test(text) ? text : `${text}.`;
}

function joinParts(parts: Array<string | undefined>, sep = " "): string {
  return parts.filter((p) => p && p.trim()).join(sep);
}

/**
 * Render reference fields in `style`. `index` is accepted for parity with
 * the public contract but is not embedded (see module comment).
 */
export function renderReference(fields: Fields, style: ReferenceStyle, _index?: number, options: RenderOptions = {}): string {
  const opt = { ...DEFAULTS[style], ...options };
  const doi = doiPart(opt.includeDoi ? opt.doi : undefined, opt.doiAsUrl);
  const title = cleanTitle(fields.title);
  const journal = journalName(fields);
  const year = fields.year ? String(fields.year) : "";
  const vol = fields.volume || "";
  const pages = fields.pages || "";

  switch (style) {
    case "cell-press": {
      // Last, F.M., and Other, A. (2024). Title. J. Abbrev. 23, 445–460. https://doi.org/...
      const authors = authorsCellPress(fields.authors, opt.etAlAfter);
      const head = joinParts([authors, year ? `(${year}).` : ""]);
      const volPages = vol ? (pages ? `${vol}, ${pages}` : vol) : pages;
      const source = volPages ? joinParts([journal, `${volPages}.`]) : journal ? withPeriod(journal) : "";
      return joinParts([head, title ? `${title}.` : "", source, doi]).trim();
    }
    case "nature": {
      // Last, F.M., Other, A. & Third, B. Title. J. Abbrev. 23, 445–460 (2024).
      const authors = authorsNature(fields.authors, opt.etAlAfter);
      const volPages = vol ? (pages ? `${vol}, ${pages}` : vol) : pages;
      const tail = joinParts([journal, volPages, year ? `(${year}).` : ""]);
      return joinParts([authors, title ? `${title}.` : "", tail, doi]).trim();
    }
    case "vancouver": {
      // Last FM, Other A. Title. J Abbrev. 2024;23(4):445-60. doi:10.x
      const authors = authorsVancouver(fields.authors, opt.etAlAfter);
      const issue = fields.issue ? `(${fields.issue})` : "";
      const locator = joinParts([year, vol ? `;${vol}${issue}` : "", pages ? `:${pages.replace(/–/g, "-")}` : ""], "");
      const source = journal ? `${withPeriod(journal)} ${locator}.` : locator ? `${locator}.` : "";
      return joinParts([authors ? `${authors}.` : "", title ? `${title}.` : "", source, doi ? `doi:${doi}` : ""]).trim();
    }
    case "apa": {
      // Last, F. M., & Other, A. (2024). Title. Journal, 23(4), 445–460. https://doi.org/...
      const authors = authorsApa(fields.authors, opt.etAlAfter);
      const issue = fields.issue ? `(${fields.issue})` : "";
      const volPages = joinParts([vol ? `${vol}${issue}` : "", pages], ", ");
      const source = joinParts([journal ? (volPages ? `${journal},` : withPeriod(journal)) : "", volPages ? `${volPages}.` : ""]);
      return joinParts([authors, year ? `(${year}).` : "", title ? `${title}.` : "", source, doi]).trim();
    }
  }
}
