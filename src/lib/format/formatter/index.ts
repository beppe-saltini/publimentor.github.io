/**
 * Journal-Ready Formatter engine — public surface.
 */
export * from "./types";
export { iscienceTarget, genericTarget, resolveTargetStructure, listTargetStructures } from "./target-structures";
export { KRT_ROW_GROUPS, LEAD_CONTACT_TEMPLATE, MATERIALS_AVAILABILITY_TEMPLATE, DATA_CODE_BULLETS } from "./target-structures/iscience";
export { planFormatting, linkCheckIds, collectAuthorActions, type PlanOptions } from "./plan";
export { buildLayout, LayoutBuilder } from "./layout";
export { repairReferences, renderReference, formatReferencesOffline, defaultRepairDeps, type RepairDeps } from "./references";
export { parseRawReference, type ParsedReference } from "./reference-parse";
export { renderFormattedDocx, outputFileName } from "./render-docx";
export { applyPlanToDocx } from "./apply-docx";
export { buildChangeLog, buildAuthorLetter, summarizeAutomaticWork } from "./change-log";
export { composeAuthorLetter, formatManuscript, type ComposedLetter, type ComposedLetterItem, type ComposeLetterArgs, type FormatManuscriptArgs, type FormatManuscriptResult } from "./orchestrate";
export { linkCheckIds as linkOperationsToChecks, checkIdsFor, topicsFor, TOPIC_CHECKS } from "./check-links";
export { normalizeHeading, splitParagraphs } from "./plan-utils";
