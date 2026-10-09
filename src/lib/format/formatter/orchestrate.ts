/**
 * Orchestrator of the Journal-Ready Formatter: one call that plans, renders
 * and writes up a manuscript, plus the composed author letter.
 *
 * composeAuthorLetter merges two sources of "please fix" items:
 *   (a) the planner's author actions (what the engine could not do itself);
 *   (b) the failing checks of the FormatCheckReport that no operation of the
 *       plan addresses. A check linked to an *automatic* operation was fixed
 *       by the engine; a check linked to a *manual* operation is already in
 *       the letter through that operation's own, item-specific wording.
 * The result reads like the editorial office's letter: the profile preamble,
 * "* " items, and one closing sentence listing what was done automatically.
 *
 * formatManuscript runs the whole pipeline: planFormatting -> rebuilt .docx
 * (always) -> tracked-changes .docx (docx source only) -> change log ->
 * letter -> summary counts. It never throws for the optional tracked
 * document: a failure there is reported in `warnings` and the rebuilt file
 * is still returned.
 */
import type { ManuscriptModel } from "@/lib/format/manuscript-model";
import type { CheckResult, FormatCheckReport, JournalProfile } from "@/lib/format/profile";
import { applyPlanToDocx, type TrackedDocument } from "./apply-docx";
import { buildChangeLog, summarizeAutomaticWork } from "./change-log";
import { planFormatting, type PlanOptions } from "./plan";
import { renderFormattedDocx } from "./render-docx";
import { resolveTargetStructure } from "./target-structures";
import type { FormatPlan, FormattedDocument } from "./types";

export interface ComposedLetterItem {
  /** Letter line including the spreadsheet's "* " prefix. */
  text: string;
  checkIds?: string[];
  /** "plan": engine author action; "check": failing check the engine did not address. */
  origin: "plan" | "check";
}

export interface ComposedLetter {
  preamble: string;
  items: ComposedLetterItem[];
  /** One sentence listing the automatic work; empty when nothing was automatic. */
  closing: string;
  /** Preamble, items and closing assembled as plain text. */
  text: string;
}

export interface ComposeLetterArgs {
  plan: FormatPlan;
  report?: FormatCheckReport;
  profile: JournalProfile;
  /** "pdf" | "docx" | "text": kept for callers that word the preamble by source. */
  sourceType: string;
}

/** Line shown when neither the plan nor the checks need anything from the authors. */
export const LETTER_NO_ITEMS_LINE = "* No further information is required from you at this stage.";

/** Key used to de-duplicate items: prefix-free, single-spaced, lower-case. */
export function normalizeLetterText(text: string): string {
  return text.replace(/^\s*\*\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** "* " prefix exactly once. */
function withBullet(text: string): string {
  const t = text.trim();
  return /^\*\s/.test(t) ? t : `* ${t}`;
}

/** Check ids that any operation of the plan addresses (automatic or not). */
export function addressedCheckIds(plan: FormatPlan): Set<string> {
  const ids = new Set<string>();
  for (const op of plan.operations) for (const id of op.checkIds || []) ids.add(id);
  for (const a of plan.authorActions) for (const id of a.checkIds || []) ids.add(id);
  return ids;
}

/**
 * Failing checks the plan does not address, in profile order, with their
 * letter phrase (result wording first, then the check's own phrase).
 */
export function unaddressedFailures(plan: FormatPlan, report: FormatCheckReport | undefined, profile: JournalProfile): Array<{ result: CheckResult; text: string }> {
  if (!report) return [];
  const addressed = addressedCheckIds(plan);
  const byId = new Map(report.results.map((r) => [r.checkId, r]));
  const out: Array<{ result: CheckResult; text: string }> = [];
  for (const check of profile.checks) {
    const result = byId.get(check.id);
    if (!result || result.status !== "fail" || addressed.has(check.id)) continue;
    const text = (result.letterPhrase ?? check.phrase).trim();
    if (text) out.push({ result, text });
  }
  return out;
}

export function composeAuthorLetter(args: ComposeLetterArgs): ComposedLetter {
  const { plan, report, profile } = args;
  const items: ComposedLetterItem[] = [];
  const seen = new Set<string>();
  const push = (item: ComposedLetterItem) => {
    const key = normalizeLetterText(item.text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push({ ...item, text: withBullet(item.text) });
  };
  for (const action of plan.authorActions) push({ text: action.text, origin: "plan", ...(action.checkIds?.length ? { checkIds: action.checkIds } : {}) });
  for (const { result, text } of unaddressedFailures(plan, report, profile)) push({ text, origin: "check", checkIds: [result.checkId] });

  const closing = summarizeAutomaticWork(plan);
  const preamble = profile.letterPreamble.trim();
  const body = items.length > 0 ? items.map((i) => i.text).join("\n") : LETTER_NO_ITEMS_LINE;
  const text = [preamble, body, closing].filter(Boolean).join("\n\n");
  return { preamble, items, closing, text };
}

export interface FormatManuscriptArgs {
  model: ManuscriptModel;
  profile: JournalProfile;
  report?: FormatCheckReport;
  /** Original bytes; a .docx source also gets a tracked-changes version. */
  sourceBuffer?: Buffer;
  journalName: string;
  /** Default true: rebuild references from Crossref. */
  repairReferences?: boolean;
  /** Test hook forwarded to planFormatting (injected Crossref client). */
  repairDeps?: PlanOptions["repairDeps"];
}

export interface FormatManuscriptResult {
  plan: FormatPlan;
  rebuilt: FormattedDocument;
  /** Only when the source was a .docx and its bytes were supplied. */
  tracked?: FormattedDocument;
  changeLog: string;
  letter: ComposedLetter;
  summary: { automatic: number; needsAuthor: number; referencesMatched: number; referencesTotal: number };
  /** Non-fatal problems (e.g. the tracked-changes pass failed). */
  warnings?: string[];
}

export async function formatManuscript(args: FormatManuscriptArgs): Promise<FormatManuscriptResult> {
  const { model, profile, report } = args;
  const target = resolveTargetStructure(profile.id);
  const plan = await planFormatting(model, target, { report, repairReferences: args.repairReferences, repairDeps: args.repairDeps });
  const rebuilt = await renderFormattedDocx(model, plan, target, { journalName: args.journalName });

  let tracked: TrackedDocument | undefined;
  const warnings: string[] = [];
  if (model.sourceType === "docx" && args.sourceBuffer) {
    try {
      tracked = await applyPlanToDocx(args.sourceBuffer, plan, target, { fileName: model.fileName });
    } catch (err) {
      // The rebuilt document is the deliverable; a tracked-changes failure must not lose it.
      warnings.push(`Tracked-changes document could not be produced: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const changeLog = buildChangeLog(plan);
  const letter = composeAuthorLetter({ plan, report, profile, sourceType: model.sourceType });
  const referencesMatched = plan.references.filter((r) => r.matched).length;
  return {
    plan,
    rebuilt,
    ...(tracked ? { tracked } : {}),
    changeLog,
    letter,
    summary: { automatic: plan.stats.automatic, needsAuthor: plan.stats.needsAuthor, referencesMatched, referencesTotal: plan.references.length },
    ...(warnings.length ? { warnings } : {}),
  };
}
