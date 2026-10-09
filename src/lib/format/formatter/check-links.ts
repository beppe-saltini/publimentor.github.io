/**
 * Link formatting operations to the profile checks they address.
 *
 * The composed author letter (orchestrate.ts) drops every failing check that
 * an *automatic* operation has fixed, so the mapping here must be explicit:
 * a keyword match that over-links would silently remove a legitimate item
 * from the letter. Every rule therefore names concrete check-id suffixes
 * (the part after the profile prefix: "iscience.summary.heading" ->
 * "summary.heading"), taken from src/lib/format/profiles/*.
 *
 * An operation is looked up by its `topic` (the letter-phrase key its
 * creator used), falling back to its slot id, and then by its kind. Only
 * open checks of the report (fail/review) are linked; without a report no
 * ids can be resolved and the operations are left untouched.
 */
import type { CheckResult, FormatCheckReport } from "@/lib/format/profile";
import type { FormatOperation } from "./types";

/** Topic (letter-phrase key or slot id) -> check-id suffixes it addresses. */
export const TOPIC_CHECKS: Record<string, string[]> = {
  // Title page
  title: ["title.length"],
  lead_contact_footnote: ["title.lead_contact_footnote"],
  corresponding_email: ["title.corresponding_email"],
  pdf_to_docx: ["file.word"],
  // Summary and body
  // The slot topic is used by the Abstract -> Summary rename, which fixes the
  // heading only; the length/framing checks must stay in the letter.
  summary: ["summary.heading"],
  summary_heading: ["summary.heading"],
  summary_length: ["summary.length"],
  summary_citations: ["summary.length"],
  introduction: ["sections.order", "sections.imrad"],
  results: ["sections.order", "sections.imrad"],
  discussion: ["sections.order", "sections.imrad"],
  results_subheadings: ["body.results_subheadings"],
  sections_order: ["sections.order"],
  // Back matter
  resource_availability: ["resource.section", "sections.order"],
  lead_contact: ["resource.lead_contact"],
  materials_availability: ["resource.materials_availability"],
  data_code_availability: ["resource.data_code_availability", "statements.data_availability"],
  limitations: ["sections.limitations"],
  acknowledgments: ["statements.acknowledgments", "statements.funding"],
  author_contributions: ["statements.author_contributions"],
  declaration_of_interests: ["statements.declaration_of_interests", "statements.competing_interests"],
  ai_declaration: ["statements.ai_declaration"],
  // Figures, tables, supplemental
  figure_legends: ["figures.legends_list"],
  legend_statistics: ["figures.error_bars", "figures.asterisks"],
  legend_asterisks: ["figures.asterisks"],
  figures_separate_files: ["figures.separate_files"],
  see_also: ["figures.see_also"],
  tables: ["tables.format"],
  supplemental_titles: ["supplemental.related_to"],
  supplemental_related: ["supplemental.related_to"],
  highlights: ["associated.highlights"],
  // STAR Methods
  star_methods: ["star.present", "star.headings_order", "star.subheadings"],
  experimental_model: ["star.experimental_model"],
  subject_details: ["ethics.vertebrates", "ethics.humans", "ethics.animals", "star.experimental_model"],
  method_details: ["star.method_details"],
  quantification: ["star.quantification"],
  krt: ["krt.present", "krt.customized"],
  krt_deposited_data: ["data.rnaseq", "data.proteomics", "data.microarray", "data.structures", "data.gene_sequences", "data.accessions_not_in_krt"],
  // References
  references: ["references.entries"],
  reference_entries: ["references.entries"],
  unmatched_references: ["references.entries"],
  in_press: ["references.in_press"],
  citation_style: ["references.in_text"],
  separate_reference_list: ["star.separate_reference_list"],
};

/** Kind-based links that hold whatever the slot (legend and reference work). */
const KIND_TOPICS: Partial<Record<FormatOperation["kind"], string>> = {
  collect_legends: "figure_legends",
  retitle_legend: "figure_legends",
  add_see_also: "see_also",
  retitle_supplemental: "supplemental_related",
  rewrite_reference: "reference_entries",
  add_doi: "reference_entries",
  convert_citations: "citation_style",
  prefill_krt: "krt",
};

/**
 * Topics an operation addresses. Automatic moves fix the section order; a
 * heading rename fixes the check of the slot it was renamed to.
 */
export function topicsFor(op: FormatOperation): string[] {
  const topics = new Set<string>();
  if (op.topic) topics.add(op.topic);
  else if (op.slotId) topics.add(op.slotId);
  const byKind = KIND_TOPICS[op.kind];
  if (byKind) topics.add(byKind);
  if (op.kind === "move_block" && op.automatic) topics.add("sections_order");
  if (op.kind === "rename_heading" && op.slotId === "summary") topics.add("summary_heading");
  // The prefilled KRT lists every detected accession under "Deposited data",
  // so a deposition check that failed only for want of a table is covered by
  // the KRT item of the letter (resultMatchesTopic keeps the "no accession" case).
  if (op.kind === "prefill_krt") topics.add("krt_deposited_data");
  return Array.from(topics);
}

/** Check-id suffix ("iscience.summary.heading" -> "summary.heading"). */
export function checkSuffix(checkId: string): string {
  const dot = checkId.indexOf(".");
  return dot >= 0 ? checkId.slice(dot + 1) : checkId;
}

/**
 * The deposition checks fail for two different reasons: no accession at all
 * (the authors must deposit) or accessions present but no Key Resources
 * Table to list them in. Prefilling the KRT fixes only the second, so the
 * krt_deposited_data topic links a result only when its summary says so.
 */
function resultMatchesTopic(result: CheckResult, topic: string): boolean {
  if (topic !== "krt_deposited_data") return true;
  return /key resources? table/i.test(result.summary);
}

/** Resolve the check ids of a report that an operation addresses. */
export function checkIdsFor(op: FormatOperation, open: CheckResult[]): string[] {
  const ids: string[] = [];
  for (const topic of topicsFor(op)) {
    const suffixes = TOPIC_CHECKS[topic];
    if (!suffixes) continue;
    for (const r of open) {
      if (suffixes.includes(checkSuffix(r.checkId)) && resultMatchesTopic(r, topic) && !ids.includes(r.checkId)) ids.push(r.checkId);
    }
  }
  return ids;
}

/** Fill `checkIds` on every operation from the open (fail/review) checks of the report. */
export function linkCheckIds(ops: FormatOperation[], report: FormatCheckReport | undefined): void {
  if (!report) return;
  const open = report.results.filter((r) => r.status === "fail" || r.status === "review");
  for (const op of ops) {
    const ids = checkIdsFor(op, open);
    if (ids.length > 0) op.checkIds = Array.from(new Set([...(op.checkIds || []), ...ids]));
  }
}
