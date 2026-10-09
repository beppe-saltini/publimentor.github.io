/**
 * Word-anchored edits for retitling legends and supplemental items.
 *
 * The planner quotes the old title and the new one, often as truncated
 * snippets ("Fig. 3 | Purified widget-derived vesicles elicit gadget-dep…")
 * while the paragraph in Word carries the whole legend. Replacing the quoted
 * text wholesale would mangle the paragraph, so we align the two strings on
 * runs of identical words and change only what differs at the head
 * ("Fig. 3 |" -> "Figure 3.") and, when both strings are complete, at the
 * tail ("." -> ", Related to Figure 1"). The authors' own words in between
 * are never touched.
 */

export interface Edit {
  /** Character offsets in the *current* text. */
  start: number;
  end: number;
  text: string;
}

interface Token {
  norm: string;
  start: number;
  end: number;
}

const ELLIPSIS_RE = /(…|\.\.\.)\s*$/;

/** True when a planner snippet was cut off (ends with an ellipsis). */
export function isTruncated(text: string): boolean {
  return ELLIPSIS_RE.test(text);
}

/**
 * Remove a trailing ellipsis and, when the text was truncated, the partial
 * last word so only complete words remain.
 */
export function stripTruncation(text: string): string {
  if (!isTruncated(text)) return text;
  const stripped = text.replace(ELLIPSIS_RE, "");
  return stripped.replace(/\s*\S*$/, "");
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const norm = m[0].toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (norm !== "") tokens.push({ norm, start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

const ANCHOR = 3;
const MAX_HEAD = 8;

function sameRun(a: Token[], i: number, b: Token[], j: number): boolean {
  for (let k = 0; k < ANCHOR; k++) if (a[i + k]?.norm !== b[j + k]?.norm) return false;
  return true;
}

/**
 * Raw text of an anchor run up to the start of its last token, whitespace
 * collapsed. Comparing this (not just the normalized tokens) rejects anchors
 * such as "1 | Synthetic" vs "1. Synthetic" whose separators differ.
 */
function rawRun(text: string, tokens: Token[], i: number): string {
  return text.slice(tokens[i].start, tokens[i + ANCHOR - 1].start).replace(/\s+/g, " ");
}

export interface AlignedEdits {
  /** Replace current[0, head.end) with head.text (null when the heads agree). */
  head: Edit | null;
  /** Replace the rest of `current` with this text (null when unknown or equal). */
  remainder: Edit | null;
}

/**
 * Align `current` (the text in the document) with `after` (the planner's new
 * text) on the first run of three identical words near both starts, and
 * return the edit for everything before that anchor. When both strings are
 * complete the remainder from the anchor on is compared too, so a changed
 * ending (", Related to Figure 1") is also edited. Returns null when no
 * anchor exists, i.e. the strings are not the same text retitled.
 */
export function alignEdits(current: string, after: string, currentComplete: boolean, afterComplete: boolean): AlignedEdits | null {
  const B = tokenize(current);
  const A = tokenize(after);
  if (B.length < ANCHOR || A.length < ANCHOR) return null;

  let head: { i: number; j: number } | null = null;
  for (let sum = 0; sum <= 2 * MAX_HEAD && !head; sum++) {
    for (let i = 0; i <= Math.min(MAX_HEAD, sum, B.length - ANCHOR) && !head; i++) {
      const j = sum - i;
      if (j > MAX_HEAD || j > A.length - ANCHOR) continue;
      if (sameRun(B, i, A, j) && rawRun(current, B, i) === rawRun(after, A, j)) head = { i, j };
    }
  }
  if (!head) return null;

  const headEnd = B[head.i].start;
  const headAfter = after.slice(0, A[head.j].start);
  const headEdit = current.slice(0, headEnd) === headAfter ? null : { start: 0, end: headEnd, text: headAfter };

  let remainder: Edit | null = null;
  if (currentComplete && afterComplete) {
    const rest = after.slice(A[head.j].start);
    if (current.slice(headEnd) !== rest) remainder = { start: headEnd, end: current.length, text: rest };
  }
  return { head: headEdit, remainder };
}
