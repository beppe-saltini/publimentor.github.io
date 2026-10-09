/**
 * planFormatting: diff a manuscript model against a journal target and
 * return a FormatPlan — operations, rebuilt references, the assembled
 * layout and the de-duplicated list of author actions.
 */
import type { ManuscriptModel } from "@/lib/format/manuscript-model";
import type { FormatCheckReport } from "@/lib/format/profile";
import { linkCheckIds } from "./check-links";
import { buildLayout } from "./layout";
import { makeOp, OpIdFactory, snippet } from "./plan-utils";
import { formatReferencesOffline, repairReferences, type RepairDeps } from "./references";
import { TARGET_STRUCTURE_VERSION, type FormatOperation, type FormatPlan, type RepairedReference, type TargetStructure } from "./types";

export interface PlanOptions {
  report?: FormatCheckReport;
  /** Default true: look references up on Crossref. */
  repairReferences?: boolean;
  /** Test hook: injected network layer for the reference repair. */
  repairDeps?: Partial<RepairDeps>;
}

export { linkCheckIds } from "./check-links";

/** One author action per distinct sentence, keeping the first slot/checks. */
export function collectAuthorActions(ops: FormatOperation[]): FormatPlan["authorActions"] {
  const seen = new Map<string, FormatPlan["authorActions"][number]>();
  for (const op of ops) {
    if (!op.needsAuthorInput) continue;
    const key = op.needsAuthorInput.replace(/\s+/g, " ").trim().toLowerCase();
    const existing = seen.get(key);
    if (existing) {
      if (op.checkIds) existing.checkIds = Array.from(new Set([...(existing.checkIds || []), ...op.checkIds]));
      continue;
    }
    seen.set(key, { slotId: op.slotId, text: op.needsAuthorInput.trim(), ...(op.checkIds ? { checkIds: op.checkIds } : {}) });
  }
  return Array.from(seen.values());
}

/** Operations describing the reference work (one per rewritten entry + summary). */
function referenceOperations(refs: RepairedReference[], model: ManuscriptModel, target: TargetStructure, ids: OpIdFactory, repaired: boolean): FormatOperation[] {
  const ops: FormatOperation[] = [];
  const matched = refs.filter((r) => r.matched);
  const unmatched = refs.filter((r) => !r.matched);
  if (model.references.inTextStyle !== "unknown" && model.references.inTextStyle !== target.references.citationStyle) {
    ops.push(makeOp(ids, "convert_citations", `In-text citations are ${model.references.inTextStyle}; the journal requires ${target.references.citationStyle}. Numbering was kept; citation markers must be converted in the source file.`, { slotId: "references", topic: "citation_style", needsAuthorInput: `Please cite references in the text as ${target.references.citationStyle.replace("-", " ")} (e.g. "...observation1,2").` }));
  }
  for (const r of matched) {
    const addedDoi = r.doi && !/10\.\d{4,9}\//.test(r.original);
    ops.push(makeOp(ids, addedDoi ? "add_doi" : "rewrite_reference", `Reference ${r.index}: rebuilt in ${target.references.style} style from Crossref${addedDoi ? " and added the DOI" : ""} (confidence ${r.confidence}).`, { slotId: "references", topic: "reference_entries", before: snippet(r.original, 160), after: snippet(r.formatted, 200) }));
  }
  if (unmatched.length > 0) {
    const list = unmatched.map((r) => r.index).join(", ");
    ops.push(makeOp(ids, "note", `${unmatched.length} reference(s) could not be verified on Crossref and were kept as written: ${list}.`, { slotId: "references", topic: "unmatched_references", needsAuthorInput: `Please check reference(s) ${list}: we could not match them on Crossref. Each article reference must include the author list, year, article title, journal abbreviation, volume, page range and DOI.` }));
  }
  const inPress = model.references.entries.filter((e) => e.isInPressOrUnpublished).map((e) => e.index);
  if (inPress.length > 0) ops.push(makeOp(ids, "note", `Reference(s) ${inPress.join(", ")} appear to be in press/unpublished.`, { slotId: "references", topic: "in_press", needsAuthorInput: `Reference(s) ${inPress.join(", ")} appear to be in press or unpublished. References should include only articles that are published or in press; for in-press articles please add the DOI and online publication date, and cite unpublished data in the text only.` }));
  if (!repaired && refs.length > 0) ops.push(makeOp(ids, "note", `References were reformatted offline in ${target.references.style} style (Crossref lookup disabled); DOIs were not added.`, { slotId: "references", topic: "reference_entries" }));
  if (model.references.separateSupplementalList) ops.push(makeOp(ids, "note", "A separate supplemental/STAR Methods reference list was detected.", { slotId: "references", topic: "separate_reference_list", needsAuthorInput: "Please combine the references cited in the STAR Methods with the main reference list (a supplemental reference list belongs only in the supplemental PDF)." }));
  return ops;
}

export async function planFormatting(model: ManuscriptModel, target: TargetStructure, options: PlanOptions = {}): Promise<FormatPlan> {
  const ids = new OpIdFactory();
  // A PDF source is rebuilt as an editable Word file: that alone settles the
  // "main document must be a Word file" check, so record it first.
  const sourceOps: FormatOperation[] = [];
  if (model.sourceType === "pdf") {
    sourceOps.push(makeOp(ids, "note", `Rebuilt the manuscript as an editable Word document from the PDF${model.fileName ? ` (${model.fileName})` : ""}.`, { slotId: "title_page", topic: "pdf_to_docx" }));
  }
  const { layout, operations } = buildLayout(model, target, ids);
  operations.unshift(...sourceOps);

  const entries = model.references.entries;
  const doRepair = options.repairReferences !== false && entries.length > 0;
  const references = doRepair ? await repairReferences(entries, target.references, options.repairDeps) : formatReferencesOffline(entries, target.references);
  operations.push(...referenceOperations(references, model, target, ids, doRepair));

  linkCheckIds(operations, options.report);
  const authorActions = collectAuthorActions(operations);
  const automatic = operations.filter((o) => o.automatic).length;
  return {
    profileId: target.profileId,
    targetStructureVersion: TARGET_STRUCTURE_VERSION,
    operations,
    references,
    authorActions,
    stats: { automatic, needsAuthor: operations.length - automatic },
    layout,
  };
}
