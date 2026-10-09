/**
 * Synthetic fixtures for the format-check UI tests. Nothing here is derived
 * from a real manuscript; the check ids and phrases are invented to exercise
 * grouping, overrides and letter assembly.
 */

import type {
  CheckDefinition,
  CheckRunResponse,
  FormatCheckReport,
  FormattingBlock,
  ProfileInfo,
  ProfileListItem,
} from "../types";

export const SAMPLE_CHECKS: CheckDefinition[] = [
  {
    id: "file.word",
    category: "file",
    question: "Is the main manuscript file a PDF?",
    severity: "required",
    phrase: "* Please provide the main document as a modifiable Word file.",
  },
  {
    id: "summary.length",
    category: "summary",
    question: "Is the Summary longer than 150 words?",
    severity: "required",
    phrase: "* Please shorten the Summary to 150 words or fewer.",
  },
  {
    id: "references.doi",
    category: "references",
    question: "Are DOIs missing from the reference list?",
    severity: "required",
    phrase: "* Please add DOIs to all references.",
  },
  {
    id: "statements.limitations",
    category: "statements",
    question: "Is a Limitations of the study section missing?",
    severity: "recommended",
    phrase: "* Please add a Limitations of the study paragraph at the end of the Discussion.",
  },
];

export const SAMPLE_PROFILE: ProfileInfo = {
  id: "sample-journal",
  name: "Sample Journal",
  version: "2026.1",
  checks: SAMPLE_CHECKS,
};

export const SAMPLE_PREAMBLE = "Dear Dr Example, congratulations on the acceptance of your manuscript.";

export const SAMPLE_REPORT: FormatCheckReport = {
  profileId: "sample-journal",
  profileVersion: "2026.1",
  checkedAt: "2026-10-01T10:00:00.000Z",
  results: [
    {
      checkId: "statements.limitations",
      status: "review",
      summary: "No heading containing 'Limitations' was found.",
      evidence: [],
      confidence: "medium",
      detector: "llm",
    },
    {
      checkId: "file.word",
      status: "fail",
      summary: "The uploaded file is a PDF.",
      evidence: [{ quote: "sample-manuscript.pdf", location: "file name" }],
      confidence: "high",
      detector: "rule",
      letterPhrase: "Please provide the main document as a modifiable Word file.",
    },
    {
      checkId: "summary.length",
      status: "pass",
      summary: "Summary has 141 words.",
      evidence: [{ quote: "The first 141 words...", location: "Summary" }],
      confidence: "high",
      detector: "rule",
    },
    {
      checkId: "references.doi",
      status: "fail",
      summary: "0 of 42 references carry a DOI.",
      evidence: [{ quote: "1. Doe, J. et al. A title. J. Sci. 1, 1-2 (2020).", location: "References" }],
      confidence: "high",
      detector: "rule",
    },
  ],
  summary: { total: 4, pass: 1, fail: 2, review: 1, not_applicable: 0, unknown: 0 },
  letter: {
    preamble: SAMPLE_PREAMBLE,
    items: [
      { checkId: "file.word", text: "Please provide the main document as a modifiable Word file." },
      { checkId: "references.doi", text: "Please add DOIs to all references." },
    ],
    text: `${SAMPLE_PREAMBLE}\n\n* Please provide the main document as a modifiable Word file.\n\n* Please add DOIs to all references.`,
  },
  stats: { wordCount: 5200, pageCount: 12, referenceCount: 42, figureLegendCount: 5, sourceType: "pdf" },
};

export const SAMPLE_RUN_RESPONSE: CheckRunResponse = {
  reportId: "rep_123",
  report: SAMPLE_REPORT,
  manuscript: { title: "A synthetic manuscript", wordCount: 5200, pageCount: 12, sourceType: "pdf", fileName: "sample-manuscript.pdf" },
  profile: SAMPLE_PROFILE,
};

/** GET /api/format/profiles. */
export const SAMPLE_PROFILES: ProfileListItem[] = [
  { id: "sample-journal", name: "Sample Journal", version: "2026.1", family: "sample-press" },
  { id: "other-journal", name: "Other Journal", version: "3.0" },
];

/** Formatting block for a PDF source: no tracked-changes file. */
export const SAMPLE_FORMATTING: FormattingBlock = {
  summary: { automatic: 3, needsAuthor: 2, referencesMatched: 40, referencesTotal: 42 },
  operations: [
    {
      id: "op-001",
      kind: "rename_heading",
      automatic: true,
      description: 'Renamed "Abstract" to "Summary".',
      slotId: "summary",
      before: "Abstract",
      after: "Summary",
    },
    {
      id: "op-002",
      kind: "rename_heading",
      automatic: true,
      description: 'Renamed "Acknowledgements" to "Acknowledgments".',
      before: "Acknowledgements",
      after: "Acknowledgments",
    },
    {
      id: "op-003",
      kind: "insert_section",
      automatic: false,
      description: 'Inserted the missing "Limitations of the study" section with a placeholder.',
      slotId: "limitations",
      after: "[Limitations of the study: a paragraph highlighting the potential caveats of the work.]",
      needsAuthorInput: "Please add a Limitations of the study paragraph at the end of the Discussion.",
      checkIds: ["statements.limitations"],
    },
    {
      id: "op-004",
      kind: "add_doi",
      automatic: true,
      description: "Added DOIs to 40 references from Crossref.",
    },
  ],
  authorActions: [
    { text: "Please add a Limitations of the study paragraph at the end of the Discussion.", checkIds: ["statements.limitations"], origin: "plan" },
    { text: "Please provide the main document as a modifiable Word file.", checkIds: ["file.word"], origin: "check" },
  ],
  letter: {
    preamble: SAMPLE_PREAMBLE,
    items: [
      { text: "Please add a Limitations of the study paragraph at the end of the Discussion.", checkIds: ["statements.limitations"], origin: "plan" },
      { text: "Please provide the main document as a modifiable Word file.", checkIds: ["file.word"], origin: "check" },
    ],
    closing: "For your convenience we have already renamed the headings and added DOIs to 40 references.",
    text: `${SAMPLE_PREAMBLE}\n\n* Please add a Limitations of the study paragraph at the end of the Discussion.\n\n* Please provide the main document as a modifiable Word file.\n\nFor your convenience we have already renamed the headings and added DOIs to 40 references.`,
  },
  downloads: {
    formatted: "/api/format/reports/rep_123/file?kind=formatted",
    changeLog: "/api/format/reports/rep_123/file?kind=change-log",
    letter: "/api/format/reports/rep_123/file?kind=letter",
  },
};

/** Formatting block for a Word source: the tracked-changes file is present. */
export const SAMPLE_FORMATTING_DOCX: FormattingBlock = {
  ...SAMPLE_FORMATTING,
  downloads: { ...SAMPLE_FORMATTING.downloads, tracked: "/api/format/reports/rep_123/file?kind=tracked" },
};

/** POST /api/format/check with format=true. */
export const SAMPLE_FORMAT_RUN_RESPONSE: CheckRunResponse = {
  ...SAMPLE_RUN_RESPONSE,
  formatting: SAMPLE_FORMATTING,
};

/** Build a Response carrying JSON, as the API routes do. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
