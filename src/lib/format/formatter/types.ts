/**
 * Shared contract for the Journal-Ready Formatter engine.
 *
 * Everything journal-specific lives in a `TargetStructure` (see
 * ./target-structures/*). The planner diffs a parsed `ManuscriptModel`
 * against a target and emits a `FormatPlan`: an ordered list of concrete
 * operations (what changed, before/after) plus the list of things only the
 * authors can supply. Renderers (render-docx, apply-docx) turn a plan into a
 * Word file; change-log turns it into human-readable text.
 *
 * This file is imported by both the engine and the apply/tracked-changes
 * agent, so keep it dependency-free and additive.
 */

/** One heading slot in the target manuscript skeleton. */
export interface TargetSlot {
  /** Stable id used by operations and author actions (e.g. "summary"). */
  id: string;
  /** Exact heading text the journal expects. */
  heading: string;
  /** Word heading level the slot is rendered at. */
  level: 1 | 2;
  /**
   * Normalized (lower-case, punctuation-free) source headings that map to
   * this slot, e.g. ["abstract"] for Summary.
   */
  aliases: string[];
  /** When true a missing slot is inserted with `placeholderTemplate`. */
  required: boolean;
  /**
   * Text rendered when the manuscript has no content for the slot. Square
   * bracket tokens such as "[NAME]" mark what the authors must fill in.
   */
  placeholderTemplate?: string;
  /** Nested sub-slots rendered in order under this heading. */
  children?: TargetSlot[];
  /** Semantic kind, lets the planner/renderer pick special handling. */
  kind?:
    | "title_page"
    | "summary"
    | "body"
    | "statement"
    | "legends"
    | "tables"
    | "methods"
    | "supplemental_titles"
    | "references"
    | "krt";
}

/** Journal-specific formatting spec; one per journal (or family). */
export interface TargetStructure {
  profileId: string;
  fileFormat: "docx";
  /** Top-level slots in the order the journal requires. */
  slots: TargetSlot[];
  /** normalized source heading -> target heading text. */
  headingRenames: Record<string, string>;
  legendTitle: {
    /** e.g. "Figure {n}. {title}" */
    template: string;
    label: "Figure" | "Fig.";
    separator: ". " | " | ";
  };
  supplementalTitle: {
    figure: string;
    table: string;
    video: string;
    data: string;
    scheme: string;
    /** e.g. ", Related to {related}" appended to the title. */
    relatedToTemplate: string;
  };
  references: {
    style: "cell-press" | "vancouver" | "apa" | "nature";
    citationStyle: "superscript-numeric" | "bracketed-numeric" | "author-year";
    /** List all authors up to this count, then truncate with "et al.". */
    etAlAfter: number;
    includeDoi: boolean;
    /** Render DOI as https://doi.org/... (true) or bare 10.x (false). */
    doiAsUrl: boolean;
  };
  summary: { heading: string; maxWords: number; singleParagraph: boolean };
  title: { maxChars: number; maxWords?: number; noPunctuation: boolean };
  highlights?: { count: [number, number]; maxChars: number };
  placeholderStyle: { prefix: string; highlight: "yellow" };
  /** Key Resources Table skeleton (Cell Press STAR Methods). */
  krtTemplate?: { headings: string[]; rowGroups?: string[] };
  /**
   * Journal letter phrases keyed by topic (slot id or check topic). The
   * planner uses them verbatim for author actions so the letter reads like
   * the editorial office's own wording.
   */
  letterPhrases?: Record<string, string>;
}

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
  | "note";

/** One concrete change the formatter made (or asks the authors to make). */
export interface FormatOperation {
  id: string;
  kind: FormatOperationKind;
  /** true: done by the engine; false: only the authors can complete it. */
  automatic: boolean;
  description: string;
  before?: string;
  after?: string;
  slotId?: string;
  /** Character span in the source model text the operation refers to. */
  span?: { start: number; end: number };
  /** Letter-ready sentence when the authors must act. */
  needsAuthorInput?: string;
  /** Ids of profile checks (FormatCheckReport) this operation addresses. */
  checkIds?: string[];
  /**
   * Letter/check topic key, the same vocabulary as TargetStructure.letterPhrases
   * ("lead_contact_footnote", "legend_asterisks", ...). check-links.ts maps it
   * to the profile check ids; it defaults to the slot id when absent.
   */
  topic?: string;
}

export interface RepairedReference {
  /** 1-based position in the reference list. */
  index: number;
  original: string;
  /** Reference rendered in the target style (original text if unmatched). */
  formatted: string;
  doi?: string;
  matched: boolean;
  confidence: number;
  /** Where the metadata came from ("crossref", "crossref-doi", "parsed"). */
  source?: string;
  fields: {
    authors: Array<{ family: string; given?: string }>;
    year?: number;
    title?: string;
    journal?: string;
    journalAbbrev?: string;
    volume?: string;
    issue?: string;
    pages?: string;
  };
}

export interface FormatPlan {
  profileId: string;
  targetStructureVersion: string;
  operations: FormatOperation[];
  references: RepairedReference[];
  /** De-duplicated list of what the authors still have to supply. */
  authorActions: Array<{ slotId?: string; text: string; checkIds?: string[] }>;
  stats: { automatic: number; needsAuthor: number };
  /**
   * Fully assembled content tree in target order. Optional so consumers that
   * only need the operations (letter, tracked changes) can ignore it; the
   * docx renderer rebuilds it from (model, target) when absent.
   */
  layout?: FormatLayout;
}

/* ------------------------------------------------------------------ */
/* Layout: the assembled target document, independent of file format. */
/* ------------------------------------------------------------------ */

export type LayoutBlock =
  /** Running text. `style` picks the paragraph look in the renderer. */
  | { type: "paragraph"; text: string; style?: "normal" | "bullet" | "legend_title" | "italic_note" }
  /** Sub-heading inside a slot (level 2 or 3 in Word terms). */
  | { type: "heading"; text: string; level: 2 | 3 }
  /** Text only the authors can finish; rendered highlighted with a prefix. */
  | { type: "placeholder"; text: string }
  /** A real table (e.g. Key Resources Table). `group` rows are subheadings. */
  | { type: "table"; headings: string[]; rows: Array<{ group?: string; cells?: string[] }> }
  /** Marker telling the renderer to emit plan.references as a numbered list. */
  | { type: "references" };

export interface LayoutSlot {
  slotId: string;
  heading: string;
  level: 1 | 2;
  blocks: LayoutBlock[];
  children: LayoutSlot[];
  /** True when the slot had to be created (no source content). */
  inserted: boolean;
}

export interface FormatLayout {
  titlePage: {
    title?: string;
    authorsLine?: string;
    affiliations: string[];
    correspondingEmails: string[];
    /**
     * Lead Contact footnote line added by the engine ("5Lead contact") when
     * the lead contact could be inferred; `authorsLine` then carries the
     * matching marker after that author's name.
     */
    leadContactLine?: string;
    /** Lines that could not be filled automatically (rendered highlighted). */
    placeholders: string[];
  };
  slots: LayoutSlot[];
}

export interface FormattedDocument {
  /** "rebuilt": generated from scratch; "tracked": original with revisions. */
  kind: "rebuilt" | "tracked";
  buffer: Buffer;
  fileName: string;
  contentType: string;
}

/** Version string embedded in every plan so downstream code can detect drift. */
export const TARGET_STRUCTURE_VERSION = "1.0.0";
