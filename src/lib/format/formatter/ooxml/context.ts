/**
 * Shared state for applying a FormatPlan to one document.xml DOM.
 */
import type { FormatOperationKind, FormatPlan, TargetStructure } from "../types";
import { normalizeText, type HeadingContext } from "./paragraphs";
import type { StyleMap } from "./styles";
import type { RevisionContext } from "./tracked";
import { childW, rootElement, type XmlDocument, type XmlElement } from "./xml";

export interface AppliedOperation {
  opId: string;
  kind: FormatOperationKind;
  /** applied: tracked change written; skipped: target text not found; manual: authors must act. */
  status: "applied" | "skipped" | "manual";
  detail: string;
}

export interface ApplyContext {
  doc: XmlDocument;
  body: XmlElement;
  rev: RevisionContext;
  target: TargetStructure;
  plan: FormatPlan;
  styles: StyleMap;
  heading: HeadingContext;
  log: AppliedOperation[];
}

/** Normalized names of the journal's top-level sections (and common aliases). */
export function topLevelNames(target: TargetStructure): Set<string> {
  const names = new Set<string>();
  for (const slot of target.slots) {
    names.add(normalizeText(slot.heading));
    for (const alias of slot.aliases) names.add(normalizeText(alias));
  }
  for (const [from, to] of Object.entries(target.headingRenames)) {
    names.add(normalizeText(from));
    names.add(normalizeText(to));
  }
  // Section names seen in most manuscripts regardless of journal.
  for (const common of [
    "abstract", "summary", "introduction", "background", "results", "discussion",
    "results and discussion", "methods", "materials and methods", "online methods",
    "experimental procedures", "star methods", "references", "acknowledgements",
    "acknowledgments", "author contributions", "competing interests",
    "declaration of interests", "conflict of interest", "figure legends",
    "figure captions", "supplementary information", "supplemental information",
    "data availability", "code availability", "limitations of the study",
  ]) names.add(common);
  return names;
}

export function createApplyContext(
  doc: XmlDocument,
  rev: RevisionContext,
  target: TargetStructure,
  plan: FormatPlan,
  styles: StyleMap
): ApplyContext {
  const body = childW(rootElement(doc), "body");
  if (!body) throw new Error("document.xml has no w:body");
  return {
    doc,
    body,
    rev,
    target,
    plan,
    styles,
    heading: { styles, topLevelNames: topLevelNames(target) },
    log: [],
  };
}

export function logOp(ctx: ApplyContext, opId: string, kind: FormatOperationKind, status: AppliedOperation["status"], detail: string): void {
  ctx.log.push({ opId, kind, status, detail });
}
