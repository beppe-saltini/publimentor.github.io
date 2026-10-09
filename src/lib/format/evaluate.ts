/**
 * Runs a journal profile against a ManuscriptModel and produces the report:
 * one CheckResult per check, summary counts, and the author letter.
 *
 * Flow: appliesWhen gate -> rule detectors (sync) -> all llm detectors in ONE
 * batched Claude call -> manual detectors as "unknown" -> editor overrides ->
 * summary counts and letter.
 */

import type { ManuscriptModel } from "./manuscript-model";
import type { CheckOverrides, CheckResult, CheckStatus, FormatCheck, FormatCheckReport, JournalProfile } from "./profile";
import { buildLetter } from "./letter";
import { judgeWithClaude, type LlmJudgeOptions, type LlmJudgmentRequest } from "./llm-judgments";

export interface RunFormatChecksOptions {
  /** Set to false to skip the Claude call (llm checks are reported as unknown). */
  llm?: boolean;
  overrides?: CheckOverrides;
  /** Passed through to the batched Claude call (tests inject fetchImpl / apiKey). */
  llmOptions?: LlmJudgeOptions;
  /** Report timestamp (defaults to now). */
  now?: Date;
}

const detectorKind = (check: FormatCheck): CheckResult["detector"] => check.detector.kind;

function result(check: FormatCheck, status: CheckStatus, summary: string, confidence: CheckResult["confidence"], detector = detectorKind(check), evidence: CheckResult["evidence"] = []): CheckResult {
  return { checkId: check.id, status, summary, evidence, confidence, detector, letterPhrase: check.phrase };
}

/**
 * Synchronous pass: rule and manual detectors are decided here; llm detectors are
 * returned as "unknown" placeholders and their prompts collected for batching.
 */
export function evaluateRuleChecks(model: ManuscriptModel, profile: JournalProfile): { results: CheckResult[]; llmRequests: LlmJudgmentRequest[] } {
  const results: CheckResult[] = [];
  const llmRequests: LlmJudgmentRequest[] = [];
  for (const check of profile.checks) {
    if (check.appliesWhen && !safeApplies(check, model)) {
      results.push(result(check, "not_applicable", "Not applicable to this manuscript", "high"));
      continue;
    }
    const detector = check.detector;
    if (detector.kind === "rule") {
      try {
        const outcome = detector.evaluate(model);
        results.push({ ...outcome, checkId: check.id, detector: "rule", letterPhrase: check.phrase });
      } catch (err) {
        // A rule must never take the whole report down; surface it as unknown.
        results.push(result(check, "unknown", `Rule failed to evaluate: ${err instanceof Error ? err.message : String(err)}`, "low"));
      }
    } else if (detector.kind === "llm") {
      const prompt = safePrompt(check, model);
      if (!prompt) {
        results.push(result(check, "unknown", "No manuscript excerpt available for this check", "low"));
      } else {
        llmRequests.push({ checkId: check.id, ...prompt });
        results.push(result(check, "unknown", "Awaiting semantic review", "low"));
      }
    } else {
      results.push(result(check, "unknown", "Editor decision required", "low", "manual"));
    }
  }
  return { results, llmRequests };
}

function safeApplies(check: FormatCheck, model: ManuscriptModel): boolean {
  try {
    return check.appliesWhen ? check.appliesWhen(model) : true;
  } catch {
    return true;
  }
}

function safePrompt(check: FormatCheck, model: ManuscriptModel) {
  if (check.detector.kind !== "llm") return null;
  try {
    return check.detector.prompt(model);
  } catch {
    return null;
  }
}

/** Replace statuses/notes with the editor's decisions. */
export function applyOverrides(results: CheckResult[], overrides?: CheckOverrides): CheckResult[] {
  if (!overrides) return results;
  return results.map((r) => {
    const o = overrides[r.checkId];
    if (!o || (!o.status && !o.note)) return r;
    return {
      ...r,
      status: o.status ?? r.status,
      summary: o.note ? `${r.summary} — Editor: ${o.note}` : r.summary,
      detector: o.status ? "manual" : r.detector,
      confidence: o.status ? "high" : r.confidence,
    };
  });
}

export function summarizeResults(results: CheckResult[]): FormatCheckReport["summary"] {
  const summary: FormatCheckReport["summary"] = { pass: 0, fail: 0, review: 0, not_applicable: 0, unknown: 0, total: results.length };
  for (const r of results) summary[r.status] += 1;
  return summary;
}

export async function runFormatChecks(model: ManuscriptModel, profile: JournalProfile, options: RunFormatChecksOptions = {}): Promise<FormatCheckReport> {
  const { results, llmRequests } = evaluateRuleChecks(model, profile);

  if (llmRequests.length) {
    const byId = new Map(results.map((r) => [r.checkId, r]));
    if (options.llm === false) {
      for (const req of llmRequests) byId.get(req.checkId)!.summary = "Semantic check skipped (LLM disabled)";
    } else {
      const { judgments, error } = await judgeWithClaude(llmRequests, options.llmOptions);
      for (const req of llmRequests) {
        const target = byId.get(req.checkId)!;
        const j = judgments.get(req.checkId);
        if (j) {
          target.status = j.status;
          target.summary = j.summary;
          target.evidence = j.evidence.slice(0, 3).map((quote) => ({ quote }));
          target.confidence = j.status === "unknown" ? "low" : j.confidence;
        } else {
          target.summary = error ? `Semantic check unavailable (${error})` : "Semantic check returned no judgment";
        }
      }
    }
  }

  const finalResults = applyOverrides(results, options.overrides);
  const letter = buildLetter(profile, finalResults);
  return {
    profileId: profile.id,
    profileVersion: profile.version,
    checkedAt: (options.now ?? new Date()).toISOString(),
    results: finalResults,
    summary: summarizeResults(finalResults),
    letter,
    stats: {
      wordCount: model.wordCount,
      pageCount: model.pageCount,
      referenceCount: model.references.count,
      figureLegendCount: model.figureLegends.length,
      sourceType: model.sourceType,
    },
  };
}
