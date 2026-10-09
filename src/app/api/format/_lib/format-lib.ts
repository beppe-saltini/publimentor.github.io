/**
 * Single import point for the format-check library (src/lib/format/*).
 *
 * The API routes import the parser, evaluator, letter builder and journal
 * profiles exclusively through this module so that route tests can replace
 * the whole library with `vi.mock("../_lib/format-lib")` and stay independent
 * of the parser internals (and of whether the heavy PDF/DOCX dependencies are
 * loadable in the test runner).
 */

export { buildManuscriptModel } from "@/lib/format/manuscript-model";
export type { ManuscriptModel } from "@/lib/format/manuscript-model";

export { runFormatChecks } from "@/lib/format/evaluate";

export { buildLetter, letterToDocx } from "@/lib/format/letter";

export { profiles, resolveProfile } from "@/lib/format/profiles";

// Journal-Ready Formatter engine (orchestrator contract; see formatter/index.ts).
export { formatManuscript, composeAuthorLetter } from "@/lib/format/formatter";
export type { FormatOperation, FormatPlan, FormattedDocument } from "@/lib/format/formatter";

export type {
  CheckResult,
  CheckStatus,
  FormatCheckReport,
  JournalProfile,
} from "@/lib/format/profile";
