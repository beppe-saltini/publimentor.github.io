/**
 * Legacy compatibility wrapper for the old numeric format checker.
 *
 * The original checkFormat(content, guidelines) compared a parsed PDF against
 * min/max word, page, reference and abstract limits plus a few custom rules.
 * The API routes (src/app/api/format/*) still import it until they are moved to
 * the profile engine (src/lib/format/evaluate.ts). This module keeps the same
 * public contract but expresses the guidelines as a JournalProfile of rule
 * checks and runs them through the new engine's synchronous evaluator, so there
 * is one evaluation path and one place where rule helpers live.
 */

import type { FormatRule, FormatIssue } from "@/types";
import type { PDFContent } from "./pdf-parser";
import { extractSections, countReferences } from "./pdf-parser";
import type { ManuscriptModel } from "./format/manuscript-model";
import { type FormatCheck, type JournalProfile, type RuleOutcome, blankModel, fail, normalizeHeading, pass, wordLimit } from "./format/profile";
import { evaluateRuleChecks } from "./format/evaluate";

export interface FormatGuidelines {
  minWordCount?: number;
  maxWordCount?: number;
  minPages?: number;
  maxPages?: number;
  requiredSections?: string[];
  minReferences?: number;
  maxAbstractWords?: number;
  rules?: FormatRule[];
}

export interface FormatCheckResult {
  passed: boolean;
  issues: FormatIssue[];
  stats: {
    wordCount: number;
    pageCount: number;
    referenceCount: number;
    sectionsFound: string[];
  };
}

// Default guidelines for academic papers
export const defaultGuidelines: FormatGuidelines = {
  minWordCount: 3000,
  maxWordCount: 10000,
  minPages: 4,
  maxPages: 20,
  requiredSections: ["abstract", "introduction", "methods", "results", "discussion", "conclusion", "references"],
  minReferences: 10,
  maxAbstractWords: 300,
};

/** Extra facts the legacy rules need that the ManuscriptModel does not carry. */
interface LegacyContext {
  sections: Map<string, string>;
  referenceCount: number;
  info: PDFContent["info"];
}

/** A minimal ManuscriptModel from the old PDFContent shape. */
export function legacyModelFromPdfContent(content: PDFContent, sections: Map<string, string>): ManuscriptModel {
  const lower = content.text.toLowerCase();
  const outline = Array.from(sections.keys())
    .filter((k) => k !== "preamble")
    .map((k) => {
      const start = Math.max(0, lower.indexOf(k));
      return { text: k, normalized: normalizeHeading(k), level: 1 as const, span: { start, end: start + k.length } };
    });
  const abstract = sections.get("abstract");
  return blankModel({
    sourceType: "pdf",
    text: content.text,
    wordCount: content.wordCount,
    pageCount: content.numPages,
    title: content.info.title,
    outline,
    summary: abstract ? { headingText: "Abstract", text: abstract, wordCount: abstract.split(/\s+/).filter(Boolean).length, paragraphCount: 1, containsCitations: false } : undefined,
  });
}

const sectionExists = (sections: Map<string, string>, name: string) =>
  Array.from(sections.keys()).some((s) => s.toLowerCase().includes(name.toLowerCase()));

const legacyCheck = (id: string, name: string, severity: "error" | "warning", evaluate: (m: ManuscriptModel) => RuleOutcome, section?: string): FormatCheck => ({
  id,
  category: "body",
  question: name,
  guideline: name,
  severity: severity === "error" ? "required" : "recommended",
  detector: { kind: "rule", evaluate },
  // The phrase doubles as the FormatIssue message; the location is smuggled in sourceRef.
  phrase: name,
  sourceRef: section,
});

/** Express the numeric guidelines as a profile of rule checks. */
export function legacyProfile(guidelines: FormatGuidelines, ctx: LegacyContext): JournalProfile {
  const checks: FormatCheck[] = [];
  const g = guidelines;
  if (g.minWordCount) checks.push(legacyCheck("min-word-count", "Minimum Word Count", "error", (m) => (m.wordCount < g.minWordCount! ? fail(`Paper has ${m.wordCount} words, but minimum is ${g.minWordCount}`) : pass("ok"))));
  if (g.maxWordCount) checks.push(legacyCheck("max-word-count", "Maximum Word Count", "error", (m) => (m.wordCount > g.maxWordCount! ? fail(`Paper has ${m.wordCount} words, but maximum is ${g.maxWordCount}`) : pass("ok"))));
  if (g.minPages) checks.push(legacyCheck("min-pages", "Minimum Pages", "error", (m) => ((m.pageCount ?? 0) < g.minPages! ? fail(`Paper has ${m.pageCount} pages, but minimum is ${g.minPages}`) : pass("ok"))));
  if (g.maxPages) checks.push(legacyCheck("max-pages", "Maximum Pages", "error", (m) => ((m.pageCount ?? 0) > g.maxPages! ? fail(`Paper has ${m.pageCount} pages, but maximum is ${g.maxPages}`) : pass("ok"))));
  for (const required of g.requiredSections ?? []) {
    checks.push(legacyCheck(`required-section:${required}`, "Required Section", "warning", () => (sectionExists(ctx.sections, required) ? pass("ok") : fail(`Missing required section: ${required}`)), required));
  }
  if (g.minReferences) checks.push(legacyCheck("min-references", "Minimum References", "warning", () => (ctx.referenceCount < g.minReferences! ? fail(`Paper has ${ctx.referenceCount} references, but minimum is ${g.minReferences}`) : pass("ok"))));
  if (g.maxAbstractWords) {
    checks.push(legacyCheck("abstract-length", "Abstract Length", "warning", (m) => {
      if (!m.summary) return pass("no abstract");
      const r = wordLimit(m.summary.text, g.maxAbstractWords!, "Abstract");
      return r.status === "fail" ? fail(`Abstract has ${m.summary.wordCount} words, but maximum is ${g.maxAbstractWords}`) : pass("ok");
    }, "abstract"));
  }
  for (const rule of g.rules ?? []) checks.push(customRuleCheck(rule, ctx));
  return { id: "legacy", name: "Legacy guidelines", version: "1", sourceUrls: [], letterPreamble: "", sectionOrder: [], checks };
}

function customRuleCheck(rule: FormatRule, ctx: LegacyContext): FormatCheck {
  const config = rule.config as Record<string, unknown>;
  const evaluate = (m: ManuscriptModel): RuleOutcome => {
    switch (rule.type) {
      case "section": {
        const name = config.name as string;
        return sectionExists(ctx.sections, name) ? pass("ok") : fail(`Missing section: ${name}`);
      }
      case "length": {
        const min = config.min as number | undefined;
        const max = config.max as number | undefined;
        if (config.target !== "wordCount") return pass("ok");
        if (min && m.wordCount < min) return fail(`Word count ${m.wordCount} is below minimum ${min}`);
        if (max && m.wordCount > max) return fail(`Word count ${m.wordCount} exceeds maximum ${max}`);
        return pass("ok");
      }
      case "metadata": {
        for (const field of (config.required as string[]) ?? []) {
          if (!ctx.info[field as keyof PDFContent["info"]]) return fail(`Missing PDF metadata: ${field}`);
        }
        return pass("ok");
      }
      default:
        return pass("ok");
    }
  };
  return legacyCheck(rule.id, rule.name, rule.severity, evaluate, rule.type === "section" ? (config.name as string) : undefined);
}

/**
 * Check PDF content against format guidelines (legacy contract).
 */
export function checkFormat(content: PDFContent, guidelines: FormatGuidelines = defaultGuidelines): FormatCheckResult {
  const sections = extractSections(content.text);
  const referenceCount = countReferences(content.text);
  const ctx: LegacyContext = { sections, referenceCount, info: content.info };
  const profile = legacyProfile(guidelines, ctx);
  const model = legacyModelFromPdfContent(content, sections);
  const { results } = evaluateRuleChecks(model, profile);
  const byId = new Map(profile.checks.map((c) => [c.id, c]));

  const issues: FormatIssue[] = results
    .filter((r) => r.status === "fail")
    .map((r) => {
      const check = byId.get(r.checkId)!;
      return {
        ruleId: r.checkId.replace(/^required-section:.*$/, "required-section"),
        ruleName: check.question,
        severity: check.severity === "required" ? "error" : "warning",
        message: r.summary,
        ...(check.sourceRef ? { location: { section: check.sourceRef } } : {}),
      };
    });

  return {
    passed: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    stats: {
      wordCount: content.wordCount,
      pageCount: content.numPages,
      referenceCount,
      sectionsFound: Array.from(sections.keys()),
    },
  };
}
