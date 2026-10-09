/**
 * Title page, summary, required statements and the methods block.
 *
 * Statements are located two ways: by their heading, and — when the heading is
 * missing — by the wording journals ask for ("Further information and requests
 * … Lead Contact", "did not generate new unique reagents", "Written informed
 * consent"). A statement found by wording keeps a synthetic headingText that
 * says so, which lets a check report "the text is there but the required
 * heading is not".
 */

import type {
  FigureLegend,
  Heading,
  ManuscriptStatements,
  Section,
  Statement,
  StarMethodsBlock,
  SummaryBlock,
  TableCaption,
  TextSpan,
} from "./model-types";
import { STAR_GROUP_HEADINGS, findHeading, findLastHeading, sectionTextFor } from "./headings";
import {
  collapse,
  countWords,
  paragraphs,
  type IndexedLine,
} from "./text-utils";

const FRONT_MATTER_END =
  /^(summary|abstract|highlights|introduction|graphical abstract|keywords?)$/;
const AUTHOR_LINE =
  /\b[A-Z][\p{L}'’-]+\s+[A-Z][\p{L}'’-]+\s*(?:\d|\*|†|‡|§|¶)|\b[A-Z][\p{L}'’-]+,\s*[A-Z]\.(?:\s*[A-Z]\.)*(?:\s*\d)?/u;
const AFFILIATION_HINT =
  /\b(?:universit|institut|department|hospital|school|college|facult|laborator|cent(?:er|re)|division|clinic|academy|ministry|polytechnic)/i;
const AFFILIATION_MARKER = /^\s*(?:\d{1,2}|[*†‡§¶#])\s*[,.]?\s*(?=[A-Z])/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// Separate non-global copy: a /g regex keeps lastIndex between .test() calls.
const EMAIL_TEST = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const SKIP_FRONT_LINE =
  /^(article|research article|original article|letter|resource|report|manuscript|revised manuscript|running (?:title|head)|short title|classification|keywords?|word count|title page|for (?:review|submission))\b/i;

export interface FrontMatter {
  title?: string;
  authorsLine?: string;
  affiliations: string[];
  correspondingEmails: string[];
  hasLeadContactFootnote: boolean;
}

/** The region before the Summary/Abstract heading; the title page. */
export function frontMatterRegion(text: string, outline: Heading[]): TextSpan {
  const first = outline.find((h) => FRONT_MATTER_END.test(h.normalized));
  const end = first ? first.span.start : Math.min(text.length, 2500);
  return { start: 0, end };
}

export function parseFrontMatter(
  text: string,
  lines: IndexedLine[],
  outline: Heading[]
): FrontMatter {
  const region = frontMatterRegion(text, outline);
  const head = lines.filter((l) => l.start < region.end && l.text.trim().length > 0);

  // --- Title: the first lines before the author list ---
  const titleParts: string[] = [];
  let cursor = 0;
  for (; cursor < head.length; cursor += 1) {
    const raw = head[cursor].text.trim();
    if (SKIP_FRONT_LINE.test(raw)) continue;
    if (/^\d+$/.test(raw)) continue;
    if (AUTHOR_LINE.test(raw) || EMAIL_TEST.test(raw) || AFFILIATION_HINT.test(raw)) break;
    titleParts.push(raw.replace(/^title\s*:\s*/i, ""));
    // A title that ends without punctuation may wrap onto the next line.
    if (titleParts.length >= 3) {
      cursor += 1;
      break;
    }
    if (/[.?!]$/.test(raw)) {
      cursor += 1;
      break;
    }
    const next = head[cursor + 1]?.text.trim();
    if (!next || AUTHOR_LINE.test(next) || AFFILIATION_HINT.test(next)) {
      cursor += 1;
      break;
    }
  }
  const title = titleParts.length > 0 ? collapse(titleParts.join(" ")) : undefined;

  // --- Authors: consecutive author-ish lines after the title ---
  const authorLines: string[] = [];
  for (let i = cursor; i < head.length; i += 1) {
    const raw = head[i].text.trim();
    if (AFFILIATION_HINT.test(raw) || AFFILIATION_MARKER.test(raw)) break;
    if (AUTHOR_LINE.test(raw) || (authorLines.length > 0 && /^[,;]/.test(raw))) {
      authorLines.push(raw);
      continue;
    }
    if (authorLines.length > 0) break;
  }
  const authorsLine = authorLines.length > 0 ? collapse(authorLines.join(" ")) : undefined;

  // --- Affiliations: grouped by their superscript markers ---
  const affiliations: string[] = [];
  let current = "";
  for (let i = cursor; i < head.length; i += 1) {
    const raw = head[i].text.trim();
    if (!AFFILIATION_HINT.test(raw) && !AFFILIATION_MARKER.test(raw) && current === "") continue;
    if (/^\*?\s*(correspond|e-?mail|lead contact)/i.test(raw)) break;
    if (AFFILIATION_MARKER.test(raw) || current === "") {
      if (current) affiliations.push(collapse(current));
      current = raw;
    } else {
      current += ` ${raw}`;
    }
    if (/[.;]$/.test(raw) && AFFILIATION_HINT.test(current)) {
      affiliations.push(collapse(current));
      current = "";
    }
  }
  if (current && AFFILIATION_HINT.test(current)) affiliations.push(collapse(current));

  const headText = text.slice(region.start, region.end);
  const emails = [...new Set(headText.match(EMAIL) ?? [])];
  const correspondingEmails =
    emails.length > 0 ? emails : [...new Set(text.match(EMAIL) ?? [])].slice(0, 4);

  return {
    title,
    authorsLine,
    affiliations: affiliations.filter((a) => a.length > 10),
    correspondingEmails,
    // Only the title page counts: a Lead Contact sentence in Resource
    // Availability is not the footnote the journal asks for.
    hasLeadContactFootnote: /lead\s+contact/i.test(headText),
  };
}

const CITATION_IN_TEXT =
  /\[\d{1,3}(?:\s*[,–-]\s*\d{1,3})*\]|\(\s*[A-Z][\p{L}'’-]+(?:\s+et\s+al\.?)?,?\s*(?:19|20)\d{2}[a-z]?\s*\)|(?<=[a-z]{3})\d{1,3}(?:\s*[,–-]\s*\d{1,3})*(?=[\s.,;:)]|$)|\brefs?\.\s*\d/u;

export function parseSummary(text: string, outline: Heading[]): SummaryBlock | undefined {
  const heading = findHeading(outline, /^(summary|abstract)$/);
  if (!heading) return undefined;
  const { body } = sectionTextFor(text, outline, heading);
  const flat = collapse(body);
  if (flat.length === 0) return undefined;
  return {
    headingText: heading.text,
    text: flat,
    wordCount: countWords(flat),
    paragraphCount: Math.max(1, paragraphs(body).length),
    containsCitations: CITATION_IN_TEXT.test(flat),
  };
}

interface StatementRule {
  key: Exclude<keyof ManuscriptStatements, "highlights">;
  headingRe?: RegExp;
  /** Wording used when the heading is absent. */
  contentRe?: RegExp;
  /** Label reported when the statement was found by wording only. */
  contentLabel: string;
}

const STATEMENT_RULES: StatementRule[] = [
  {
    key: "resourceAvailability",
    headingRe: /^resource availability$/,
    contentLabel: "(resource availability wording)",
  },
  {
    key: "leadContact",
    headingRe: /^lead contacts?$/,
    contentRe: /\blead contact\b/i,
    contentLabel: "(lead contact wording)",
  },
  {
    key: "materialsAvailability",
    headingRe: /^materials? availability$/,
    contentRe:
      /did not generate (?:any )?new unique reagents|no new (?:unique )?(?:reagents|materials) were generated|materials? (?:generated|used) in this study (?:are|will be|is) available/i,
    contentLabel: "(materials availability wording)",
  },
  {
    key: "dataAndCodeAvailability",
    headingRe: /^data and code availability$/,
    contentRe: /\bdata and code availability\b/i,
    contentLabel: "(data and code availability wording)",
  },
  {
    key: "dataAvailability",
    headingRe: /^data availability( statement)?$/,
    contentRe:
      /(?:data|sequencing data|raw data)[^.\n]{0,80}(?:have|has) been deposited|data (?:are|is) available (?:at|in|from)|\bdata availability\b/i,
    contentLabel: "(data availability wording)",
  },
  {
    key: "codeAvailability",
    headingRe: /^code availability( statement)?$/,
    contentRe:
      /\bcode availability\b|(?:custom (?:code|scripts?)|analysis code|code)[^.\n]{0,80}(?:available|deposited|github|zenodo)/i,
    contentLabel: "(code availability wording)",
  },
  {
    key: "limitations",
    headingRe: /^(limitations( of (the|this) study)?|limitations of study|study limitations)$/,
    contentRe: /limitations? of (?:the |this |our )?stud(?:y|ies)/i,
    contentLabel: "(limitations wording)",
  },
  {
    key: "acknowledgments",
    headingRe: /^acknowledge?ments?$/,
    contentLabel: "(acknowledgments wording)",
  },
  {
    key: "authorContributions",
    headingRe: /^(author contributions?|credit authorship contribution statement|contributions)$/,
    contentRe:
      /\bauthor contributions?\b|conceived (?:the study|and designed)|wrote the (?:paper|manuscript)/i,
    contentLabel: "(author contributions wording)",
  },
  {
    key: "declarationOfInterests",
    headingRe:
      /^(declaration of (competing )?interests?|competing (financial )?interests?|conflicts? of interests?|declaration of conflicting interests|disclosures?)$/,
    contentRe:
      /authors? declare[^.\n]{0,60}(?:competing|conflict)|no (?:competing|conflicting) interests?/i,
    contentLabel: "(declaration of interests wording)",
  },
  {
    key: "aiDeclaration",
    headingRe: /^declaration of (use of )?generative ai.*$/,
    contentRe: /\bgenerative ai\b|ai-assisted technolog/i,
    contentLabel: "(generative AI wording)",
  },
  {
    key: "inclusionAndDiversity",
    headingRe: /^inclusion and diversity$/,
    contentRe: /we support inclusive, diverse|\binclusion and diversity\b/i,
    contentLabel: "(inclusion and diversity wording)",
  },
  {
    key: "ethicsAnimal",
    headingRe: /^(animal (ethics|studies|welfare|experiments))$/,
    contentRe:
      /Institutional Animal Care[^.\n]{0,40}Use Committee|\bIACUC\b|animal (?:experiments?|procedures?|protocols?|studies|work|care)[^.\n]{0,80}(?:approved|in accordance with)|approved by the animal/i,
    contentLabel: "(animal ethics wording)",
  },
  {
    key: "ethicsHuman",
    contentRe:
      /(?:Ethics Committee|Institutional Review Board|Research Ethics Board)|\bIRB\b|Declaration of Helsinki|human (?:samples?|subjects?|participants?|tissues?)[^.\n]{0,80}(?:approved|consent)/i,
    contentLabel: "(human ethics wording)",
  },
  {
    key: "informedConsent",
    contentRe: /\binformed consent\b/i,
    contentLabel: "(informed consent wording)",
  },
  {
    key: "keyResourcesTable",
    headingRe: /^key resources? table$/,
    contentRe: /\bkey resources? table\b/i,
    contentLabel: "(key resources table wording)",
  },
  {
    key: "additionalResources",
    headingRe: /^additional resources$/,
    contentLabel: "(additional resources wording)",
  },
];

/** Expands a match to the sentence that contains it. */
function sentenceAround(text: string, span: TextSpan): Statement["text"] {
  const windowStart = Math.max(0, span.start - 400);
  const before = text.lastIndexOf(".", span.start);
  const start = before > windowStart ? before + 1 : windowStart;
  let end = text.indexOf(".", span.end);
  if (end === -1 || end > span.end + 400) end = Math.min(text.length, span.end + 400);
  return collapse(text.slice(start, end + 1));
}

/** Truncates a statement body so evidence quotes stay readable. */
function statementText(body: string): string {
  const flat = collapse(body);
  return flat.length > 1200 ? `${flat.slice(0, 1200)}…` : flat;
}

export function parseStatements(
  text: string,
  outline: Heading[],
  /** Section tree, accepted for symmetry with the other parsers. */
  sections?: Section[]
): ManuscriptStatements {
  void sections;
  const statements: ManuscriptStatements = {};

  for (const rule of STATEMENT_RULES) {
    let found: Statement | undefined;
    if (rule.headingRe) {
      const heading = findHeading(outline, rule.headingRe);
      if (heading) {
        const { body, span } = sectionTextFor(text, outline, heading);
        found = { headingText: heading.text, text: statementText(body), span };
      }
    }
    if (!found && rule.contentRe) {
      const re = new RegExp(rule.contentRe.source, rule.contentRe.flags.replace("g", ""));
      const m = re.exec(text);
      if (m) {
        const span = { start: m.index, end: m.index + m[0].length };
        found = { headingText: rule.contentLabel, text: sentenceAround(text, span), span };
      }
    }
    if (found) statements[rule.key] = found;
  }

  const highlights = parseHighlights(text, outline);
  if (highlights) statements.highlights = highlights;
  return statements;
}

/** Highlights: a short bullet list under a "Highlights" heading. */
export function parseHighlights(
  text: string,
  outline: Heading[]
): ManuscriptStatements["highlights"] {
  const heading = findHeading(outline, /^highlights$/);
  if (!heading) return undefined;
  const { body, span } = sectionTextFor(text, outline, heading);
  const bullets = body
    .split("\n")
    .map((l) => l.replace(/^\s*[•‣●▪*\-–]\s*/, "").trim())
    .filter((l) => l.length > 0 && l.length <= 200)
    .slice(0, 8);
  if (bullets.length === 0) return undefined;
  return { bullets, span };
}

const METHODS_HEADING =
  /^(star ?★? ?methods|star methods|materials and methods|methods and materials|methods|online methods|experimental procedures|methods and protocols)$/;

export function parseStarMethods(
  text: string,
  outline: Heading[],
  figureLegends: FigureLegend[],
  tableCaptions: TableCaption[],
  statements: ManuscriptStatements
): StarMethodsBlock {
  const heading = findLastHeading(outline, METHODS_HEADING);
  if (!heading) {
    return {
      present: false,
      headings: [],
      hasKeyResourcesTable: statements.keyResourcesTable !== undefined,
      numberedSubheadings: false,
      subheadingDepth: 0,
      tablesEmbedded: 0,
      figuresEmbedded: 0,
    };
  }

  const { span } = sectionTextFor(text, outline, heading);
  const subheadings = outline.filter(
    (h) => h !== heading && h.span.start > heading.span.end && h.span.start < span.end
  );
  const starGroups = subheadings.filter((h) => STAR_GROUP_HEADINGS.includes(h.normalized));
  const isStarNamed = /star\s*★?\s*methods/.test(heading.normalized);

  const deepest = subheadings.reduce<number>((max, h) => Math.max(max, h.level), heading.level);
  return {
    // "STAR Methods" by name, or the canonical group headings in place.
    present: isStarNamed || starGroups.length >= 2,
    headingText: heading.text,
    headings: subheadings.map((h) => h.text),
    hasKeyResourcesTable:
      statements.keyResourcesTable !== undefined ||
      subheadings.some((h) => /^key resources? table$/.test(h.normalized)),
    numberedSubheadings: subheadings.some((h) => /^\s*\d+(?:\.\d+)*[.)]?\s+\S/.test(h.text)),
    subheadingDepth: Math.max(0, deepest - heading.level),
    tablesEmbedded: tableCaptions.filter(
      (t) => t.span.start >= heading.span.start && t.span.start < span.end
    ).length,
    figuresEmbedded: figureLegends.filter(
      (f) => f.span.start >= heading.span.start && f.span.start < span.end
    ).length,
  };
}
