/**
 * Client-side types for the pre-accept format check UI.
 *
 * These mirror the server contract (src/lib/format/profile.ts and the
 * /api/format/* routes) without importing from it: the UI is bundled for the
 * browser and must stay tolerant of partial payloads while the backend
 * evolves. Every field that the API is not guaranteed to send is optional.
 */

export type CheckStatus = "pass" | "fail" | "review" | "not_applicable" | "unknown";

/** Statuses an editor can pick in the segmented control, in display order. */
export const EDITABLE_STATUSES: readonly CheckStatus[] = ["pass", "fail", "review", "not_applicable"];

export const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  review: "Review",
  not_applicable: "N/A",
  unknown: "Unknown",
};

export interface TextSpan {
  start: number;
  end: number;
}

export interface CheckEvidence {
  quote: string;
  location?: string;
  span?: TextSpan;
}

export type CheckDetector = "rule" | "llm" | "manual";
export type CheckConfidence = "high" | "medium" | "low";

/** One evaluated check, as returned inside FormatCheckReport.results. */
export interface CheckResult {
  checkId: string;
  status: CheckStatus;
  summary: string;
  evidence?: CheckEvidence[];
  confidence?: CheckConfidence;
  detector?: CheckDetector;
  /** Author-facing sentence that goes in the letter when the check fails. */
  letterPhrase?: string;
}

/**
 * Static description of a check from the journal profile. The API may send
 * the catalog as `profile.checks`; when it does not, the UI falls back to the
 * data carried by each CheckResult (summary, letterPhrase) and derives the
 * category from the check id.
 */
export interface CheckDefinition {
  id: string;
  category: string;
  /** Editor-facing yes/no question, e.g. "Is the main manuscript file a pdf?" */
  question: string;
  guideline?: string;
  severity?: "required" | "recommended" | "info";
  /** Author-facing letter text used when the check fails. */
  phrase?: string;
  sourceRef?: string;
}

export interface CheckOverride {
  status?: CheckStatus;
  note?: string;
}

export type OverrideMap = Record<string, CheckOverride>;

export interface LetterItem {
  checkId: string;
  text: string;
}

export interface FormatCheckReport {
  profileId: string;
  profileVersion: string;
  checkedAt: string;
  results: CheckResult[];
  summary?: Partial<Record<CheckStatus | "total", number>>;
  letter?: {
    preamble?: string;
    items?: LetterItem[];
    text?: string;
  };
  stats?: {
    wordCount?: number;
    pageCount?: number;
    referenceCount?: number;
    figureLegendCount?: number;
    sourceType?: string;
  };
}

export interface ProfileInfo {
  id: string;
  name: string;
  version: string;
  /** Optional check catalog; see CheckDefinition. */
  checks?: CheckDefinition[];
}

export interface ManuscriptInfo {
  title?: string;
  wordCount?: number;
  pageCount?: number;
  sourceType?: string;
  fileName?: string;
}

/** One entry of GET /api/format/profiles: a selectable journal profile. */
export interface ProfileListItem {
  id: string;
  name: string;
  version: string;
  /** Publisher family the profile belongs to (e.g. "cell-press"). */
  family?: string;
}

// ------------------------------------------------------------------
// Formatting (Journal-Ready Formatter engine output)
// ------------------------------------------------------------------

/** Mirrors FormatOperationKind in src/lib/format/formatter/types.ts. Kept as
 * a plain string union so a newer engine can add kinds without breaking the UI. */
export type FormatOperationKind =
  | "rename_heading"
  | "move_block"
  | "insert_section"
  | "merge_sections"
  | "retitle_legend"
  | "collect_legends"
  | "retitle_supplemental"
  | "add_see_also"
  | "rewrite_reference"
  | "add_doi"
  | "convert_citations"
  | "insert_placeholder"
  | "prefill_krt"
  | "split_summary"
  | "note"
  | (string & {});

/** One change the engine made (automatic) or asks the authors to make. */
export interface FormatOperation {
  id: string;
  kind: FormatOperationKind;
  automatic: boolean;
  description: string;
  before?: string;
  after?: string;
  slotId?: string;
  needsAuthorInput?: string;
  checkIds?: string[];
}

/** One "* " item of the composed author letter. */
export interface FormatAuthorAction {
  text: string;
  checkIds?: string[];
  /** "plan": the engine could not finish it; "check": a failing report check. */
  origin: "plan" | "check";
}

export interface FormattingLetter {
  preamble: string;
  items: FormatAuthorAction[];
  closing: string;
  text: string;
}

export interface FormattingSummary {
  automatic: number;
  needsAuthor: number;
  referencesMatched: number;
  referencesTotal: number;
}

/** Download URLs: "/api/format/reports/{id}/file?kind=..."; `tracked` only for Word sources. */
export interface FormattingDownloads {
  formatted: string;
  tracked?: string;
  changeLog: string;
  letter: string;
}

/** The `formatting` block returned by the check routes and the report routes. */
export interface FormattingBlock {
  summary: FormattingSummary;
  operations: FormatOperation[];
  authorActions: FormatAuthorAction[];
  letter: FormattingLetter;
  downloads: FormattingDownloads;
  /** Degradations the editor should know about (e.g. Crossref lookups skipped). */
  notes?: string[];
}

/** Response of POST /api/format/check and POST /api/format/check-manuscript. */
export interface CheckRunResponse {
  reportId: string;
  report: FormatCheckReport;
  manuscript?: ManuscriptInfo;
  profile?: ProfileInfo;
  /** Present when the run was made with format=true (the default). */
  formatting?: FormattingBlock | null;
}

/** Response of GET and PATCH /api/format/reports/[id]. */
export interface SavedReportResponse {
  report: FormatCheckReport;
  overrides?: OverrideMap | null;
  letterText?: string | null;
  manuscript?: ManuscriptInfo | null;
  profile?: ProfileInfo | null;
  /** Present when the report was formatted (at run time or via POST .../format). */
  formatting?: FormattingBlock | null;
  /**
   * False when no source file is stored for the report (older reports), so
   * POST .../format cannot run; the UI then hides "Format now" / "Rebuild".
   * Absent means unknown and is treated as true.
   */
  canFormat?: boolean;
}

/** Whether a run only checks the manuscript or also formats it. */
export type RunMode = "check" | "format";

/** One row of GET /api/format/reports. */
export interface ReportListItem {
  id: string;
  checkedAt: string;
  profileId: string;
  summary?: Partial<Record<CheckStatus | "total", number>>;
}

/** Phases shown while a run is in flight. "uploading" tracks the direct upload
 * of a chosen file (real progress); the check itself is a single request, so
 * the later phases advance on a timer and are indicative, not exact. */
export type RunStage = "idle" | "uploading" | "parsing" | "rules" | "ai" | "formatting" | "done";
