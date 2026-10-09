/**
 * iScience rule evaluators for STAR Methods, the Key Resources Table and data
 * deposition. See ./iscience-rules.ts for the main-document rules.
 */

import type { ManuscriptModel } from "../manuscript-model";
import {
  type RuleOutcome,
  type CheckEvidence,
  pass,
  fail,
  review,
  evidenceFromSpan,
  evidenceFromText,
  statementEvidence,
  normalizeHeading,
  findSection,
  regexMatches,
} from "../profile";
import { ethicsCheck, methodsSection } from "./shared-rules";

// ---------------------------------------------------------------------------
// STAR Methods structure
// ---------------------------------------------------------------------------

export function starPresentCheck(model: ManuscriptModel): RuleOutcome {
  if (model.starMethods.present) {
    return pass(`STAR Methods present${model.starMethods.headingText ? ` ("${model.starMethods.headingText.trim()}")` : ""}`);
  }
  const methods = methodsSection(model);
  if (methods) {
    return fail(`Methods are under "${methods.heading.text.trim()}", not in STAR Methods format`, [evidenceFromSpan(model, methods.heading.span, "heading")]);
  }
  return fail("No methods section found; a STAR Methods section is required");
}

interface StarSlot {
  name: string;
  match: RegExp;
  requiredWhen?: (m: ManuscriptModel) => boolean;
  optional?: boolean;
}

const usesLifeScienceModels = (m: ManuscriptModel) =>
  m.features.vertebrates.present || m.features.humans.present || /\bcell lines?\b/i.test(m.text);

export const STAR_SLOTS: readonly StarSlot[] = [
  { name: "RESOURCE AVAILABILITY", match: /^resource availability$/ },
  { name: "EXPERIMENTAL MODEL AND SUBJECT DETAILS", match: /^experimental model and (subject|study participant) details$/, requiredWhen: usesLifeScienceModels },
  { name: "METHOD DETAILS", match: /^methods? details$/ },
  { name: "QUANTIFICATION AND STATISTICAL ANALYSIS", match: /^quantification and statistical analys[ie]s$/ },
  { name: "ADDITIONAL RESOURCES", match: /^additional resources$/, optional: true },
];

export function starHeadingsOrderCheck(model: ManuscriptModel): RuleOutcome {
  const headings = model.starMethods.headings.map((h) => normalizeHeading(h));
  const positions = STAR_SLOTS.map((slot) => ({ slot, index: headings.findIndex((h) => slot.match.test(h)) }));
  const missing = positions
    .filter(({ slot, index }) => index < 0 && !slot.optional && (slot.requiredWhen ? slot.requiredWhen(model) : true))
    .map((p) => p.slot.name);
  const outOfOrder: string[] = [];
  let last = -1;
  for (const { slot, index } of positions) {
    if (index < 0) continue;
    if (index < last) outOfOrder.push(slot.name);
    last = Math.max(last, index);
  }
  const ev = model.starMethods.headings.slice(0, 6).map((h) => evidenceFromText(h, "STAR heading"));
  const problems: string[] = [];
  if (missing.length) problems.push(`missing ${missing.join(", ")}`);
  if (outOfOrder.length) problems.push(`out of order: ${outOfOrder.join(", ")}`);
  if (problems.length) return fail(`STAR Methods headings: ${problems.join("; ")}`, ev);
  return pass("Standard STAR Methods headings present in order", ev);
}

export function starSubheadingsCheck(model: ManuscriptModel): RuleOutcome {
  const sm = model.starMethods;
  const problems: string[] = [];
  if (sm.numberedSubheadings) problems.push("subheadings are numbered");
  if (sm.subheadingDepth > 2) problems.push(`${sm.subheadingDepth} levels of subheadings (maximum two)`);
  if (!sm.headings.length) problems.push("no subheadings");
  if (problems.length) return fail(`STAR Methods subheadings: ${problems.join("; ")}`);
  return pass(`STAR Methods subheadings unnumbered, ${sm.subheadingDepth || 1} level${sm.subheadingDepth > 1 ? "s" : ""}`);
}

export function starEmbeddedTablesCheck(model: ManuscriptModel): RuleOutcome {
  const n = model.starMethods.tablesEmbedded;
  return n > 0 ? fail(`${n} numbered table${n === 1 ? "" : "s"} embedded in the STAR Methods text`) : pass("No numbered tables embedded in STAR Methods");
}

export function starComplexTablesCheck(model: ManuscriptModel): RuleOutcome {
  const n = model.starMethods.tablesEmbedded;
  return review(`${n} table${n === 1 ? "" : "s"} embedded in STAR Methods; check none is complex (split cells, shading) or longer than one page`);
}

export function starEmbeddedFiguresCheck(model: ManuscriptModel): RuleOutcome {
  const n = model.starMethods.figuresEmbedded;
  return n > 0 ? fail(`${n} figure${n === 1 ? "" : "s"} embedded in the STAR Methods`) : pass("No figures embedded in STAR Methods");
}

export function separateReferenceListCheck(model: ManuscriptModel): RuleOutcome {
  return model.references.separateSupplementalList
    ? fail("A second reference list exists (STAR Methods / supplemental); references must be combined into one list")
    : pass("Single reference list");
}

export function experimentalModelCheck(model: ManuscriptModel): RuleOutcome {
  const heading = model.starMethods.headings.find((h) => /^experimental model and (subject|study participant) details$/.test(normalizeHeading(h)));
  if (!heading) return fail('No "EXPERIMENTAL MODEL AND SUBJECT DETAILS" section although the study uses animals, humans or cells');
  const outcomes: RuleOutcome[] = [];
  if (model.features.vertebrates.present) outcomes.push(ethicsCheck(model, "animal"));
  if (model.features.humans.present) outcomes.push(ethicsCheck(model, "human"));
  if (!outcomes.length) return pass(`"${heading}" section present`);
  const worst = outcomes.find((o) => o.status === "fail") ?? outcomes.find((o) => o.status === "review") ?? outcomes[0];
  return { ...worst, evidence: outcomes.flatMap((o) => o.evidence).slice(0, 4) };
}

const STATS_ALIASES = ["quantification and statistical analysis", "quantification and statistical analyses", "statistical analysis", "statistical analyses", "statistics", "statistical methods"];

export function quantificationCheck(model: ManuscriptModel): RuleOutcome {
  const section = findSection(model, STATS_ALIASES);
  const starHeading = model.starMethods.headings.find((h) => /^quantification and statistical/.test(normalizeHeading(h)));
  if (!section && !starHeading) return fail("No Quantification and Statistical Analysis section found");
  const body = section?.body ?? "";
  const signals = [
    /\b(t-?tests?|ANOVA|Wilcoxon|Mann[-–]Whitney|chi-?squared?|log-?rank|Kruskal|regression|Fisher)\b/i,
    /\bn\s*(?:=|≥|>|denotes|represents)|sample sizes?/i,
    /\b(s\.?e\.?m\.?|SD|standard deviation|standard error|confidence intervals?|median|mean)\b/i,
    /\b(Prism|GraphPad|SPSS|R\b|Python|MATLAB|Stata|JMP)\b/,
  ];
  const found = signals.filter((re) => re.test(body)).length;
  const ev: CheckEvidence[] = section ? [evidenceFromSpan(model, section.heading.span, "heading")] : [evidenceFromText(starHeading ?? "", "STAR heading")];
  if (!section) return review(`"${starHeading}" heading present but its content could not be assessed`, ev);
  if (found >= 3) return pass(`"${section.heading.text.trim()}" describes tests, n and dispersion measures`, ev);
  return review(`"${section.heading.text.trim()}" present but thin (tests, n, what n represents, center/dispersion measures and software should all be stated)`, ev);
}

const REGISTRY_RE = /\b(?:NCT\d{8}|ChiCTR[-\w]*\d+|ISRCTN\d+|UMIN\d+|ACTRN\d+|EudraCT\s*\d{4}-\d{6}-\d{2}|clinicaltrials\.gov|DRKS\d+|CTRI\/\d+)/i;

export function clinicalTrialCheck(model: ManuscriptModel): RuleOutcome {
  const additional = model.statements.additionalResources;
  if (additional && REGISTRY_RE.test(additional.text)) return pass("Clinical trial registration listed in Additional Resources", [statementEvidence(model, additional)]);
  const hits = regexMatches(model.text, REGISTRY_RE, 0, 80, 2);
  if (hits.length) return review("Trial registry number found but not in the Additional Resources section of the STAR Methods", hits);
  return fail("Clinical trial work without a registry number in Additional Resources");
}

// ---------------------------------------------------------------------------
// Key Resources Table
// ---------------------------------------------------------------------------

export function krtPresent(model: ManuscriptModel): boolean {
  return model.starMethods.hasKeyResourcesTable || Boolean(model.statements.keyResourcesTable);
}

export function krtPresentCheck(model: ManuscriptModel): RuleOutcome {
  return krtPresent(model) ? pass("Key Resources Table present") : fail("No Key Resources Table found");
}

export const KRT_STANDARD_HEADINGS = [
  "antibodies", "bacterial and virus strains", "biological samples", "chemicals peptides and recombinant proteins",
  "critical commercial assays", "deposited data", "experimental models cell lines", "experimental models organisms strains",
  "oligonucleotides", "recombinant dna", "software and algorithms", "other", "reagent or resource", "source", "identifier",
];

export function krtCustomizedCheck(model: ManuscriptModel): RuleOutcome {
  const krt = model.statements.keyResourcesTable;
  if (!krt?.text) return review("Key Resources Table detected but its headings could not be read; check for merged cells or custom headings");
  const headingLike = krt.text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 60 && /^[A-Z][A-Za-z ,:/&()-]*$/.test(l) && !/\bcat\b|#/i.test(l));
  const custom = headingLike.filter((l) => !KRT_STANDARD_HEADINGS.includes(normalizeHeading(l)));
  if (custom.length) return fail(`Key Resources Table has non-standard heading${custom.length === 1 ? "" : "s"}: ${custom.slice(0, 4).join(", ")}`, custom.slice(0, 3).map((c) => evidenceFromText(c, "KRT heading")));
  return pass("Key Resources Table uses the standard subheadings", [], "medium");
}

// ---------------------------------------------------------------------------
// Data and code
// ---------------------------------------------------------------------------

export const DEPOSIT_FEATURES = ["rnaSeq", "proteomics", "microarray", "proteinStructure", "geneSequences"] as const;

/**
 * A deposition rule applies only to data the paper GENERATED. Reanalysing a
 * public microarray cohort is not a deposition obligation. `generated` is
 * undefined on hand-built models, which we treat as generated.
 */
export function dataGenerated(model: ManuscriptModel, key: keyof ManuscriptModel["features"]): boolean {
  const f = model.features[key];
  return Boolean(f?.present) && f.generated !== false;
}

export function depositsApply(model: ManuscriptModel): boolean {
  return DEPOSIT_FEATURES.some((k) => dataGenerated(model, k));
}

export function accessionRequestCheck(model: ManuscriptModel): RuleOutcome {
  const types = DEPOSIT_FEATURES.filter((k) => dataGenerated(model, k));
  const statement = model.statements.dataAndCodeAvailability ?? model.statements.dataAvailability;
  const ev = model.accessions.slice(0, 3).map((a) => evidenceFromSpan(model, a.span, a.repository));
  if (!model.accessions.length) return fail(`${types.join(", ")} data generated but no accession codes found`);
  if (!statement) return fail(`Accession codes found (${model.accessions.map((a) => a.id).slice(0, 4).join(", ")}) but no data availability statement`, ev);
  return pass(`${model.accessions.length} accession code${model.accessions.length === 1 ? "" : "s"} with a data availability statement ("${statement.headingText.trim()}")`, ev);
}

const CODE_IDENTIFIER_RE = /github|gitlab|bitbucket|zenodo|figshare|doi\.org|10\.\d{4,}\/|https?:\/\//i;

export function customCodeCheck(model: ManuscriptModel): RuleOutcome {
  const statement = model.statements.dataAndCodeAvailability ?? model.statements.codeAvailability;
  const ev = model.features.customCode.evidence.slice(0, 2).map((q) => evidenceFromText(q, "custom code"));
  if (!statement) return fail("Custom code is used but there is no code availability statement", ev);
  const text = statement.text;
  if (CODE_IDENTIFIER_RE.test(text)) return pass("Code availability statement gives a repository or DOI", [statementEvidence(model, statement), ...ev]);
  if (/did not generate|no (?:new|original|custom) code|not generate/i.test(text)) return review("Custom code appears to be used but the statement says no original code was generated", [statementEvidence(model, statement), ...ev]);
  return fail("Code availability statement lacks a DOI, repository link or unique identifier", [statementEvidence(model, statement), ...ev]);
}

export function supplementarySoftwareApplies(model: ManuscriptModel): boolean {
  return /supplementa(?:l|ry) software/i.test(model.text);
}

const ACCESSION_HEADING_RE = /^(?:accession (?:codes?|numbers?)|data deposition|data deposit|deposited data)$/;

export function separateAccessionSectionCheck(model: ManuscriptModel): RuleOutcome {
  const heading = model.outline.find((h) => ACCESSION_HEADING_RE.test(normalizeHeading(h.text)));
  if (heading) return fail(`Separate "${heading.text.trim()}" section; accession codes belong in Data and Code Availability and the Key Resources Table`, [evidenceFromSpan(model, heading.span, "heading")]);
  return pass("No separate accession code section");
}

export function accessionsInKrtApply(model: ManuscriptModel): boolean {
  return model.accessions.length > 0 && Boolean(model.statements.keyResourcesTable?.text);
}

export function accessionsInKrtCheck(model: ManuscriptModel): RuleOutcome {
  const krtText = model.statements.keyResourcesTable?.text ?? "";
  const missing = model.accessions.filter((a) => !krtText.includes(a.id));
  if (missing.length) return fail(`Accession codes not listed in the Key Resources Table: ${missing.map((a) => a.id).join(", ")}`, missing.slice(0, 3).map((a) => evidenceFromSpan(model, a.span, a.repository)));
  return pass("All accession codes are listed in the Key Resources Table");
}

