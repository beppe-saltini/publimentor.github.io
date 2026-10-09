/**
 * Pure helpers for the "Formatted manuscript" panel: reading the `formatting`
 * block defensively, grouping operations by kind, labelling kinds and
 * building download URLs. No React so everything is unit-testable.
 */

import type {
  FormatAuthorAction,
  FormatOperation,
  FormatOperationKind,
  FormattingBlock,
  FormattingDownloads,
  FormattingLetter,
  FormattingSummary,
} from "./types";

/** Display order and labels for operation kinds. Unknown kinds go last. */
export const OPERATION_KIND_ORDER: readonly string[] = [
  "rename_heading",
  "move_block",
  "merge_sections",
  "split_summary",
  "insert_section",
  "insert_placeholder",
  "prefill_krt",
  "collect_legends",
  "retitle_legend",
  "retitle_supplemental",
  "add_see_also",
  "convert_citations",
  "rewrite_reference",
  "add_doi",
  "note",
];

export const OPERATION_KIND_LABELS: Record<string, string> = {
  rename_heading: "Renamed headings",
  move_block: "Moved content",
  merge_sections: "Merged sections",
  split_summary: "Split summary",
  insert_section: "Inserted sections",
  insert_placeholder: "Inserted placeholders",
  prefill_krt: "Key Resources Table",
  collect_legends: "Collected figure legends",
  retitle_legend: "Retitled figure legends",
  retitle_supplemental: "Retitled supplemental items",
  add_see_also: "Added cross-references",
  convert_citations: "Converted citations",
  rewrite_reference: "Rewritten references",
  add_doi: "Added DOIs",
  note: "Notes",
};

export function operationKindLabel(kind: FormatOperationKind): string {
  if (OPERATION_KIND_LABELS[kind]) return OPERATION_KIND_LABELS[kind];
  // A kind the UI does not know yet (engine ahead of the UI) gets a readable fallback.
  return kind.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export interface OperationGroup {
  kind: FormatOperationKind;
  label: string;
  operations: FormatOperation[];
  automatic: number;
  needsAuthor: number;
}

/** Group operations by kind in OPERATION_KIND_ORDER, keeping each group's
 * operations in plan order (the order the engine applied them). */
export function groupOperations(operations: FormatOperation[] | undefined): OperationGroup[] {
  const groups = new Map<string, OperationGroup>();
  for (const op of operations ?? []) {
    let group = groups.get(op.kind);
    if (!group) {
      group = { kind: op.kind, label: operationKindLabel(op.kind), operations: [], automatic: 0, needsAuthor: 0 };
      groups.set(op.kind, group);
    }
    group.operations.push(op);
    if (op.automatic) group.automatic += 1;
    else group.needsAuthor += 1;
  }
  const rank = (kind: string) => {
    const i = OPERATION_KIND_ORDER.indexOf(kind);
    return i === -1 ? OPERATION_KIND_ORDER.length : i;
  };
  return [...groups.values()].sort((a, b) => rank(a.kind) - rank(b.kind));
}

/** Shorten a before/after snippet for display, preserving the start. */
export function clipSnippet(text: string | undefined, maxLength = 220): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1).trimEnd()}…` : flat;
}

/**
 * Add `format=docx|txt` to a letter download URL, whether or not it already
 * carries a query string ("/file?kind=letter" -> "&format=", "/letter" -> "?format=").
 * An existing `format` parameter is replaced.
 */
export function letterFileHref(baseHref: string, format: "docx" | "txt"): string {
  const [path, query = ""] = baseHref.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("format", format);
  return `${path}?${params.toString()}`;
}

/** Plural-aware "N changes applied automatically" style labels for the chips. */
export function summaryChipLabels(summary: FormattingSummary): { automatic: string; needsAuthor: string; references: string } {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  return {
    automatic: `${summary.automatic} ${plural(summary.automatic, "change", "changes")} applied automatically`,
    needsAuthor: `${summary.needsAuthor} ${plural(summary.needsAuthor, "item", "items")} for the authors`,
    references: `References matched ${summary.referencesMatched}/${summary.referencesTotal}`,
  };
}

// ------------------------------------------------------------------
// Defensive parsing of the API payload
// ------------------------------------------------------------------

const asNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

function parseAuthorAction(value: unknown): FormatAuthorAction | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const text = asString(raw.text).trim();
  if (!text) return null;
  const checkIds = Array.isArray(raw.checkIds) ? raw.checkIds.filter((c): c is string => typeof c === "string") : undefined;
  return { text, checkIds, origin: raw.origin === "check" ? "check" : "plan" };
}

function parseOperation(value: unknown, index: number): FormatOperation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const description = asString(raw.description);
  const kind = asString(raw.kind) || "note";
  if (!description && !kind) return null;
  return {
    id: asString(raw.id) || `op-${index + 1}`,
    kind,
    automatic: raw.automatic !== false,
    description,
    before: typeof raw.before === "string" ? raw.before : undefined,
    after: typeof raw.after === "string" ? raw.after : undefined,
    slotId: typeof raw.slotId === "string" ? raw.slotId : undefined,
    needsAuthorInput: typeof raw.needsAuthorInput === "string" ? raw.needsAuthorInput : undefined,
    checkIds: Array.isArray(raw.checkIds) ? raw.checkIds.filter((c): c is string => typeof c === "string") : undefined,
  };
}

/**
 * Normalise a `formatting` block from the API. Accepts either the block
 * itself or a wrapper `{ formatting: block }` (the rebuild route may return
 * either), tolerates missing arrays and returns null when the payload has no
 * downloads, which is the one field the panel cannot work without.
 */
export function normalizeFormatting(payload: unknown): FormattingBlock | null {
  if (!payload || typeof payload !== "object") return null;
  const wrapper = payload as { formatting?: unknown };
  const source = (wrapper.formatting && typeof wrapper.formatting === "object" ? wrapper.formatting : payload) as Record<string, unknown>;

  const downloadsRaw = source.downloads;
  if (!downloadsRaw || typeof downloadsRaw !== "object") return null;
  const d = downloadsRaw as Record<string, unknown>;
  const formatted = asString(d.formatted);
  if (!formatted) return null;
  const downloads: FormattingDownloads = {
    formatted,
    tracked: asString(d.tracked) || undefined,
    changeLog: asString(d.changeLog),
    letter: asString(d.letter),
  };

  const operations = Array.isArray(source.operations)
    ? source.operations.map(parseOperation).filter((op): op is FormatOperation => op !== null)
    : [];
  const authorActions = Array.isArray(source.authorActions)
    ? source.authorActions.map(parseAuthorAction).filter((a): a is FormatAuthorAction => a !== null)
    : [];

  const s = (source.summary && typeof source.summary === "object" ? source.summary : {}) as Record<string, unknown>;
  const summary: FormattingSummary = {
    automatic: s.automatic !== undefined ? asNumber(s.automatic) : operations.filter((op) => op.automatic).length,
    needsAuthor: s.needsAuthor !== undefined ? asNumber(s.needsAuthor) : authorActions.length,
    referencesMatched: asNumber(s.referencesMatched),
    referencesTotal: asNumber(s.referencesTotal),
  };

  const l = (source.letter && typeof source.letter === "object" ? source.letter : {}) as Record<string, unknown>;
  const letterItems = Array.isArray(l.items)
    ? l.items.map(parseAuthorAction).filter((a): a is FormatAuthorAction => a !== null)
    : authorActions;
  const letter: FormattingLetter = {
    preamble: asString(l.preamble),
    items: letterItems,
    closing: asString(l.closing),
    text: asString(l.text),
  };

  const notes = Array.isArray(source.notes)
    ? source.notes.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    : [];

  return { summary, operations, authorActions, letter, downloads, ...(notes.length ? { notes } : {}) };
}
