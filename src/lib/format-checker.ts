import type { FormatRule, FormatIssue } from "@/types";
import type { PDFContent } from "./pdf-parser";
import { extractSections, countReferences } from "./pdf-parser";

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

/**
 * Check PDF content against format guidelines
 */
export function checkFormat(
  content: PDFContent,
  guidelines: FormatGuidelines = defaultGuidelines
): FormatCheckResult {
  const issues: FormatIssue[] = [];
  const sections = extractSections(content.text);
  const referenceCount = countReferences(content.text);
  const sectionsFound = Array.from(sections.keys());

  // Check word count
  if (guidelines.minWordCount && content.wordCount < guidelines.minWordCount) {
    issues.push({
      ruleId: "min-word-count",
      ruleName: "Minimum Word Count",
      severity: "error",
      message: `Paper has ${content.wordCount} words, but minimum is ${guidelines.minWordCount}`,
    });
  }

  if (guidelines.maxWordCount && content.wordCount > guidelines.maxWordCount) {
    issues.push({
      ruleId: "max-word-count",
      ruleName: "Maximum Word Count",
      severity: "error",
      message: `Paper has ${content.wordCount} words, but maximum is ${guidelines.maxWordCount}`,
    });
  }

  // Check page count
  if (guidelines.minPages && content.numPages < guidelines.minPages) {
    issues.push({
      ruleId: "min-pages",
      ruleName: "Minimum Pages",
      severity: "error",
      message: `Paper has ${content.numPages} pages, but minimum is ${guidelines.minPages}`,
    });
  }

  if (guidelines.maxPages && content.numPages > guidelines.maxPages) {
    issues.push({
      ruleId: "max-pages",
      ruleName: "Maximum Pages",
      severity: "error",
      message: `Paper has ${content.numPages} pages, but maximum is ${guidelines.maxPages}`,
    });
  }

  // Check required sections
  if (guidelines.requiredSections) {
    for (const required of guidelines.requiredSections) {
      const found = sectionsFound.some(
        (s) => s.toLowerCase().includes(required.toLowerCase())
      );
      if (!found) {
        issues.push({
          ruleId: "required-section",
          ruleName: "Required Section",
          severity: "warning",
          message: `Missing required section: ${required}`,
          location: { section: required },
        });
      }
    }
  }

  // Check references
  if (guidelines.minReferences && referenceCount < guidelines.minReferences) {
    issues.push({
      ruleId: "min-references",
      ruleName: "Minimum References",
      severity: "warning",
      message: `Paper has ${referenceCount} references, but minimum is ${guidelines.minReferences}`,
    });
  }

  // Check abstract length
  const abstractSection = sections.get("abstract");
  if (abstractSection && guidelines.maxAbstractWords) {
    const abstractWords = abstractSection.split(/\s+/).filter(Boolean).length;
    if (abstractWords > guidelines.maxAbstractWords) {
      issues.push({
        ruleId: "abstract-length",
        ruleName: "Abstract Length",
        severity: "warning",
        message: `Abstract has ${abstractWords} words, but maximum is ${guidelines.maxAbstractWords}`,
        location: { section: "abstract" },
      });
    }
  }

  // Apply custom rules
  if (guidelines.rules) {
    for (const rule of guidelines.rules) {
      const ruleIssue = applyCustomRule(rule, content, sections);
      if (ruleIssue) {
        issues.push(ruleIssue);
      }
    }
  }

  return {
    passed: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    stats: {
      wordCount: content.wordCount,
      pageCount: content.numPages,
      referenceCount,
      sectionsFound,
    },
  };
}

/**
 * Apply a custom format rule
 */
function applyCustomRule(
  rule: FormatRule,
  content: PDFContent,
  sections: Map<string, string>
): FormatIssue | null {
  const config = rule.config as Record<string, unknown>;

  switch (rule.type) {
    case "section": {
      const sectionName = config.name as string;
      const sectionExists = Array.from(sections.keys()).some(
        (s) => s.toLowerCase().includes(sectionName.toLowerCase())
      );
      if (!sectionExists) {
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: `Missing section: ${sectionName}`,
          location: { section: sectionName },
        };
      }
      break;
    }

    case "length": {
      const min = config.min as number | undefined;
      const max = config.max as number | undefined;
      const target = config.target as string;

      if (target === "wordCount") {
        if (min && content.wordCount < min) {
          return {
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            message: `Word count ${content.wordCount} is below minimum ${min}`,
          };
        }
        if (max && content.wordCount > max) {
          return {
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            message: `Word count ${content.wordCount} exceeds maximum ${max}`,
          };
        }
      }
      break;
    }

    case "metadata": {
      const required = config.required as string[];
      for (const field of required) {
        if (!content.info[field as keyof typeof content.info]) {
          return {
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            message: `Missing PDF metadata: ${field}`,
          };
        }
      }
      break;
    }
  }

  return null;
}
