/**
 * Semantic checks answered by Claude in ONE batched call.
 *
 * Rule detectors cover everything that can be decided from the manuscript
 * structure. A handful of iScience rows are genuinely semantic (does the Summary
 * give background, approach and significance? are the methods sufficient or
 * mostly citations? is gene nomenclature consistent?). The evaluator collects
 * those prompts and sends them here as a single request with a strict JSON
 * schema (claudeJsonFormat), so one manuscript costs one API round-trip.
 *
 * Failure modes are soft: no API key, a network error, a refusal or malformed
 * JSON all return an empty judgment set plus an error string, and the evaluator
 * reports those checks as "unknown" so the editor can decide by hand.
 */

import { z } from "zod";
import { ANTHROPIC_PRIMARY_MODEL, responseText, isRefusal } from "@/lib/anthropic-models";
import { claudeJsonFormat } from "@/lib/claude-schema";

export interface LlmJudgmentRequest {
  checkId: string;
  /** What to decide, written for the model (includes the journal rule). */
  instructions: string;
  /** The manuscript passage(s) the decision should rest on. */
  excerpt: string;
}

export const llmJudgmentSchema = z.object({
  checkId: z.string(),
  status: z.enum(["pass", "fail", "review", "unknown"]),
  summary: z.string(),
  evidence: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
});
export type LlmJudgment = z.infer<typeof llmJudgmentSchema>;

const responseSchema = z.object({ judgments: z.array(llmJudgmentSchema) });

export interface LlmJudgeOptions {
  apiKey?: string;
  model?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Each excerpt is clipped to this many characters to bound the prompt. */
  maxExcerptChars?: number;
  timeoutMs?: number;
}

export interface LlmJudgeResult {
  judgments: Map<string, LlmJudgment>;
  /** Set when the batch could not be judged (missing key, HTTP error, bad JSON...). */
  error?: string;
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export function buildJudgmentPrompt(requests: LlmJudgmentRequest[], maxExcerptChars: number): string {
  const blocks = requests.map((r) => {
    const excerpt = r.excerpt.length > maxExcerptChars ? `${r.excerpt.slice(0, maxExcerptChars)}\n[...excerpt truncated]` : r.excerpt;
    return `<check id="${r.checkId}">\n<instructions>\n${r.instructions}\n</instructions>\n<excerpt>\n${excerpt}\n</excerpt>\n</check>`;
  });
  return `You are a scientific journal's production editor running pre-acceptance formatting checks on an accepted manuscript.
For EACH <check> below, decide whether the manuscript excerpt satisfies the instructions.
Return one judgment per check id, with:
- status: "pass" when the requirement is clearly met, "fail" when it is clearly not met and the authors must change the manuscript, "review" when a human editor should look (borderline or partial), "unknown" when the excerpt does not allow a decision;
- summary: one sentence an editor can read in a checklist (mention counts or the offending wording);
- evidence: up to three short verbatim quotes from the excerpt that support the decision (empty if none);
- confidence: high, medium or low.
Judge only from the excerpts. Do not invent content that is not quoted.

${blocks.join("\n\n")}`;
}

export async function judgeWithClaude(requests: LlmJudgmentRequest[], options: LlmJudgeOptions = {}): Promise<LlmJudgeResult> {
  const judgments = new Map<string, LlmJudgment>();
  if (!requests.length) return { judgments };
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { judgments, error: "ANTHROPIC_API_KEY not configured" };

  const fetchImpl = options.fetchImpl ?? fetch;
  const prompt = buildJudgmentPrompt(requests, options.maxExcerptChars ?? 8000);
  try {
    const response = await fetchImpl(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: options.model ?? ANTHROPIC_PRIMARY_MODEL,
        max_tokens: 4096,
        output_config: { format: claudeJsonFormat(responseSchema) },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
    });
    if (!response.ok) return { judgments, error: `Claude API error ${response.status}` };
    const data: unknown = await response.json();
    if (isRefusal(data)) return { judgments, error: "Claude refused the request" };
    const text = responseText(data);
    if (!text) return { judgments, error: "Empty response from Claude" };
    const parsed = responseSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return { judgments, error: "Claude response did not match the schema" };
    const wanted = new Set(requests.map((r) => r.checkId));
    for (const j of parsed.data.judgments) if (wanted.has(j.checkId)) judgments.set(j.checkId, j);
    return { judgments };
  } catch (err) {
    return { judgments, error: err instanceof Error ? err.message : "LLM call failed" };
  }
}
