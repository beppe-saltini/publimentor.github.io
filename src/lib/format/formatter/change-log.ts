/**
 * Human-readable outputs of a FormatPlan: the change log (everything that
 * was done, grouped by automatic vs. needs-author) and the letter to the
 * authors (only what they still have to supply, plus one closing sentence
 * so they know what was reformatted automatically and should be reviewed).
 */
import type { FormatOperation, FormatPlan } from "./types";

const KIND_LABEL: Record<FormatOperation["kind"], string> = {
  rename_heading: "Renamed headings",
  move_block: "Moved sections",
  insert_section: "Inserted sections",
  merge_sections: "Merged sections",
  retitle_legend: "Retitled figure legends",
  collect_legends: "Collected figure legends",
  retitle_supplemental: "Retitled supplemental items",
  add_see_also: "Added See-also references",
  rewrite_reference: "Rebuilt references",
  add_doi: "Added DOIs to references",
  convert_citations: "Citation style",
  insert_placeholder: "Inserted placeholders",
  prefill_krt: "Key Resources Table",
  split_summary: "Summary",
  note: "Notes",
};

/** Order in which groups appear in the log (most structural first). */
const KIND_ORDER: FormatOperation["kind"][] = ["move_block", "rename_heading", "merge_sections", "insert_section", "insert_placeholder", "collect_legends", "retitle_legend", "add_see_also", "retitle_supplemental", "prefill_krt", "split_summary", "convert_citations", "add_doi", "rewrite_reference", "note"];

function line(op: FormatOperation): string {
  const parts = [`- ${op.description}`];
  if (op.before && op.after && op.before !== op.after) parts.push(`    before: ${op.before}`, `    after:  ${op.after}`);
  else if (op.after && !op.before) parts.push(`    now: ${op.after}`);
  if (op.checkIds && op.checkIds.length > 0) parts.push(`    checks: ${op.checkIds.join(", ")}`);
  return parts.join("\n");
}

function grouped(ops: FormatOperation[]): string[] {
  const out: string[] = [];
  for (const kind of KIND_ORDER) {
    const list = ops.filter((o) => o.kind === kind);
    if (list.length === 0) continue;
    out.push(`### ${KIND_LABEL[kind]} (${list.length})`);
    out.push(...list.map(line));
    out.push("");
  }
  return out;
}

/** Markdown-ish plain text change log. */
export function buildChangeLog(plan: FormatPlan): string {
  const auto = plan.operations.filter((o) => o.automatic);
  const manual = plan.operations.filter((o) => !o.automatic);
  const matched = plan.references.filter((r) => r.matched).length;
  const lines: string[] = [
    `# Formatting change log — ${plan.profileId} (target structure v${plan.targetStructureVersion})`,
    "",
    `${auto.length} change(s) applied automatically; ${manual.length} item(s) need the authors.`,
    plan.references.length > 0 ? `References: ${matched} of ${plan.references.length} matched on Crossref and rebuilt with DOIs; ${plan.references.length - matched} kept as written.` : "References: none found.",
    "",
    "## Applied automatically",
    "",
    ...(auto.length > 0 ? grouped(auto) : ["- (nothing)", ""]),
    "## Needs the authors",
    "",
    ...(manual.length > 0 ? grouped(manual) : ["- (nothing)", ""]),
  ];
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Summarize the automatic work in one sentence for the letter (the closing
 * line after the author items). Empty when nothing was done automatically.
 */
export function summarizeAutomaticWork(plan: FormatPlan): string {
  const auto = plan.operations.filter((o) => o.automatic);
  const kinds = new Set(auto.map((o) => o.kind));
  const topics = new Set(auto.map((o) => o.topic));
  const bits: string[] = [];
  if (topics.has("pdf_to_docx")) bits.push("rebuilt the manuscript as an editable Word document");
  if (kinds.has("move_block") || kinds.has("rename_heading")) bits.push("renamed and reordered the sections to the journal's structure");
  if (topics.has("lead_contact_footnote")) bits.push("added the Lead Contact footnote to the title page");
  if (kinds.has("merge_sections")) bits.push("merged the availability statements under Resource Availability");
  if (kinds.has("collect_legends") || kinds.has("retitle_legend") || kinds.has("add_see_also")) bits.push("gathered and retitled the figure legends");
  if (kinds.has("retitle_supplemental")) bits.push("retitled the supplemental items");
  if (kinds.has("prefill_krt")) bits.push("prefilled the Key Resources Table skeleton");
  const matched = plan.references.filter((r) => r.matched).length;
  if (matched > 0) bits.push(`rebuilt ${matched} reference(s) in journal style with DOIs from Crossref`);
  if (bits.length === 0) return "";
  const list = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}`;
  return `For your convenience we have already ${list}; please review these changes in the attached document.`;
}

/** Letter: preamble, one "* " item per author action, closing sentence. */
export function buildAuthorLetter(plan: FormatPlan, preamble: string): string {
  const items = plan.authorActions.map((a) => `* ${a.text}`);
  const closing = summarizeAutomaticWork(plan);
  const body = items.length > 0 ? items.join("\n\n") : "* No further information is required from you at this stage.";
  return [preamble.trim(), "", body, "", closing].filter((s, i, arr) => !(s === "" && arr[i + 1] === "")).join("\n").trim() + "\n";
}
