/**
 * Rule evaluators shared by journal profiles (iScience, generic).
 *
 * Each function takes the ManuscriptModel built by the parser and returns a
 * RuleOutcome (status + human summary + evidence quotes). They stay pure and
 * synchronous so they can be unit-tested with small synthetic models.
 */

import type { FigureLegend, Hit, ManuscriptModel, Section, TextSpan } from "../manuscript-model";
import { methodsLikeSpans } from "../parse/headings";
import {
  type RuleOutcome,
  type CheckEvidence,
  pass,
  fail,
  review,
  unknown,
  notApplicable,
  countWords,
  evidenceFromText,
  evidenceFromSpan,
  findSection,
  headingMatches,
  statementEvidence,
  normalizeHeading,
  clip,
  regexMatches,
} from "../profile";

export const SUMMARY_ALIASES = ["summary", "abstract"] as const;
export const RESULTS_ALIASES = ["results", "results and discussion"] as const;
export const METHODS_ALIASES = [
  "methods", "materials and methods", "material and methods", "star methods", "experimental procedures",
  "methodology", "online methods", "method details", "experimental section", "methods and materials",
] as const;

/** The section holding the methods, whatever the journal calls it. */
export function methodsSection(model: ManuscriptModel): Section | undefined {
  return findSection(model, METHODS_ALIASES);
}

/** Heading plus body of a section and, recursively, of its subsections. */
function flattenSection(section: Section, includeHeading: boolean): string {
  const parts = [includeHeading ? section.heading.text.trim() : "", section.body.trim(), ...section.children.map((c) => flattenSection(c, true))];
  return parts.filter(Boolean).join("\n\n");
}

/**
 * The complete methods text for the semantic (LLM) checks: STAR Methods or a
 * classic "Materials and Methods"/"Methods"/"Experimental procedures" section
 * with all of its subsections. `Section.body` alone is useless here: in a
 * manuscript whose methods are split into subsections the parent body is
 * empty, which is why these checks used to report "no excerpt" on
 * Nature/Vancouver-style papers. The parser's methods-like spans (which also
 * cover the availability statements) are used first; a hand-built model
 * without `text` falls back to the section tree. Undefined when the
 * manuscript has no methods text at all (a review, a perspective).
 */
export function methodsText(model: ManuscriptModel): string | undefined {
  const spans = methodsLikeSpans(model.text, model.outline);
  const fromSpans = spans
    .map((s) => model.text.slice(s.start, s.end).trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (fromSpans) return fromSpans;
  const section = methodsSection(model);
  const fromTree = section ? flattenSection(section, false) : "";
  return fromTree || undefined;
}

/**
 * Does the manuscript have a methods section at all? A review or a
 * perspective has none, and then a mention of mice or patients is not a
 * report of experimental work.
 */
export function hasMethodsSection(model: ManuscriptModel): boolean {
  return Boolean(model.starMethods.headingText) || methodsSection(model) !== undefined || outlineHas(model, METHODS_ALIASES);
}

// ---------------------------------------------------------------------------
// Title and summary
// ---------------------------------------------------------------------------

export function titleCheck(
  model: ManuscriptModel,
  opts: { maxChars: number; maxWords: number; forbidPunctuation?: RegExp }
): RuleOutcome {
  const title = model.title?.trim();
  if (!title) return unknown("Title could not be identified");
  const chars = title.length;
  const words = countWords(title);
  const punct = opts.forbidPunctuation ? title.match(opts.forbidPunctuation) : null;
  const problems: string[] = [];
  if (chars > opts.maxChars) problems.push(`${chars} characters (limit ${opts.maxChars})`);
  if (words > opts.maxWords) problems.push(`${words} words (limit ${opts.maxWords})`);
  if (punct) problems.push(`contains punctuation "${punct[0]}"`);
  const ev = [evidenceFromText(title, "title")];
  if (problems.length) return fail(`Title needs editing: ${problems.join(", ")}`, ev);
  return pass(`Title has ${chars} characters, ${words} words${opts.forbidPunctuation ? ", no punctuation" : ""}`, ev);
}

export function summaryHeadingCheck(model: ManuscriptModel, expected = "Summary"): RuleOutcome {
  const s = model.summary;
  if (!s) return fail(`No ${expected} or Abstract section found`);
  const ev = [evidenceFromText(s.headingText, "heading")];
  if (normalizeHeading(s.headingText) === normalizeHeading(expected)) return pass(`Section is titled "${expected}"`, ev);
  return fail(`Section is titled "${s.headingText.trim()}"; the journal requires "${expected}"`, ev);
}

export function summaryLengthCheck(
  model: ManuscriptModel,
  maxWords: number,
  opts: { singleParagraph?: boolean; noCitations?: boolean } = {}
): RuleOutcome {
  const s = model.summary;
  if (!s) return fail("No Summary or Abstract section found");
  const problems: string[] = [];
  if (s.wordCount > maxWords) problems.push(`${s.wordCount} words (limit ${maxWords})`);
  if (opts.singleParagraph && s.paragraphCount > 1) problems.push(`${s.paragraphCount} paragraphs (one required)`);
  if (opts.noCitations && s.containsCitations) problems.push("contains citations");
  const ev = [evidenceFromText(s.text, s.headingText)];
  if (problems.length) return fail(`${s.headingText.trim()} needs editing: ${problems.join(", ")}`, ev);
  return pass(`${s.headingText.trim()} has ${s.wordCount} words in one paragraph, no citations`, ev);
}

/** "...remains unclear", "poorly understood", "little is known" and similar framing. */
export const DISCOURAGED_FRAMING_RE =
  /\b(?:remains?|remained|is|are|was|were|still)\s+(?:largely\s+|poorly\s+|incompletely\s+|not\s+)?(?:unclear|unknown|elusive|uncharacteri[sz]ed|unexplored|unresolved|enigmatic)\b|\b(?:poorly|incompletely|not (?:well|fully)) understood\b|\blittle is known\b|\bremains? to be (?:determined|elucidated|established)\b/i;

/** Priority claims the journal discourages ("new" alone is too common to flag). */
export const NOVELTY_RE = /\bnovel\b|\bfor the first time\b|\bunprecedented\b|\bfirst (?:report|demonstration|evidence|description) of\b/i;

export function summaryFramingCheck(model: ManuscriptModel): RuleOutcome {
  const s = model.summary;
  if (!s) return unknown("No Summary or Abstract section found");
  const framing = s.text.match(DISCOURAGED_FRAMING_RE);
  const novelty = s.text.match(NOVELTY_RE);
  const problems: string[] = [];
  const ev: CheckEvidence[] = [];
  if (framing) {
    problems.push(`states that a process is not understood ("${framing[0]}")`);
    ev.push(evidenceFromText(contextAround(s.text, framing.index ?? 0, framing[0].length), s.headingText));
  }
  if (novelty) {
    problems.push(`makes a novelty claim ("${novelty[0]}")`);
    ev.push(evidenceFromText(contextAround(s.text, novelty.index ?? 0, novelty[0].length), s.headingText));
  }
  if (problems.length) return fail(`${s.headingText.trim()} ${problems.join(" and ")}`, ev);
  return pass(`${s.headingText.trim()} avoids "not understood" framing and novelty claims`);
}

function contextAround(text: string, index: number, length: number, pad = 80): string {
  return text.slice(Math.max(0, index - pad), Math.min(text.length, index + length + pad));
}

// ---------------------------------------------------------------------------
// Phrase hits (novelty, "as described previously", personal communication)
// ---------------------------------------------------------------------------

function hitEvidence(hits: Hit[]): CheckEvidence[] {
  return hits.slice(0, 5).map((h) => ({ quote: clip(h.context.replace(/\s+/g, " ").trim(), 240), span: h.span }));
}

/** Novelty words: none is a pass, a few are for the editor, many are a fail. */
export function noveltyCheck(model: ManuscriptModel, failAt = 3): RuleOutcome {
  const hits = model.phraseHits.novelty;
  if (hits.length === 0) return pass("No novelty claims (novel, for the first time...) found");
  if (hits.length < failAt) return review(`${hits.length} novelty claim${hits.length === 1 ? "" : "s"} found`, hitEvidence(hits));
  return fail(`${hits.length} novelty claims found`, hitEvidence(hits));
}

export function asDescribedPreviouslyCheck(model: ManuscriptModel): RuleOutcome {
  const hits = model.phraseHits.asDescribedPreviously;
  if (hits.length === 0) return pass('No "as described previously" in the methods');
  return fail(`"As described previously" used ${hits.length} time${hits.length === 1 ? "" : "s"}`, hitEvidence(hits));
}

export function personalCommunicationCheck(model: ManuscriptModel): RuleOutcome {
  const hits = model.phraseHits.personalCommunication;
  if (hits.length === 0) return pass("No personal communications or unpublished data cited");
  return review(`${hits.length} mention${hits.length === 1 ? "" : "s"} of personal communication / unpublished data`, hitEvidence(hits));
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export function referenceEntriesCheck(model: ManuscriptModel, opts: { requireDoi?: boolean; doiThreshold?: number } = {}): RuleOutcome {
  const { entries, count } = model.references;
  if (!entries.length) return count > 0 ? review(`${count} references detected but entries could not be parsed`) : fail("No reference list found");
  const n = entries.length;
  const missing = (key: "hasYear" | "hasTitle" | "hasJournal" | "hasVolume" | "hasPages") => entries.filter((e) => !e[key]);
  const problems: string[] = [];
  const ev: CheckEvidence[] = [];
  const fieldLabels = { hasYear: "year", hasTitle: "title", hasJournal: "journal", hasVolume: "volume", hasPages: "page range" } as const;
  for (const key of Object.keys(fieldLabels) as (keyof typeof fieldLabels)[]) {
    const lacking = missing(key);
    // Tolerate a few odd entries (books, websites) but flag systematic omissions.
    if (lacking.length > Math.max(2, n * 0.2)) {
      problems.push(`${lacking.length} of ${n} entries lack a ${fieldLabels[key]}`);
      ev.push(evidenceFromText(lacking[0].raw, `reference ${lacking[0].index}`));
    }
  }
  if (opts.requireDoi) {
    const withDoi = entries.filter((e) => e.hasDoi).length;
    if (withDoi / n < (opts.doiThreshold ?? 0.8)) {
      problems.push(`only ${withDoi} of ${n} entries include a DOI`);
      const sample = entries.find((e) => !e.hasDoi);
      if (sample) ev.push(evidenceFromText(sample.raw, `reference ${sample.index}`));
    }
  }
  if (problems.length) return fail(`Reference entries incomplete: ${problems.join("; ")}`, ev);
  return pass(`${n} reference entries with year, title, journal, volume, pages${opts.requireDoi ? " and DOI" : ""}`);
}

export function inTextCitationCheck(model: ManuscriptModel, expected: ManuscriptModel["references"]["inTextStyle"], label: string): RuleOutcome {
  const style = model.references.inTextStyle;
  if (style === "unknown") return review("Could not determine the in-text citation style");
  if (style === expected) return pass(`References are cited as ${label}`);
  return fail(`References are cited as ${style.replace("-", " ")}; the journal requires ${label}`);
}

export function inPressCheck(model: ManuscriptModel): RuleOutcome {
  const bad = model.references.entries.filter((e) => e.isInPressOrUnpublished);
  if (!bad.length) return pass("No in-press, submitted or unpublished entries in the reference list");
  return fail(`${bad.length} reference${bad.length === 1 ? "" : "s"} marked in press/submitted/unpublished`, bad.slice(0, 3).map((e) => evidenceFromText(e.raw, `reference ${e.index}`)));
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

type StatementKey = Exclude<keyof ManuscriptModel["statements"], "highlights">;

/** A named statement must exist; an optional content test can downgrade it to review. */
export function statementCheck(
  model: ManuscriptModel,
  key: StatementKey,
  label: string,
  contentTest?: (text: string) => string | null
): RuleOutcome {
  const statement = model.statements[key];
  if (!statement) return fail(`No ${label} statement found`);
  const ev = [statementEvidence(model, statement)];
  const problem = contentTest?.(statement.text);
  if (problem) return review(`${label} present but ${problem}`, ev);
  return pass(`${label} present ("${statement.headingText.trim()}")`, ev);
}

export function statementSpan(model: ManuscriptModel, key: StatementKey): TextSpan | undefined {
  return model.statements[key]?.span;
}

// ---------------------------------------------------------------------------
// Figures and legends
// ---------------------------------------------------------------------------

type LegendFlag = "definesErrorBars" | "namesStatisticalTest" | "definesAsterisks" | "mentionsScaleBar";

/** Main-figure legends only: the parser may list supplemental legends alongside them. */
export function mainLegends(model: ManuscriptModel): FigureLegend[] {
  return model.figureLegends.filter((l) => !/supplement|extended data|^S\d/i.test(l.label.trim()) && !/^S\d/i.test(l.number.trim()));
}

/**
 * Every legend should carry an attribute (error-bar definition, asterisk definition...).
 * "none" is a fail, "some" is left to the editor unless partialStatus says otherwise.
 */
export function legendsAttributeCheck(
  model: ManuscriptModel,
  flag: LegendFlag,
  label: string,
  opts: { partialStatus?: "review" | "fail"; minimumOne?: boolean } = {}
): RuleOutcome {
  const legends = mainLegends(model);
  if (!legends.length) return unknown(`No figure legends found; cannot verify ${label}`);
  const lacking = legends.filter((l) => !l[flag]);
  const names = (list: FigureLegend[]) => list.map((l) => `Figure ${l.number}`).join(", ");
  if (lacking.length === 0) return pass(`All ${legends.length} legends ${label}`);
  if (opts.minimumOne && lacking.length < legends.length) return pass(`${legends.length - lacking.length} of ${legends.length} legends ${label}`, [], "medium");
  if (lacking.length === legends.length) return fail(`None of the ${legends.length} legends ${label}`, legends.slice(0, 2).map(legendEvidence(model)));
  const summary = `${lacking.length} of ${legends.length} legends do not ${label.replace(/^(define|name|mention)s/, "$1")}: ${names(lacking)}`;
  return (opts.partialStatus ?? "review") === "fail" ? fail(summary, lacking.slice(0, 3).map(legendEvidence(model))) : review(summary, lacking.slice(0, 3).map(legendEvidence(model)));
}

const legendEvidence = (model: ManuscriptModel) => (l: FigureLegend): CheckEvidence =>
  evidenceFromSpan(model, l.span, `Figure ${l.number} legend`);

/** Legends as one list after the text, each titled "Figure N. Title". */
export function legendsListCheck(model: ManuscriptModel, labelRe: RegExp, example: string): RuleOutcome {
  const legends = mainLegends(model);
  if (!legends.length) return fail("No main figure legends found in the document");
  const problems: string[] = [];
  if (model.legendsInterspersed) problems.push("legends are interspersed in the text");
  else if (!model.legendsAfterMainText) problems.push("legends are not placed after the main text");
  const badLabels = legends.filter((l) => !labelRe.test(l.label.trim()));
  if (badLabels.length) problems.push(`${badLabels.length} legend title${badLabels.length === 1 ? "" : "s"} not in the form "${example}" (e.g. "${badLabels[0].label.trim()}")`);
  const ev = legends.slice(0, 2).map(legendEvidence(model));
  if (problems.length) return fail(`Figure legends: ${problems.join("; ")}`, ev);
  return pass(`${legends.length} figure legends listed after the main text with "${example}" titles`, ev);
}

/** Tests are named somewhere (legends or text) even if no "*P < 0.05" was seen. */
const STAT_TEST_RE = /\b(?:t-?tests?|ANOVA|Wilcoxon|Mann[-–]Whitney|chi-?squared?|log-?rank|Kruskal|Fisher'?s? exact|Student'?s)\b|\bP\s*(?:values?\s*)?(?:<|=|>|≤)\s*0?\.\d/i;

export function statisticalTestsPresent(model: ManuscriptModel): boolean {
  return model.features.asterisks?.present || mainLegends(model).some((l) => l.namesStatisticalTest) || STAT_TEST_RE.test(model.text);
}

/**
 * Asterisk definitions. With asterisks detected in the text every legend must
 * define them; when only statistical tests are named (the figures may still
 * show "*", which plain-text extraction cannot see) and no legend defines
 * asterisks, the editor gets a review item rather than a silent pass.
 */
export function asterisksCheck(model: ManuscriptModel): RuleOutcome {
  if (model.features.asterisks?.present) return legendsAttributeCheck(model, "definesAsterisks", "define the asterisks");
  const legends = mainLegends(model);
  if (!legends.length) return unknown("No figure legends found; cannot verify asterisk definitions");
  if (legends.some((l) => l.definesAsterisks)) return pass(`${legends.filter((l) => l.definesAsterisks).length} of ${legends.length} legends define the asterisks`, [], "medium");
  return review("Statistical tests are reported but no legend defines significance asterisks; figures may show significance asterisks; make sure each legend defines them with the test name", legends.slice(0, 2).map(legendEvidence(model)));
}

export function seeAlsoCheck(model: ManuscriptModel): RuleOutcome {
  if (!model.supplementalItems.length && !model.supplementalMentions.length) return notApplicable("No supplemental items to cross-reference");
  const legends = mainLegends(model);
  if (!legends.length) return unknown("No figure legends found");
  const withSeeAlso = legends.filter((l) => l.seeAlso.length > 0);
  if (withSeeAlso.length === 0) return review("Supplemental items exist but no legend ends with a \"See also\" cross-reference");
  return pass(`${withSeeAlso.length} of ${legends.length} legends carry a "See also" cross-reference`);
}

// ---------------------------------------------------------------------------
// Data deposition and ethics
// ---------------------------------------------------------------------------

/**
 * A data type that must be deposited: accession codes must exist and be listed
 * in the Key Resources Table.
 */
export function depositionCheck(model: ManuscriptModel, featureKey: keyof ManuscriptModel["features"], repoRe: RegExp, label: string): RuleOutcome {
  const feature = model.features[featureKey];
  if (!feature?.present) return notApplicable(`No ${label} detected`);
  // Public data that was only reanalysed carries no deposition obligation.
  if (feature.generated === false) return notApplicable(`${label} mentioned but only as reused public data`, feature.evidence.slice(0, 2).map((q) => evidenceFromText(q, `${label} evidence`)));
  const featureEv = feature.evidence.slice(0, 2).map((q) => evidenceFromText(q, `${label} evidence`));
  const matching = model.accessions.filter((a) => repoRe.test(a.repository) || repoRe.test(a.id));
  if (!matching.length) {
    const any = model.accessions.length ? ` (other accessions present: ${model.accessions.map((a) => a.id).slice(0, 4).join(", ")})` : "";
    return fail(`${label} detected but no matching accession code found${any}`, featureEv);
  }
  const ids = matching.map((a) => a.id);
  const accEv = matching.slice(0, 2).map((a) => evidenceFromSpan(model, a.span, a.repository));
  const krt = model.statements.keyResourcesTable;
  if (!model.starMethods.hasKeyResourcesTable && !krt) {
    return fail(`${label} accession codes found (${ids.join(", ")}) but there is no Key Resources Table to list them in`, [...accEv, ...featureEv]);
  }
  if (krt?.text) {
    const listed = ids.filter((id) => krt.text.includes(id));
    if (listed.length < ids.length) return fail(`Accession codes not listed in the Key Resources Table: ${ids.filter((id) => !listed.includes(id)).join(", ")}`, accEv);
    return pass(`${label} accession codes listed in the Key Resources Table (${ids.join(", ")})`, accEv);
  }
  return pass(`${label} accession codes found (${ids.join(", ")}); Key Resources Table present`, accEv, "medium");
}

/** Wording fallbacks used when the parser did not isolate an ethics statement. */
export const ANIMAL_APPROVAL_RE = /\b(?:Institutional Animal Care and Use Committee|IACUC|Animal (?:Care|Ethics|Welfare|Experimentation) Committee|animal (?:experiments?|procedures?|studies) (?:were|was) (?:approved|reviewed)|approved by [^.]{0,80}\banimal)/i;
export const HUMAN_APPROVAL_RE = /\b(?:Institutional Review Board|IRB|(?:Research )?Ethics Committee|ethical approval|approved by [^.]{0,80}(?:ethics|review board))/i;
export const CONSENT_RE = /\binformed (?:written )?consent\b|\bwritten consent\b/i;

export function ethicsCheck(model: ManuscriptModel, kind: "animal" | "human"): RuleOutcome {
  const st = model.statements;
  const ev: CheckEvidence[] = [];
  const missing: string[] = [];
  const toReview: string[] = [];
  let confidence: RuleOutcome["confidence"] = "high";
  // Prefer the parser's statement; fall back to the wording anywhere in the text.
  const locate = (statement: typeof st.ethicsAnimal, re: RegExp, label: string) => {
    if (statement) return ev.push(statementEvidence(model, statement));
    const hits = regexMatches(model.text, re, 0, 80, 1);
    if (hits.length) {
      confidence = "medium";
      return ev.push({ ...hits[0], location: label });
    }
    missing.push(label);
  };
  locate(kind === "animal" ? st.ethicsAnimal : st.ethicsHuman, kind === "animal" ? ANIMAL_APPROVAL_RE : HUMAN_APPROVAL_RE, kind === "animal" ? "animal ethics committee approval" : "ethics committee / IRB approval");
  if (kind === "human") locate(st.informedConsent, CONSENT_RE, "informed consent statement");
  if (!model.features.sexReported.present) toReview.push("sex of subjects");
  if (!model.features.ageReported.present) toReview.push("age or developmental stage");
  const subject = kind === "animal" ? "Animal" : "Human";
  if (missing.length && !hasMethodsSection(model)) {
    // No methods section anywhere: the animals or patients are probably the
    // subject of the discussion, not of experiments. Ask rather than fail.
    const needed = kind === "animal" ? "approval, sex and age statements" : "approval, consent, sex and age statements";
    return review(`${subject} work is mentioned but the manuscript has no methods section; if experimental work was done, add the ${needed}`, ev, "medium");
  }
  if (missing.length) return fail(`${subject} work: missing ${missing.join(" and ")}`, ev);
  if (toReview.length) return review(`${subject} work: approval present; not found: ${toReview.join(", ")}`, ev);
  return pass(`${subject} work: approval${kind === "human" ? ", consent" : ""}, sex and age reported`, ev, confidence);
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export function resultsSubheadingsCheck(model: ManuscriptModel): RuleOutcome {
  const results = findSection(model, RESULTS_ALIASES);
  if (!results) return unknown("No Results section found");
  const n = results.children.length;
  if (n >= 2) return pass(`Results section has ${n} subheadings`, results.children.slice(0, 3).map((c) => evidenceFromSpan(model, c.heading.span, "subheading")));
  return fail(n === 0 ? "Results section has no subheadings" : "Results section has a single subheading", [evidenceFromSpan(model, results.heading.span, "heading")]);
}

export function highlightsCheck(model: ManuscriptModel, opts = { min: 3, max: 4, maxChars: 85 }): RuleOutcome {
  const h = model.statements.highlights;
  if (!h) return unknown("No Highlights found in the main document (they may be supplied as a separate file)");
  const problems: string[] = [];
  if (h.bullets.length < opts.min || h.bullets.length > opts.max) problems.push(`${h.bullets.length} bullets (${opts.min}-${opts.max} required)`);
  const long = h.bullets.filter((b) => b.trim().length > opts.maxChars);
  if (long.length) problems.push(`${long.length} bullet${long.length === 1 ? "" : "s"} longer than ${opts.maxChars} characters`);
  const ev = h.bullets.slice(0, 4).map((b) => evidenceFromText(b, "highlight"));
  if (problems.length) return fail(`Highlights need editing: ${problems.join(", ")}`, ev);
  return pass(`${h.bullets.length} highlights, all within ${opts.maxChars} characters`, ev);
}

/** Does any heading in the outline match one of the aliases? */
export function outlineHas(model: ManuscriptModel, aliases: readonly string[]): boolean {
  return model.outline.some((h) => headingMatches(h.text, aliases));
}
