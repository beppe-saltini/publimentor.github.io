/**
 * runFormatChecks: appliesWhen gating, detector dispatch, batched LLM call with a
 * stubbed fetch, graceful failure, overrides, summary counts and the letter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FormatCheck, JournalProfile } from "../profile";
import { fail, pass } from "../profile";
import { evaluateRuleChecks, runFormatChecks } from "../evaluate";
import { buildJudgmentPrompt, judgeWithClaude } from "../llm-judgments";
import { makeModel } from "./profile-fixtures";

const base = (over: Partial<FormatCheck>): FormatCheck => ({
  id: "t.rule",
  category: "body",
  question: "q?",
  guideline: "g",
  severity: "required",
  detector: { kind: "rule", evaluate: () => pass("ok") },
  phrase: "* rule phrase",
  ...over,
});

const profile = (checks: FormatCheck[]): JournalProfile => ({
  id: "test", name: "Test", version: "1", sourceUrls: [], letterPreamble: "Preamble:", sectionOrder: [], checks,
});

/** A fetch stub that answers with a Claude-shaped JSON response. */
function claudeFetch(judgments: unknown[], status = 200) {
  return vi.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify({ judgments }) }], stop_reason: "end_turn" }),
  })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const savedKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => { delete process.env.ANTHROPIC_API_KEY; });
afterEach(() => { if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey; vi.unstubAllGlobals(); });

describe("evaluateRuleChecks", () => {
  it("gates on appliesWhen, runs rules, marks manual as unknown and collects llm prompts", () => {
    const checks = [
      base({ id: "t.na", appliesWhen: () => false }),
      base({ id: "t.fail", detector: { kind: "rule", evaluate: () => fail("bad", [{ quote: "q" }]) } }),
      base({ id: "t.manual", detector: { kind: "manual" } }),
      base({ id: "t.llm", detector: { kind: "llm", prompt: () => ({ instructions: "i", excerpt: "e" }) } }),
      base({ id: "t.llm-none", detector: { kind: "llm", prompt: () => null } }),
      base({ id: "t.throws", detector: { kind: "rule", evaluate: () => { throw new Error("boom"); } } }),
    ];
    const { results, llmRequests } = evaluateRuleChecks(makeModel(), profile(checks));
    const byId = Object.fromEntries(results.map((r) => [r.checkId, r]));
    expect(byId["t.na"]).toMatchObject({ status: "not_applicable", detector: "rule" });
    expect(byId["t.fail"]).toMatchObject({ status: "fail", summary: "bad", detector: "rule", letterPhrase: "* rule phrase", evidence: [{ quote: "q" }] });
    expect(byId["t.manual"]).toMatchObject({ status: "unknown", detector: "manual" });
    expect(byId["t.llm"]).toMatchObject({ status: "unknown", detector: "llm" });
    expect(byId["t.llm-none"]).toMatchObject({ status: "unknown", summary: expect.stringContaining("No manuscript excerpt") });
    expect(byId["t.throws"]).toMatchObject({ status: "unknown", summary: expect.stringContaining("boom") });
    expect(llmRequests).toEqual([{ checkId: "t.llm", instructions: "i", excerpt: "e" }]);
  });
});

describe("runFormatChecks", () => {
  const llmChecks = [
    base({ id: "t.llm1", detector: { kind: "llm", prompt: () => ({ instructions: "one", excerpt: "x" }) }, phrase: "* llm one" }),
    base({ id: "t.llm2", detector: { kind: "llm", prompt: () => ({ instructions: "two", excerpt: "y" }) }, phrase: "* llm two" }),
    base({ id: "t.rule", detector: { kind: "rule", evaluate: () => fail("rule failed") } }),
  ];

  it("sends all llm prompts in ONE request and maps the judgments back", async () => {
    const fetchImpl = claudeFetch([
      { checkId: "t.llm1", status: "fail", summary: "missing significance", evidence: ["quote"], confidence: "high" },
      { checkId: "t.llm2", status: "pass", summary: "fine", evidence: [], confidence: "medium" },
      { checkId: "t.unrelated", status: "fail", summary: "ignored", evidence: [], confidence: "low" },
    ]);
    const report = await runFormatChecks(makeModel(), profile(llmChecks), { llmOptions: { apiKey: "test-key", fetchImpl } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.messages[0].content).toContain('<check id="t.llm1">');
    expect(body.messages[0].content).toContain('<check id="t.llm2">');
    const byId = Object.fromEntries(report.results.map((r) => [r.checkId, r]));
    expect(byId["t.llm1"]).toMatchObject({ status: "fail", summary: "missing significance", detector: "llm", confidence: "high", evidence: [{ quote: "quote" }] });
    expect(byId["t.llm2"]).toMatchObject({ status: "pass", confidence: "medium" });
    expect(report.letter.items.map((i) => i.text)).toEqual(["* llm one", "* rule phrase"]);
    expect(report.summary).toEqual({ pass: 1, fail: 2, review: 0, not_applicable: 0, unknown: 0, total: 3 });
  });

  it("reports llm checks as unknown with low confidence when the API fails", async () => {
    const fetchImpl = claudeFetch([], 500);
    const report = await runFormatChecks(makeModel(), profile(llmChecks), { llmOptions: { apiKey: "test-key", fetchImpl } });
    const llm = report.results.filter((r) => r.detector === "llm");
    expect(llm).toHaveLength(2);
    for (const r of llm) expect(r).toMatchObject({ status: "unknown", confidence: "low", summary: expect.stringContaining("500") });
    expect(report.letter.items.map((i) => i.checkId)).toEqual(["t.rule"]);
  });

  it("never calls fetch without an API key, and can be disabled explicitly", async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const noKey = await runFormatChecks(makeModel(), profile(llmChecks));
    expect(globalFetch).not.toHaveBeenCalled();
    expect(noKey.results.find((r) => r.checkId === "t.llm1")).toMatchObject({ status: "unknown", summary: expect.stringContaining("ANTHROPIC_API_KEY") });
    const disabled = await runFormatChecks(makeModel(), profile(llmChecks), { llm: false, llmOptions: { apiKey: "k", fetchImpl: claudeFetch([]) } });
    expect(disabled.results.find((r) => r.checkId === "t.llm1")?.summary).toContain("disabled");
  });

  it("handles a refusal, malformed JSON and a thrown fetch", async () => {
    const refusal = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: "refusal", content: [] }) })) as unknown as typeof fetch;
    expect((await judgeWithClaude([{ checkId: "a", instructions: "i", excerpt: "e" }], { apiKey: "k", fetchImpl: refusal })).error).toContain("refused");
    const garbage = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "{not json" }] }) })) as unknown as typeof fetch;
    expect((await judgeWithClaude([{ checkId: "a", instructions: "i", excerpt: "e" }], { apiKey: "k", fetchImpl: garbage })).error).toBeDefined();
    const thrown = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    expect((await judgeWithClaude([{ checkId: "a", instructions: "i", excerpt: "e" }], { apiKey: "k", fetchImpl: thrown })).error).toBe("network down");
    expect((await judgeWithClaude([], { apiKey: "k", fetchImpl: thrown })).judgments.size).toBe(0);
  });

  it("clips long excerpts in the prompt", () => {
    const prompt = buildJudgmentPrompt([{ checkId: "a", instructions: "i", excerpt: "x".repeat(100) }], 10);
    expect(prompt).toContain("xxxxxxxxxx\n[...excerpt truncated]");
    expect(prompt).not.toContain("x".repeat(11));
  });

  it("applies editor overrides to status and notes, and reflects them in the letter", async () => {
    const checks = [
      base({ id: "t.a", detector: { kind: "rule", evaluate: () => fail("auto fail") }, phrase: "* A" }),
      base({ id: "t.b", detector: { kind: "rule", evaluate: () => pass("auto pass") }, phrase: "* B" }),
      base({ id: "t.c", detector: { kind: "rule", evaluate: () => pass("auto pass") }, phrase: "* C" }),
    ];
    const report = await runFormatChecks(makeModel(), profile(checks), {
      overrides: { "t.a": { status: "pass", note: "authors already fixed this" }, "t.b": { status: "fail" }, "t.c": { note: "looks fine" } },
    });
    const byId = Object.fromEntries(report.results.map((r) => [r.checkId, r]));
    expect(byId["t.a"]).toMatchObject({ status: "pass", detector: "manual", confidence: "high", summary: "auto fail — Editor: authors already fixed this" });
    expect(byId["t.b"]).toMatchObject({ status: "fail", detector: "manual" });
    expect(byId["t.c"]).toMatchObject({ status: "pass", detector: "rule", summary: "auto pass — Editor: looks fine" });
    expect(report.letter.items.map((i) => i.text)).toEqual(["* B"]);
    expect(report.summary.fail).toBe(1);
  });

  it("fills report metadata and stats", async () => {
    const model = makeModel({ sourceType: "pdf", wordCount: 123, pageCount: 4, references: { style: "numbered", count: 36, entries: [], inTextStyle: "unknown", separateSupplementalList: false } });
    const now = new Date("2026-10-09T10:00:00Z");
    const report = await runFormatChecks(model, profile([base({})]), { now });
    expect(report).toMatchObject({ profileId: "test", profileVersion: "1", checkedAt: now.toISOString(), stats: { wordCount: 123, pageCount: 4, referenceCount: 36, figureLegendCount: 0, sourceType: "pdf" } });
    expect(report.letter.text.startsWith("Preamble:")).toBe(true);
  });
});
