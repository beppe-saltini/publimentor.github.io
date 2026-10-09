/**
 * Synthetic fixtures shared by the format API tests. Nothing here is derived
 * from a real manuscript.
 */

import type { FormatCheckReport as FormatCheckReportRow } from "@prisma/client";
import type { CheckResult, FormatCheckReport, FormatPlan, JournalProfile, ManuscriptModel } from "../_lib/format-lib";
import type { ComposedLetter } from "../_lib/run-format";

export const USER_ID = "cuser000000000000000000001";
export const OTHER_USER_ID = "cuser000000000000000000002";
export const MANUSCRIPT_ID = "cmanu000000000000000000001";
export const JOURNAL_ID = "cjour000000000000000000001";
export const REPORT_ID = "crepo000000000000000000001";

export const sampleProfile: JournalProfile = {
  id: "iscience",
  name: "iScience",
  version: "2026-10",
  sourceUrls: ["https://example.test/ffr"],
  letterPreamble: "Dear authors, before we can proceed please address the following:",
  sectionOrder: ["Summary", "Introduction", "Results", "Discussion"],
  checks: [],
};

export const genericProfile: JournalProfile = { ...sampleProfile, id: "generic", name: "Generic", version: "1" };

export const sampleResults: CheckResult[] = [
  {
    checkId: "file-type",
    status: "fail",
    summary: "File is a PDF; the final file must be Word",
    evidence: [{ quote: "manuscript.pdf" }],
    confidence: "high",
    detector: "rule",
    letterPhrase: "Please supply the main text as a Word document.",
  },
  {
    checkId: "title-length",
    status: "pass",
    summary: "Title has 6 words",
    evidence: [],
    confidence: "high",
    detector: "rule",
  },
  {
    checkId: "summary-heading",
    status: "review",
    summary: "Heading is 'Abstract'",
    evidence: [{ quote: "Abstract" }],
    confidence: "medium",
    detector: "llm",
    letterPhrase: "Please rename the Abstract heading to Summary.",
  },
];

export const sampleLetter: FormatCheckReport["letter"] = {
  preamble: sampleProfile.letterPreamble,
  items: [
    { checkId: "file-type", text: "Please supply the main text as a Word document." },
    { checkId: "summary-heading", text: "Please rename the Abstract heading to Summary." },
  ],
  text: `${sampleProfile.letterPreamble}\n\n- Please supply the main text as a Word document.\n- Please rename the Abstract heading to Summary.`,
};

export const sampleReport: FormatCheckReport = {
  profileId: sampleProfile.id,
  profileVersion: sampleProfile.version,
  checkedAt: "2026-10-09T10:00:00.000Z",
  results: sampleResults,
  summary: { pass: 1, fail: 1, review: 1, not_applicable: 0, unknown: 0, total: 3 },
  letter: sampleLetter,
  stats: { wordCount: 5200, pageCount: 40, referenceCount: 61, figureLegendCount: 6, sourceType: "pdf" },
};

/** Only the fields the routes read; cast because the full model is large. */
export const sampleModel = {
  sourceType: "pdf",
  fileName: "manuscript.pdf",
  text: "Synthetic manuscript text",
  pageCount: 40,
  wordCount: 5200,
  title: "Six Word Synthetic Manuscript Title Here",
} as unknown as ManuscriptModel;

export const sampleJournal = {
  id: JOURNAL_ID,
  slug: "iscience",
  name: "iScience",
  formatGuidelines: { rules: { profileId: "iscience" } },
};

export function makeRow(overrides: Partial<FormatCheckReportRow> = {}): FormatCheckReportRow {
  return {
    id: REPORT_ID,
    manuscriptId: null,
    journalId: JOURNAL_ID,
    profileId: sampleProfile.id,
    profileVersion: sampleProfile.version,
    sourceType: "pdf",
    fileName: "manuscript.pdf",
    results: JSON.parse(JSON.stringify(sampleResults)),
    overrides: null,
    letterText: sampleLetter.text,
    stats: JSON.parse(JSON.stringify(sampleReport.stats)),
    checkedById: USER_ID,
    checkedAt: new Date("2026-10-09T10:00:00.000Z"),
    formatPlan: null,
    sourcePath: null,
    formattedPath: null,
    trackedPath: null,
    changeLogText: null,
    formattedAt: null,
    profileOverride: null,
    ...overrides,
  };
}

// ------------------------------------------------------------------
// Journal-Ready Formatter fixtures (synthetic)
// ------------------------------------------------------------------

export const samplePlan: FormatPlan = {
  profileId: "iscience",
  targetStructureVersion: "1.0.0",
  operations: [
    { id: "op-001", kind: "rename_heading", automatic: true, description: 'Renamed "Abstract" to "Summary".', slotId: "summary", before: "Abstract", after: "Summary", checkIds: ["summary-heading"] },
    { id: "op-002", kind: "insert_placeholder", automatic: false, description: "Lead contact missing.", slotId: "lead_contact", needsAuthorInput: "Please name a lead contact." },
  ],
  references: [
    { index: 1, original: "Doe 2021", formatted: "1. Doe, J. (2021). Widgets. Nat. Widget 1, 1-2. https://doi.org/10.1000/w1", doi: "10.1000/w1", matched: true, confidence: 0.95, source: "crossref", fields: { authors: [{ family: "Doe", given: "J." }], year: 2021 } },
    { index: 2, original: "Roe 2020", formatted: "Roe 2020", matched: false, confidence: 0, source: "unmatched", fields: { authors: [] } },
  ],
  authorActions: [{ slotId: "lead_contact", text: "Please name a lead contact." }],
  stats: { automatic: 1, needsAuthor: 1 },
  layout: { titlePage: { affiliations: [], correspondingEmails: [], placeholders: [] }, slots: [] },
};

export const sampleComposedLetter: ComposedLetter = {
  preamble: sampleProfile.letterPreamble,
  items: [
    { text: "Please name a lead contact.", origin: "plan" },
    { text: "Please supply the main text as a Word document.", checkIds: ["file-type"], origin: "check" },
  ],
  closing: "For your convenience we have already renamed and reordered the sections; please review these changes in the attached document.",
  text: `${sampleProfile.letterPreamble}

* Please name a lead contact.

* Please supply the main text as a Word document.

For your convenience we have already renamed and reordered the sections; please review these changes in the attached document.
`,
};

export const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** What a mocked formatManuscript resolves to. */
export function sampleFormatResult(options: { tracked?: boolean } = {}) {
  return {
    plan: samplePlan,
    rebuilt: { kind: "rebuilt" as const, buffer: Buffer.from("PK\u0003\u0004formatted"), fileName: "formatted.docx", contentType: DOCX_MIME_TYPE },
    ...(options.tracked
      ? { tracked: { kind: "tracked" as const, buffer: Buffer.from("PK\u0003\u0004tracked"), fileName: "tracked.docx", contentType: DOCX_MIME_TYPE } }
      : {}),
    changeLog: "# Formatting change log\n\n1 change(s) applied automatically; 1 item(s) need the authors.\n",
    letter: sampleComposedLetter,
    summary: { automatic: 1, needsAuthor: 1, referencesMatched: 1, referencesTotal: 2 },
  };
}

/** A row that has been formatted (plan stored without its layout). */
export function makeFormattedRow(overrides: Partial<FormatCheckReportRow> = {}): FormatCheckReportRow {
  const { layout: _layout, ...storedPlan } = samplePlan;
  void _layout;
  return makeRow({
    formatPlan: JSON.parse(JSON.stringify(storedPlan)),
    sourcePath: `format-reports/${REPORT_ID}/source.docx`,
    sourceType: "docx",
    fileName: "manuscript.docx",
    formattedPath: `format-reports/${REPORT_ID}/formatted.docx`,
    trackedPath: `format-reports/${REPORT_ID}/tracked.docx`,
    changeLogText: "# Formatting change log\n",
    formattedAt: new Date("2026-10-09T10:05:00.000Z"),
    letterText: sampleComposedLetter.text,
    ...overrides,
  });
}

// ------------------------------------------------------------------
// Request builders
// ------------------------------------------------------------------

export const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
export const DOCX_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 1)]);

export function makeFile(name: string, bytes: Buffer | Uint8Array, type = ""): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, type ? { type } : undefined);
}

export function multipartRequest(fields: Record<string, string | File | undefined>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    form.append(key, value);
  }
  return new Request("http://localhost/api/format/check", { method: "POST", body: form });
}

export function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}
