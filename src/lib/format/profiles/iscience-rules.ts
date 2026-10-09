/**
 * Rule evaluators specific to the iScience Final File Requirements (FFC):
 * title page, main-document order, Resource Availability, statements, figures,
 * tables and supplemental titles. STAR Methods and data-deposition rules live in
 * ./iscience-star-rules.ts. Shared evaluators (title, summary, references,
 * legends, ethics) are in ./shared-rules.ts.
 */

import type { ManuscriptModel } from "../manuscript-model";
import {
  type OrderSlot,
  type RuleOutcome,
  type CheckEvidence,
  pass,
  fail,
  review,
  unknown,
  notApplicable,
  evidenceFromSpan,
  evidenceFromText,
  statementEvidence,
  normalizeHeading,
  quoteSpan,
  statementHeading,
  EMAIL_RE,
} from "../profile";
import { SUMMARY_ALIASES, statementCheck, statementSpan } from "./shared-rules";

// ---------------------------------------------------------------------------
// File and title page
// ---------------------------------------------------------------------------

export function fileIsWordCheck(model: ManuscriptModel): RuleOutcome {
  const name = model.fileName ? ` (${model.fileName})` : "";
  if (model.sourceType === "docx") return pass(`Main document supplied as a Word file${name}`);
  if (model.sourceType === "pdf") return fail(`Main document supplied as a PDF${name}; a modifiable Word file is required`);
  return review("Main document supplied as plain text; confirm a Word file is uploaded");
}

export function leadContactFootnoteCheck(model: ManuscriptModel): RuleOutcome {
  if (model.hasLeadContactFootnote) return pass("Lead Contact designated with a footnote in the author list");
  const corr = model.text.match(/\*?\s*Correspond(?:ence|ing author)[^\n]{0,80}/i);
  const ev = corr ? [evidenceFromText(corr[0], "title page")] : [];
  return fail(corr ? 'No Lead Contact footnote; the title page only has a "Correspondence" line' : "No Lead Contact footnote in the author list", ev);
}

export function correspondingEmailCheck(model: ManuscriptModel): RuleOutcome {
  if (model.correspondingEmails.length) return pass(`Corresponding e-mail present (${model.correspondingEmails.join(", ")})`);
  return fail("No corresponding author e-mail address found on the title page");
}

// ---------------------------------------------------------------------------
// Main document order (FFC "The main document must include the following sections (in this order)")
// ---------------------------------------------------------------------------

const firstLegendSpan = (m: ManuscriptModel) => (m.legendsInterspersed ? undefined : m.figureLegends[0]?.span);
const firstSupplementalSpan = (m: ManuscriptModel) => m.supplementalItems[0]?.span;
const starSpan = (m: ManuscriptModel) => {
  if (!m.starMethods.present || !m.starMethods.headingText) return undefined;
  const h = m.outline.find((o) => normalizeHeading(o.text) === normalizeHeading(m.starMethods.headingText ?? ""));
  return h?.span;
};

/** "Abstract" fills the Summary slot and "Competing interests" the DoI slot; naming is checked separately. */
export const ISCIENCE_SECTION_ORDER: readonly OrderSlot[] = [
  { slot: "Summary", aliases: SUMMARY_ALIASES },
  { slot: "Introduction", aliases: ["introduction", "background"] },
  { slot: "Results", aliases: ["results", "results and discussion"] },
  { slot: "Discussion", aliases: ["discussion", "results and discussion", "conclusions"] },
  { slot: "Resource Availability", aliases: ["resource availability"], locate: (m) => statementSpan(m, "resourceAvailability") },
  { slot: "Limitations of the Study", aliases: ["limitations of the study", "limitations of study", "limitations", "study limitations"], locate: (m) => statementSpan(m, "limitations") },
  { slot: "Acknowledgments", aliases: ["acknowledgments", "acknowledgements", "acknowledgment", "acknowledgement"], locate: (m) => statementSpan(m, "acknowledgments") },
  { slot: "Author Contributions", aliases: ["author contributions", "authors contributions", "contributions", "credit authorship contribution statement"], locate: (m) => statementSpan(m, "authorContributions") },
  { slot: "Declaration of Interests", aliases: ["declaration of interests", "declaration of interest", "competing interests", "conflict of interest", "conflicts of interest", "disclosure"], locate: (m) => statementSpan(m, "declarationOfInterests") },
  { slot: "Figure legends", aliases: ["figure legends", "figure titles and legends", "legends", "figures"], locate: firstLegendSpan },
  { slot: "Tables", aliases: ["tables"], optional: true },
  { slot: "STAR Methods", aliases: ["star methods", "star★methods"], locate: starSpan },
  { slot: "Supplemental titles", aliases: ["supplemental information", "supplementary information", "supplemental item titles"], optional: true, locate: firstSupplementalSpan },
  { slot: "References", aliases: ["references", "bibliography", "literature cited"] },
];

// ---------------------------------------------------------------------------
// Resource Availability
// ---------------------------------------------------------------------------

export function resourceAvailabilitySectionCheck(model: ManuscriptModel): RuleOutcome {
  const st = model.statements;
  const heading = model.outline.find((h) => normalizeHeading(h.text) === "resource availability");
  const subheadings = [
    ["Lead Contact", st.leadContact],
    ["Materials Availability", st.materialsAvailability],
    ["Data and Code Availability", st.dataAndCodeAvailability],
  ] as const;
  const missing = subheadings.filter(([, s]) => !s).map(([name]) => name);
  const ev: CheckEvidence[] = [];
  if (heading) ev.push(evidenceFromSpan(model, heading.span, "heading"));
  for (const [, s] of subheadings) if (s) ev.push(statementEvidence(model, s));
  if (!heading && !st.resourceAvailability) {
    const separate = [st.materialsAvailability, st.dataAvailability, st.codeAvailability].filter(Boolean) as NonNullable<typeof st.dataAvailability>[];
    const names = separate.map((s) => statementHeading(model, s) ?? "availability").join('", "');
    const note = separate.length ? ` (found separate "${names}" statements instead)` : "";
    return fail(`No "Resource Availability" section${note}`, separate.map((s) => statementEvidence(model, s)));
  }
  if (missing.length) return fail(`"Resource Availability" present but missing subheading${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`, ev);
  return pass('"Resource Availability" section with Lead Contact, Materials Availability and Data and Code Availability', ev);
}

export function leadContactStatementCheck(model: ManuscriptModel): RuleOutcome {
  const s = model.statements.leadContact;
  if (!s) return fail('No "Lead Contact" statement in Resource Availability');
  const ev = [statementEvidence(model, s)];
  const email = s.text.match(EMAIL_RE);
  // A name: two capitalised words (allow initials and hyphens) somewhere in the statement.
  const name = /\b[A-Z][\p{L}.'-]+(?:\s+[A-Z][\p{L}.'-]+)+\b/u.test(s.text.replace(/Lead Contact/g, ""));
  if (!email) return fail("Lead Contact statement does not give an e-mail address", ev);
  if (!name) return review("Lead Contact statement gives an e-mail but the full name could not be confirmed", ev);
  return pass(`Lead Contact statement names the contact with e-mail ${email[0]}`, ev);
}

export function materialsAvailabilityCheck(model: ManuscriptModel): RuleOutcome {
  return statementCheck(model, "materialsAvailability", "Materials Availability", (text) =>
    /deposited|available|did not generate|no new|not generate|restrictions?|request/i.test(text) ? null : "does not say where materials are available or that none were generated"
  );
}

const BULLET_RE = /^\s*(?:[•●▪◦\-–*]|\(?[a-z0-9]\)|\d+\.)\s+/gm;

export function dataCodeAvailabilityCheck(model: ManuscriptModel): RuleOutcome {
  const st = model.statements;
  const s = st.dataAndCodeAvailability;
  if (!s) {
    const separate = [st.dataAvailability, st.codeAvailability].filter(Boolean) as NonNullable<typeof st.dataAvailability>[];
    if (separate.length) {
      const names = separate.map((x) => statementHeading(model, x) ?? "availability").join('" and "');
      return fail(
        `Separate "${names}" statements; a single "Data and Code Availability" statement with three bullet points (data, code, other) is required`,
        separate.map((x) => statementEvidence(model, x))
      );
    }
    return fail('No "Data and Code Availability" statement found');
  }
  const ev = [statementEvidence(model, s)];
  const bullets = (s.text.match(BULLET_RE) ?? []).length;
  const mentionsKrt = /key resources? table/i.test(s.text);
  const problems: string[] = [];
  if (bullets < 3) problems.push(`${bullets} bullet point${bullets === 1 ? "" : "s"} (three required: data, code, other)`);
  if (!mentionsKrt) problems.push("does not refer to the key resources table for accession numbers");
  if (problems.length) return fail(`Data and Code Availability statement: ${problems.join("; ")}`, ev);
  return pass("Data and Code Availability statement with three bullet points referring to the key resources table", ev);
}

// ---------------------------------------------------------------------------
// Back-matter statements
// ---------------------------------------------------------------------------

export function acknowledgmentsCheck(model: ManuscriptModel): RuleOutcome {
  return statementCheck(model, "acknowledgments", "Acknowledgments", (text) =>
    /\d{3,}|[A-Z]{2,}\d+|grant|fund|support/i.test(text) ? null : "no grant numbers or funding sources found"
  );
}

export function authorContributionsCheck(model: ManuscriptModel): RuleOutcome {
  const s = model.statements.authorContributions;
  if (!s) return fail("No Author Contributions section found");
  const ev = [statementEvidence(model, s)];
  const ack = model.statements.acknowledgments;
  if (!ack) return pass("Author Contributions present", ev);
  if (s.span.start < ack.span.start) return review("Author Contributions present but placed before the Acknowledgments (should follow them)", ev);
  return pass("Author Contributions present after the Acknowledgments", ev);
}

const DOI_HEADING_RE = /^declaration of (competing )?interests?$/;

export function declarationOfInterestsCheck(model: ManuscriptModel): RuleOutcome {
  const s = model.statements.declarationOfInterests;
  if (!s) return fail('No "Declaration of Interests" section found');
  const ev = [statementEvidence(model, s)];
  const headingText = statementHeading(model, s);
  if (headingText === undefined) return review('Declaration of interests wording found but its heading could not be read; it must be titled "Declaration of Interests" and precede the References', ev);
  if (!DOI_HEADING_RE.test(normalizeHeading(headingText))) return fail(`Section is titled "${headingText}"; it must be titled "Declaration of Interests"`, ev);
  const refs = model.outline.find((h) => /^(references|bibliography|literature cited)$/.test(normalizeHeading(h.text)));
  if (refs && s.span.start > refs.span.start) return fail('"Declaration of Interests" must precede the References', ev);
  return pass('"Declaration of Interests" section present before the References', ev);
}

export const GENERATIVE_AI_RE = /\b(?:ChatGPT|GPT-?[3-5]|generative AI|large language models?|LLMs?|Claude|Gemini|Copilot|AI-assisted)\b/;

export function aiDeclarationApplies(model: ManuscriptModel): boolean {
  return GENERATIVE_AI_RE.test(model.text) || Boolean(model.statements.aiDeclaration);
}

export function aiDeclarationCheck(model: ManuscriptModel): RuleOutcome {
  return statementCheck(model, "aiDeclaration", "Declaration of generative AI and AI-assisted technologies");
}

export function inclusionDiversityCheck(model: ManuscriptModel): RuleOutcome {
  return statementCheck(model, "inclusionAndDiversity", "Inclusion and diversity");
}

export function limitationsCheck(model: ManuscriptModel): RuleOutcome {
  return statementCheck(model, "limitations", "Limitations of the study");
}

// ---------------------------------------------------------------------------
// Figures, tables, supplemental items
// ---------------------------------------------------------------------------

export function separateFiguresCheck(model: ManuscriptModel): RuleOutcome {
  if (model.docx) {
    if (model.docx.imagesInBody > 0) return fail(`${model.docx.imagesInBody} image${model.docx.imagesInBody === 1 ? "" : "s"} embedded in the Word document; figures must be uploaded as separate files`);
    return pass("No figures embedded in the Word document");
  }
  return review("Cannot verify from a PDF whether the figures are embedded; make sure they are uploaded as separate high-resolution files");
}

export function tablesApply(model: ManuscriptModel): boolean {
  return model.tableCaptions.some((t) => !t.isSupplemental) || (model.docx?.wordTables ?? 0) > 0;
}

export function tablesFormatCheck(model: ManuscriptModel): RuleOutcome {
  const main = model.tableCaptions.filter((t) => !t.isSupplemental);
  const ev = main.slice(0, 3).map((t) => evidenceFromSpan(model, t.span, `Table ${t.number}`));
  const panels = main.filter((t) => /^\d+\s*[A-Za-z]$/.test(t.number.trim()));
  if (panels.length) return fail(`Tables split into panels (${panels.map((t) => `Table ${t.number}`).join(", ")}); number them Table 1, Table 2...`, ev);
  if (model.docx) {
    if (main.length && model.docx.wordTables === 0) return fail(`${main.length} table caption${main.length === 1 ? "" : "s"} but no Word table in the document (tables may be images)`, ev);
    return pass(`${model.docx.wordTables} editable Word table${model.docx.wordTables === 1 ? "" : "s"}, no panels`, ev);
  }
  return review(`${main.length} table${main.length === 1 ? "" : "s"} found; cannot verify from a PDF that they are editable Word tables`, ev);
}

const SUPPLEMENTAL_TITLE_RE = /^(?:Figure|Table|Video|Data|Scheme|Movie|Methods)\s+S\d+\.?/i;

export function supplementalFigureCountCheck(model: ManuscriptModel, max = 20): RuleOutcome {
  const figures = model.supplementalItems.filter((i) => i.kind === "figure");
  if (!figures.length) {
    return model.supplementalMentions.length
      ? unknown("Supplemental figures are cited but their titles were not found in the main document")
      : notApplicable("No supplemental figures");
  }
  if (figures.length > max) return fail(`${figures.length} supplemental figures (recommended maximum ${max})`);
  return pass(`${figures.length} supplemental figures (maximum ${max})`);
}

export function supplementalTitlesCheck(model: ManuscriptModel): RuleOutcome {
  const items = model.supplementalItems;
  if (!items.length) {
    return model.supplementalMentions.length
      ? review("Supplemental items are cited but no titles were found in the main document; titles must be listed after the STAR Methods")
      : notApplicable("No supplemental items");
  }
  const bad = items.filter((i) => !i.relatedTo.length || !SUPPLEMENTAL_TITLE_RE.test(quoteSpan(model, i.span)));
  const ev = bad.slice(0, 3).map((i) => evidenceFromSpan(model, i.span, `${i.kind} ${i.number}`));
  if (bad.length) {
    const noRelated = bad.filter((i) => !i.relatedTo.length).length;
    const parts: string[] = [];
    if (noRelated) parts.push(`${noRelated} without "Related to"`);
    const badFormat = bad.length - bad.filter((i) => i.relatedTo.length === 0 && SUPPLEMENTAL_TITLE_RE.test(quoteSpan(model, i.span))).length;
    if (badFormat) parts.push(`titles not in the form "Figure S1. Title, Related to Figure 1"`);
    return fail(`${bad.length} of ${items.length} supplemental titles need editing (${parts.join("; ")})`, ev);
  }
  return pass(`${items.length} supplemental titles in the "Figure S1. Title, Related to Figure 1" form`);
}

export function excelTablesApply(model: ManuscriptModel): boolean {
  return model.supplementalItems.some((i) => i.kind === "table") || /supplementa(?:l|ry) tables?/i.test(model.text);
}

export function excelTablesCheck(model: ManuscriptModel): RuleOutcome {
  const tables = model.supplementalItems.filter((i) => i.kind === "table");
  if (!tables.length) return review("Supplemental tables are cited but their titles were not found; check none exceeds 3 pages (Excel otherwise)");
  const excel = tables.filter((t) => /excel|\.xlsx?|separate\s+\w*\s*file/i.test(`${t.title} ${quoteSpan(model, t.span, 200)}`));
  const ev = excel.slice(0, 2).map((t) => evidenceFromSpan(model, t.span, `Table ${t.number}`));
  if (excel.length) return pass(`${excel.length} of ${tables.length} supplemental tables declared as Excel files; check the remaining ones do not exceed 3 pages`, ev, "medium");
  return review(`${tables.length} supplemental table${tables.length === 1 ? "" : "s"}; verify none exceeds 3 pages (Excel file required otherwise)`);
}

export function videosCheck(model: ManuscriptModel): RuleOutcome {
  const videos = model.supplementalItems.filter((i) => i.kind === "video");
  if (!videos.length) return fail("Videos are mentioned but no video titles/legends are listed in the main document");
  const bad = videos.filter((v) => !v.relatedTo.length);
  if (bad.length) return fail(`${bad.length} of ${videos.length} video titles lack "Related to" information`, bad.slice(0, 2).map((v) => evidenceFromSpan(model, v.span, `Video ${v.number}`)));
  return pass(`${videos.length} video title${videos.length === 1 ? "" : "s"} with "Related to" information`);
}

export function equationsCheck(model: ManuscriptModel): RuleOutcome {
  const ev = model.features.equations.evidence.slice(0, 2).map((q) => evidenceFromText(q, "equation"));
  if (model.docx) {
    const editable = model.docx.ommlEquations + model.docx.mathTypeObjects;
    if (editable > 0) return pass(`${editable} editable equation${editable === 1 ? "" : "s"} (OMML/MathType)`, ev);
    return fail("Equations detected but none is an editable OMML or MathType object (they may be images)", ev);
  }
  return review("Equations detected; cannot verify from a PDF that they are editable OMML/MathType objects", ev);
}

/** Feature-triggered reminders that always need the editor's eye. */
export function featureReminder(featureKey: keyof ManuscriptModel["features"], summary: string, status: "review" | "fail" = "review") {
  return (model: ManuscriptModel): RuleOutcome => {
    const f = model.features[featureKey];
    const ev = f.evidence.slice(0, 3).map((q) => evidenceFromText(q, featureKey));
    return status === "fail" ? fail(summary, ev, "medium") : review(summary, ev);
  };
}
