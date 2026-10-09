/**
 * Pure helpers for the format-check UI: grouping results by category,
 * applying editor overrides, counting statuses, assembling the author letter
 * and reading API responses defensively. No React in here so everything is
 * unit-testable in isolation.
 */

import type {
  CheckDefinition,
  CheckResult,
  CheckStatus,
  FormatCheckReport,
  LetterItem,
  OverrideMap,
} from "./types";

/** Category order used when the profile does not dictate one. Mirrors
 * CheckCategory in src/lib/format/profile.ts plus a catch-all "other". */
export const CATEGORY_ORDER: readonly string[] = [
  "file",
  "title_page",
  "summary",
  "body",
  "sections",
  "star_methods",
  "references",
  "figures",
  "tables",
  "supplemental",
  "statements",
  "data_deposition",
  "ethics",
  "associated_files",
  "other",
];

export const CATEGORY_LABELS: Record<string, string> = {
  file: "Main file",
  title_page: "Title page",
  summary: "Summary",
  body: "Main text",
  sections: "Sections and headings",
  star_methods: "STAR Methods",
  references: "References",
  figures: "Figures and legends",
  tables: "Tables",
  supplemental: "Supplemental information",
  statements: "Required statements",
  data_deposition: "Data deposition",
  ethics: "Ethics",
  associated_files: "Associated files",
  other: "Other checks",
};

export function categoryLabel(category: string): string {
  if (CATEGORY_LABELS[category]) return CATEGORY_LABELS[category];
  // Unknown categories (profile extensions) get a readable fallback.
  return category.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Derive a category from a check id such as "references.doi" or
 * "star_methods-krt" when the profile catalog is unavailable.
 */
export function categoryFromCheckId(checkId: string): string {
  const lower = checkId.toLowerCase();
  // Longest keys first so "star_methods" wins over "statements"-like prefixes.
  const known = [...CATEGORY_ORDER].filter((c) => c !== "other").sort((a, b) => b.length - a.length);
  for (const category of known) {
    if (lower === category || lower.startsWith(`${category}.`) || lower.startsWith(`${category}-`) || lower.startsWith(`${category}:`) || lower.startsWith(`${category}/`)) {
      return category;
    }
  }
  return "other";
}

/** Status after the editor's override, if any. */
export function effectiveStatus(result: CheckResult, overrides: OverrideMap | undefined): CheckStatus {
  return overrides?.[result.checkId]?.status ?? result.status;
}

export interface ChecklistRow {
  result: CheckResult;
  definition?: CheckDefinition;
  status: CheckStatus;
  overridden: boolean;
}

export interface ChecklistGroup {
  category: string;
  label: string;
  rows: ChecklistRow[];
}

/**
 * Group results by category. When a catalog is supplied the group and row
 * order follow it (profile order); results with no definition are appended
 * under a derived category. Without a catalog, categories are derived from
 * check ids and ordered by CATEGORY_ORDER.
 */
export function groupResults(
  results: CheckResult[] | undefined,
  checks: CheckDefinition[] | undefined,
  overrides: OverrideMap | undefined,
): ChecklistGroup[] {
  const list = results ?? [];
  const byId = new Map<string, CheckDefinition>();
  for (const def of checks ?? []) byId.set(def.id, def);

  const toRow = (result: CheckResult): ChecklistRow => {
    const status = effectiveStatus(result, overrides);
    return { result, definition: byId.get(result.checkId), status, overridden: status !== result.status };
  };

  // Rows in profile order first, then any results the catalog does not know.
  const resultById = new Map(list.map((r) => [r.checkId, r] as const));
  const ordered: ChecklistRow[] = [];
  const seen = new Set<string>();
  for (const def of checks ?? []) {
    const result = resultById.get(def.id);
    if (!result || seen.has(def.id)) continue;
    seen.add(def.id);
    ordered.push(toRow(result));
  }
  for (const result of list) {
    if (seen.has(result.checkId)) continue;
    seen.add(result.checkId);
    ordered.push(toRow(result));
  }

  const groups = new Map<string, ChecklistGroup>();
  for (const row of ordered) {
    const category = row.definition?.category ?? categoryFromCheckId(row.result.checkId);
    let group = groups.get(category);
    if (!group) {
      group = { category, label: categoryLabel(category), rows: [] };
      groups.set(category, group);
    }
    group.rows.push(row);
  }

  const list2 = [...groups.values()];
  if (checks && checks.length > 0) return list2; // profile order (first appearance)
  const rank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return list2.sort((a, b) => rank(a.category) - rank(b.category));
}

export type StatusCounts = Record<CheckStatus | "total" | "letterItems", number>;

/** Counts after overrides. */
export function summarize(results: CheckResult[] | undefined, overrides: OverrideMap | undefined): StatusCounts {
  const counts: StatusCounts = {
    total: 0,
    pass: 0,
    fail: 0,
    review: 0,
    not_applicable: 0,
    unknown: 0,
    letterItems: 0,
  };
  for (const result of results ?? []) {
    const status = effectiveStatus(result, overrides);
    counts.total += 1;
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === "fail") counts.letterItems += 1;
  }
  return counts;
}

/** Strip a leading bullet so phrases can be re-bulleted consistently. */
export function normalizePhrase(phrase: string): string {
  return phrase.replace(/^\s*[*\-•]\s*/, "").trim();
}

/** The author-facing sentence for a check: profile phrase, then the phrase on
 * the result, then the editor summary as a last resort. */
export function phraseFor(result: CheckResult, definition: CheckDefinition | undefined): string {
  return normalizePhrase(definition?.phrase || result.letterPhrase || result.summary || result.checkId);
}

export interface AssembledLetter {
  preamble: string;
  items: LetterItem[];
  text: string;
}

/**
 * Assemble the letter: preamble followed by one "* " item for every check
 * whose effective status is fail, in checklist (profile) order.
 */
export function assembleLetter(
  report: FormatCheckReport | undefined,
  checks: CheckDefinition[] | undefined,
  overrides: OverrideMap | undefined,
): AssembledLetter {
  const preamble = report?.letter?.preamble ?? "";
  const items: LetterItem[] = [];
  for (const group of groupResults(report?.results, checks, overrides)) {
    for (const row of group.rows) {
      if (row.status !== "fail") continue;
      items.push({ checkId: row.result.checkId, text: phraseFor(row.result, row.definition) });
    }
  }
  const bullets = items.map((item) => `* ${item.text}`).join("\n\n");
  const text = [preamble.trim(), bullets].filter(Boolean).join("\n\n");
  return { preamble, items, text };
}

/**
 * Read a JSON API response safely: verify the status and the content type
 * before parsing so an HTML error page or a redirect does not surface as a
 * cryptic "Unexpected token <" message.
 */
export async function readJsonResponse<T>(response: Response, fallbackMessage = "Request failed"): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.toLowerCase().includes("application/json");
  if (!isJson) {
    const snippet = (await response.text().catch(() => "")).slice(0, 120).replace(/\s+/g, " ");
    throw new Error(
      response.ok
        ? `Unexpected non-JSON response (${response.status})${snippet ? `: ${snippet}` : ""}`
        : `${fallbackMessage} (${response.status})${snippet ? `: ${snippet}` : ""}`,
    );
  }
  const data = (await response.json()) as T & { error?: unknown; message?: unknown };
  if (!response.ok) {
    const message =
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.message === "string" && data.message) ||
      `${fallbackMessage} (${response.status})`;
    throw new Error(message);
  }
  return data;
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** True when the journal/profile is iScience, which only accepts Word files. */
export function requiresWordFile(journalSlug: string | undefined, profileId: string | undefined): boolean {
  const haystack = `${journalSlug ?? ""} ${profileId ?? ""}`.toLowerCase();
  return haystack.includes("iscience");
}

export function fileKind(file: { name: string; type?: string } | null | undefined): "pdf" | "docx" | "unknown" {
  if (!file) return "unknown";
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (
    name.endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return "unknown";
}
