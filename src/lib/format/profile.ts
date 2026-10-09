/**
 * Journal profile model for the Journal-Ready Formatter & Compliance Checker.
 *
 * A JournalProfile is a list of FormatChecks. Each check asks one editor-facing
 * yes/no question, carries the journal guideline it enforces and the author-facing
 * letter phrase that is pasted into the "please fix" letter when the check fails.
 * Checks are evaluated against a ManuscriptModel (see ./manuscript-model, owned by
 * the parser) by one of three detectors:
 *   - rule:   deterministic TypeScript over the model (fast, explainable);
 *   - llm:    a semantic question answered by Claude in one batched call;
 *   - manual: the editor decides (always reported as "unknown").
 *
 * This file holds the types plus small reusable rule helpers shared by the
 * journal profiles (profiles/iscience.ts, profiles/generic.ts).
 */

import type { ManuscriptModel, Section, Statement, TextSpan } from "./manuscript-model";

// ---------------------------------------------------------------------------
// Types (contract shared with the evaluator, the letter builder and the API)
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "fail" | "review" | "not_applicable" | "unknown";

export type CheckCategory =
  | "file"
  | "title_page"
  | "summary"
  | "body"
  | "sections"
  | "star_methods"
  | "references"
  | "figures"
  | "tables"
  | "supplemental"
  | "statements"
  | "data_deposition"
  | "ethics"
  | "associated_files";

export interface CheckEvidence {
  quote: string;
  location?: string;
  span?: TextSpan;
}

export interface CheckResult {
  checkId: string;
  status: CheckStatus;
  summary: string;
  evidence: CheckEvidence[];
  confidence: "high" | "medium" | "low";
  detector: "rule" | "llm" | "manual";
  letterPhrase?: string;
}

/** What a detector returns: everything in CheckResult that is not bookkeeping. */
export type RuleOutcome = Omit<CheckResult, "checkId" | "detector" | "letterPhrase">;

export type DetectorSpec =
  | { kind: "rule"; evaluate: (m: ManuscriptModel) => RuleOutcome }
  | { kind: "llm"; prompt: (m: ManuscriptModel) => { instructions: string; excerpt: string } | null }
  | { kind: "manual" };

export interface FormatCheck {
  id: string;
  category: CheckCategory;
  /** Editor-facing yes/no question (spreadsheet column A). */
  question: string;
  /** The journal rule being enforced, quoted or paraphrased from the guidelines. */
  guideline: string;
  severity: "required" | "recommended" | "info";
  detector: DetectorSpec;
  /** Author-facing letter text, including the leading "* ". */
  phrase: string;
  /** When present and false for a manuscript the check is reported as not_applicable. */
  appliesWhen?: (m: ManuscriptModel) => boolean;
  /** Where the rule comes from (spreadsheet row, guideline page...). */
  sourceRef?: string;
}

export interface JournalProfile {
  id: string;
  name: string;
  family?: string;
  version: string;
  sourceUrls: string[];
  letterPreamble: string;
  /** Human-readable expected order of the main document sections. */
  sectionOrder: string[];
  checks: FormatCheck[];
}

export interface FormatCheckReport {
  profileId: string;
  profileVersion: string;
  checkedAt: string;
  results: CheckResult[];
  summary: Record<CheckStatus | "total", number>;
  letter: { preamble: string; items: Array<{ checkId: string; text: string }>; text: string };
  stats: {
    wordCount: number;
    pageCount?: number;
    referenceCount: number;
    figureLegendCount: number;
    sourceType: string;
  };
}

/** Editor adjustments applied on top of the automatic results. */
export type CheckOverride = { status?: CheckStatus; note?: string };
export type CheckOverrides = Record<string, CheckOverride>;

// ---------------------------------------------------------------------------
// Outcome constructors
// ---------------------------------------------------------------------------

type Confidence = CheckResult["confidence"];

function outcome(status: CheckStatus, summary: string, evidence: CheckEvidence[] = [], confidence: Confidence = "high"): RuleOutcome {
  return { status, summary, evidence, confidence };
}

export const pass = (summary: string, evidence: CheckEvidence[] = [], confidence: Confidence = "high") =>
  outcome("pass", summary, evidence, confidence);
export const fail = (summary: string, evidence: CheckEvidence[] = [], confidence: Confidence = "high") =>
  outcome("fail", summary, evidence, confidence);
export const review = (summary: string, evidence: CheckEvidence[] = [], confidence: Confidence = "medium") =>
  outcome("review", summary, evidence, confidence);
export const notApplicable = (summary: string, evidence: CheckEvidence[] = []) =>
  outcome("not_applicable", summary, evidence, "high");
export const unknown = (summary: string, evidence: CheckEvidence[] = []) =>
  outcome("unknown", summary, evidence, "low");

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

/**
 * Quote a span of the manuscript text with a little context on each side.
 * Equivalent to the parser's excerpt() but implemented locally so the profile
 * engine has no runtime dependency on the parser module (only type imports).
 */
export function quoteSpan(model: Pick<ManuscriptModel, "text">, span: TextSpan, pad = 0): string {
  const start = Math.max(0, Math.min(span.start, model.text.length));
  const end = Math.max(start, Math.min(span.end, model.text.length));
  const from = Math.max(0, start - pad);
  const to = Math.min(model.text.length, end + pad);
  return model.text.slice(from, to).replace(/\s+/g, " ").trim();
}

/** Evidence item built from a span (quote trimmed to a readable length). */
export function evidenceFromSpan(model: Pick<ManuscriptModel, "text">, span: TextSpan, location?: string, maxLen = 240): CheckEvidence {
  return { quote: clip(quoteSpan(model, span), maxLen), location, span };
}

/** Evidence item built from a plain quote (no span available). */
export function evidenceFromText(quote: string, location?: string, maxLen = 240): CheckEvidence {
  return { quote: clip(quote.replace(/\s+/g, " ").trim(), maxLen), location };
}

export function clip(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen - 1).trimEnd()}…` : text;
}

/** Lower-case, punctuation-free, single-spaced form of a heading for matching. */
export function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** True when a heading matches one of the aliases (whole normalized heading, or starts with it). */
export function headingMatches(heading: string, aliases: readonly string[]): boolean {
  const norm = normalizeHeading(heading);
  if (!norm) return false;
  // Line-numbered PDFs (Nature style) glue the line number to the heading:
  // "Abstract14", "Introduction29". Try the heading without trailing digits too.
  const candidates = [norm, norm.replace(/\s*\d+$/, "")].filter(Boolean);
  return aliases.some((alias) => {
    const a = normalizeHeading(alias);
    return candidates.some((c) => c === a || c.startsWith(`${a} `) || c.endsWith(` ${a}`));
  });
}

/**
 * The heading a statement sits under. The parser uses a synthetic label in
 * parentheses, e.g. "(declaration of interests wording)", when it located the
 * statement by its wording rather than a heading; in that case look for the
 * closest outline heading before the statement, else return undefined.
 */
export function statementHeading(model: ManuscriptModel, statement: Statement): string | undefined {
  const label = statement.headingText.trim();
  if (label && !/^\(.*\)$/.test(label)) return label;
  const before = model.outline.filter((h) => h.span.start <= statement.span.start);
  const nearest = before[before.length - 1];
  if (nearest && statement.span.start - nearest.span.end <= 400) return nearest.text.trim();
  return undefined;
}

// ---------------------------------------------------------------------------
// Section lookup helpers
// ---------------------------------------------------------------------------

/** Depth-first flatten of the section tree. */
export function allSections(model: ManuscriptModel): Section[] {
  const out: Section[] = [];
  const walk = (list: Section[]) => {
    for (const s of list) {
      out.push(s);
      walk(s.children);
    }
  };
  walk(model.sections);
  return out;
}

/** First section whose heading matches any alias, searching the whole tree. */
export function findSection(model: ManuscriptModel, aliases: readonly string[]): Section | undefined {
  return allSections(model).find((s) => headingMatches(s.heading.text, aliases));
}

/** Rule helper: does the manuscript contain a section with one of these names? */
export function hasSection(model: ManuscriptModel, names: readonly string[], label = names[0]): RuleOutcome {
  const section = findSection(model, names);
  if (section) {
    return pass(`"${section.heading.text.trim()}" section present`, [evidenceFromSpan(model, section.heading.span, "heading")]);
  }
  const outlineHit = model.outline.find((h) => headingMatches(h.text, names));
  if (outlineHit) {
    return pass(`"${outlineHit.text.trim()}" heading present`, [evidenceFromSpan(model, outlineHit.span, "heading")]);
  }
  return fail(`No "${label}" section found`);
}

/** One expected slot of a section order: a label and the headings that satisfy it. */
export interface OrderSlot {
  slot: string;
  aliases: readonly string[];
  /** Optional slots do not fail the check when missing. */
  optional?: boolean;
  /** Alternative locator (e.g. a statement span) used when no heading matches. */
  locate?: (m: ManuscriptModel) => TextSpan | undefined;
}

export interface OrderCheckDetail {
  slot: string;
  found: boolean;
  headingText?: string;
  start?: number;
}

/** Locate each slot and report which are missing or out of order. */
export function analyseSectionOrder(model: ManuscriptModel, expected: readonly OrderSlot[]): {
  details: OrderCheckDetail[];
  missing: string[];
  outOfOrder: string[];
} {
  const details: OrderCheckDetail[] = expected.map((slot) => {
    const heading = model.outline.find((h) => headingMatches(h.text, slot.aliases));
    if (heading) return { slot: slot.slot, found: true, headingText: heading.text.trim(), start: heading.span.start };
    const span = slot.locate?.(model);
    if (span) return { slot: slot.slot, found: true, headingText: slot.slot, start: span.start };
    return { slot: slot.slot, found: false };
  });
  const missing = expected.filter((slot, i) => !slot.optional && !details[i].found).map((s) => s.slot);
  const outOfOrder: string[] = [];
  let lastStart = -1;
  let lastSlot = "";
  for (const d of details) {
    if (!d.found || d.start === undefined) continue;
    if (d.start < lastStart) outOfOrder.push(`${d.slot} appears before ${lastSlot}`);
    else {
      lastStart = d.start;
      lastSlot = d.slot;
    }
  }
  return { details, missing, outOfOrder };
}

/** Rule helper: required sections present and in the expected order. */
export function sectionOrderCheck(
  model: ManuscriptModel,
  expected: readonly OrderSlot[],
  options: { allowMissing?: boolean } = {}
): RuleOutcome {
  const { details, missing, outOfOrder } = analyseSectionOrder(model, expected);
  const evidence: CheckEvidence[] = details
    .filter((d) => d.found && d.headingText)
    .map((d) => ({ quote: d.headingText as string, location: d.slot, span: d.start !== undefined ? { start: d.start, end: d.start + (d.headingText?.length ?? 0) } : undefined }));
  const problems: string[] = [];
  if (missing.length && !options.allowMissing) problems.push(`missing: ${missing.join(", ")}`);
  if (outOfOrder.length) problems.push(`out of order: ${outOfOrder.join("; ")}`);
  if (problems.length) return fail(`Section structure differs from the journal order (${problems.join(" | ")})`, evidence);
  if (missing.length) return review(`All located sections are in order; not found: ${missing.join(", ")}`, evidence);
  return pass("Required sections present and in the expected order", evidence);
}

// ---------------------------------------------------------------------------
// Limits and regex helpers
// ---------------------------------------------------------------------------

export function wordLimit(text: string | undefined, max: number, label: string, location?: string): RuleOutcome {
  if (text === undefined) return unknown(`${label} not found, cannot count words`);
  const n = countWords(text);
  const ev = [evidenceFromText(text, location)];
  return n <= max ? pass(`${label} has ${n} words (limit ${max})`, ev) : fail(`${label} has ${n} words, more than the ${max}-word limit`, ev);
}

export function charLimit(text: string | undefined, max: number, label: string, location?: string): RuleOutcome {
  if (text === undefined) return unknown(`${label} not found, cannot count characters`);
  const n = text.trim().length;
  const ev = [evidenceFromText(text, location)];
  return n <= max ? pass(`${label} has ${n} characters (limit ${max})`, ev) : fail(`${label} has ${n} characters, more than the ${max}-character limit`, ev);
}

/** Collect regex matches with a little context, capped to keep evidence readable. */
export function regexMatches(text: string, pattern: RegExp, offset = 0, pad = 60, limit = 5): CheckEvidence[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const out: CheckEvidence[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < limit) {
    const start = m.index;
    const end = start + m[0].length;
    const quote = text.slice(Math.max(0, start - pad), Math.min(text.length, end + pad)).replace(/\s+/g, " ").trim();
    out.push({ quote: clip(quote, 240), span: { start: start + offset, end: end + offset } });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

export function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return (text.match(new RegExp(pattern.source, flags)) ?? []).length;
}

/** Rule helper: the pattern must NOT occur in the text. */
export function regexAbsent(text: string, pattern: RegExp, label: string, offset = 0): RuleOutcome {
  const hits = regexMatches(text, pattern, offset);
  const total = countMatches(text, pattern);
  return total === 0
    ? pass(`No ${label} found`)
    : fail(`${total} occurrence${total === 1 ? "" : "s"} of ${label}`, hits);
}

/** Rule helper: the pattern MUST occur in the text. */
export function regexPresent(text: string, pattern: RegExp, label: string, offset = 0): RuleOutcome {
  const hits = regexMatches(text, pattern, offset, 60, 3);
  return hits.length ? pass(`${label} present`, hits) : fail(`${label} not found`);
}

/**
 * Rule helper: when a feature is detected, a statement must satisfy a test.
 * The statement test receives the model and returns an outcome; when the feature
 * is absent the check is not applicable (the evaluator also honours appliesWhen,
 * this is for checks that want the feature evidence in their summary).
 */
export function featureImplies(
  model: ManuscriptModel,
  featureKey: keyof ManuscriptModel["features"],
  statementTest: (m: ManuscriptModel) => RuleOutcome
): RuleOutcome {
  const feature = model.features[featureKey];
  if (!feature?.present) return notApplicable(`No ${featureKey} detected in the manuscript`);
  const result = statementTest(model);
  const featureEvidence = feature.evidence.slice(0, 2).map((q) => evidenceFromText(q, `${featureKey} evidence`));
  return { ...result, evidence: [...result.evidence, ...featureEvidence] };
}

/** Evidence for a statement (its heading and first sentence). */
export function statementEvidence(model: ManuscriptModel, statement: Statement): CheckEvidence {
  const quote = statement.text ? statement.text : quoteSpan(model, statement.span);
  return { quote: clip(quote.replace(/\s+/g, " ").trim(), 240), location: statement.headingText, span: statement.span };
}

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// ---------------------------------------------------------------------------
// Blank model factory (tests, legacy wrapper, local adapters)
// ---------------------------------------------------------------------------

const FEATURE_KEYS = [
  "rnaSeq", "proteomics", "microarray", "proteinStructure", "geneSequences", "novelCompounds", "equations", "videos",
  "blotsOrGels", "micrographs", "errorBars", "asterisks", "vertebrates", "humans", "clinicalTrial", "batteriesOrPV",
  "devices", "customCode", "sexReported", "ageReported", "molecularWeightMarkers",
] as const satisfies readonly (keyof ManuscriptModel["features"])[];

/** A ManuscriptModel with every collection empty and every feature absent. */
export function blankModel(overrides: Partial<ManuscriptModel> = {}): ManuscriptModel {
  const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, { present: false, evidence: [] as string[] }])) as unknown as ManuscriptModel["features"];
  return {
    sourceType: "text",
    text: "",
    wordCount: 0,
    affiliations: [],
    correspondingEmails: [],
    hasLeadContactFootnote: false,
    outline: [],
    sections: [],
    figureLegends: [],
    legendsInterspersed: false,
    legendsAfterMainText: false,
    tableCaptions: [],
    supplementalItems: [],
    supplementalMentions: [],
    references: { style: "unknown", count: 0, entries: [], inTextStyle: "unknown", separateSupplementalList: false },
    statements: {},
    starMethods: { present: false, headings: [], hasKeyResourcesTable: false, numberedSubheadings: false, subheadingDepth: 0, tablesEmbedded: 0, figuresEmbedded: 0 },
    features,
    accessions: [],
    phraseHits: { novelty: [], asDescribedPreviously: [], personalCommunication: [] },
    ...overrides,
    ...(overrides.features ? { features: { ...features, ...overrides.features } } : {}),
  };
}
