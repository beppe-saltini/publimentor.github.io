/**
 * Tracked-change primitives (WordprocessingML revisions).
 *
 * Rules implemented here, from the docx skill:
 *  - every revision is a <w:ins>/<w:del> with unique w:id, w:author, w:date;
 *  - text inside <w:del> uses <w:delText> (and <w:delInstrText>);
 *  - a deleted paragraph mark is <w:pPr><w:rPr><w:del .../></w:rPr></w:pPr>
 *    and must be the first child of that rPr; deleting a whole paragraph is
 *    that marker plus a <w:del> around every run;
 *  - inserted paragraphs carry <w:ins/> on their mark and runs in <w:ins>.
 * Formatting is preserved by cloning the rPr of the run being replaced.
 */
import { acceptChangesIn } from "./inspect";
import { paragraphText, runText, visibleRuns } from "./paragraphs";
import {
  childElements,
  childW,
  childrenW,
  createText,
  createW,
  descendantsW,
  elementText,
  getW,
  hasPreserve,
  insertAfter,
  isW,
  localName,
  removeNode,
  renderedText,
  rootElement,
  setPreserve,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
} from "./xml";

export interface RevisionContext {
  author: string;
  /** ISO-8601 without milliseconds, e.g. 2026-10-09T10:00:00Z. */
  date: string;
  nextId: () => string;
}

/** Word's own date format for w:date. */
export function revisionDate(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Create a revision context whose ids start above every w:id already in the document. */
export function createRevisionContext(doc: XmlDocument, author: string, date?: string): RevisionContext {
  let max = 0;
  const visit = (el: XmlElement) => {
    for (const child of childElements(el)) {
      const id = getW(child, "id");
      if (id !== null && /^\d+$/.test(id)) max = Math.max(max, Number(id));
      visit(child);
    }
  };
  visit(rootElement(doc));
  let next = max + 1;
  return { author, date: date ?? revisionDate(), nextId: () => String(next++) };
}

export function createRevision(doc: XmlDocument, rev: RevisionContext, kind: "ins" | "del"): XmlElement {
  return createW(doc, kind, { id: rev.nextId(), author: rev.author, date: rev.date });
}

/* ---------------------------------------------------------------- runs */

/**
 * Wrap a run in <w:del>, converting its text elements. Idempotent. A run
 * that sits inside one of our own <w:ins> is simply removed instead: deleting
 * your own insertion leaves no revision behind (Word behaves the same way).
 * Returns the element now standing where the run was (or null when removed).
 */
export function markRunDeleted(run: XmlElement, rev: RevisionContext): XmlElement | null {
  const parent: XmlNode | null = run.parentNode;
  if (parent && isW(parent, "del")) return parent;
  if (parent && isW(parent, "ins") && getW(parent, "author") === rev.author) {
    const wrapper = parent as XmlElement;
    const previous = wrapper.previousSibling as XmlElement | null;
    removeNode(run);
    if (childElements(wrapper).length === 0) {
      removeNode(wrapper);
      return previous;
    }
    return wrapper;
  }
  const doc = run.ownerDocument!;
  for (const t of childrenW(run, "t")) renameText(t, "delText");
  for (const t of childrenW(run, "instrText")) renameText(t, "delInstrText");
  const del = createRevision(doc, rev, "del");
  run.parentNode!.replaceChild(del, run);
  del.appendChild(run);
  return del;
}

function renameText(el: XmlElement, newName: string): void {
  const replacement = createText(el.ownerDocument!, elementText(el), newName);
  if (hasPreserve(el)) setPreserve(replacement);
  el.parentNode!.replaceChild(replacement, el);
}

/** Wrap runs in <w:ins>; consecutive sibling runs share one wrapper. */
export function markRunsInserted(runs: XmlElement[], rev: RevisionContext): XmlElement[] {
  const wrappers: XmlElement[] = [];
  let current: XmlElement | null = null;
  for (const run of runs) {
    if (run.parentNode && isW(run.parentNode, "ins")) continue;
    if (current && current.nextSibling === run) {
      current.appendChild(run);
      continue;
    }
    current = createRevision(run.ownerDocument!, rev, "ins");
    run.parentNode!.replaceChild(current, run);
    current.appendChild(run);
    wrappers.push(current);
  }
  return wrappers;
}

/* ------------------------------------------------------- paragraph marks */

/** Ensure <w:pPr> exists as the first child and return it. */
export function ensurePPr(p: XmlElement): XmlElement {
  let pPr = childW(p, "pPr");
  if (!pPr) {
    pPr = createW(p.ownerDocument!, "pPr");
    p.insertBefore(pPr, p.firstChild);
  }
  return pPr;
}

/** Ensure the paragraph-mark <w:rPr> inside pPr (before sectPr/pPrChange). */
function ensureMarkRPr(pPr: XmlElement): XmlElement {
  let rPr = childW(pPr, "rPr");
  if (!rPr) {
    rPr = createW(pPr.ownerDocument!, "rPr");
    const before = childElements(pPr).find((c) => isW(c, "sectPr") || isW(c, "pPrChange")) ?? null;
    pPr.insertBefore(rPr, before);
  }
  return rPr;
}

/** Mark the paragraph mark as inserted or deleted (marker goes first in rPr). */
export function markParagraphMark(p: XmlElement, rev: RevisionContext, kind: "ins" | "del"): void {
  const rPr = ensureMarkRPr(ensurePPr(p));
  if (childW(rPr, kind)) return;
  rPr.insertBefore(createRevision(p.ownerDocument!, rev, kind), rPr.firstChild);
}

/** Tracked deletion of a whole paragraph (mark + every visible run). */
export function deleteParagraph(p: XmlElement, rev: RevisionContext): void {
  for (const run of visibleRuns(p)) markRunDeleted(run, rev);
  markParagraphMark(p, rev, "del");
}

/** Tracked deletion of a table: each row's mark plus every run in its cells. */
export function deleteTable(tbl: XmlElement, rev: RevisionContext): void {
  for (const tr of descendantsW(tbl, "tr", ["tbl"])) {
    for (const p of descendantsW(tr, "p")) for (const run of visibleRuns(p)) markRunDeleted(run, rev);
    markRowMark(tr, rev, "del");
  }
}

function markRowMark(tr: XmlElement, rev: RevisionContext, kind: "ins" | "del"): void {
  let trPr = childW(tr, "trPr");
  if (!trPr) {
    trPr = createW(tr.ownerDocument!, "trPr");
    const tblPrEx = childW(tr, "tblPrEx");
    tr.insertBefore(trPr, tblPrEx ? tblPrEx.nextSibling : tr.firstChild);
  }
  if (!childW(trPr, kind)) trPr.appendChild(createRevision(tr.ownerDocument!, rev, kind));
}

/**
 * Turn a (cloned) block into a tracked insertion: existing revisions inside
 * it are accepted so the copy is clean, then its paragraph marks and runs are
 * marked inserted. Works for paragraphs and tables.
 */
export function markBlockInserted(block: XmlElement, rev: RevisionContext): void {
  acceptChangesIn(block);
  const paragraphs = isW(block, "p") ? [block] : descendantsW(block, "p");
  for (const p of paragraphs) {
    markParagraphMark(p, rev, "ins");
    markRunsInserted(visibleRuns(p), rev);
  }
  if (isW(block, "tbl")) for (const tr of descendantsW(block, "tr", ["tbl"])) markRowMark(tr, rev, "ins");
}

/* ------------------------------------------------------ new paragraphs */

export interface RunSpec {
  text: string;
  bold?: boolean;
  italic?: boolean;
  highlight?: string;
  /** rPr to clone as the base formatting. */
  rPrTemplate?: XmlElement | null;
}

export interface ParagraphSpec {
  styleId?: string;
  runs: RunSpec[];
  /** pPr to clone (minus its rPr/sectPr) so the new paragraph inherits spacing etc. */
  pPrTemplate?: XmlElement | null;
}

/** Elements that must follow w:highlight inside rPr (schema order). */
const AFTER_HIGHLIGHT = ["u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"];
/** Elements that precede w:b inside rPr. */
const BEFORE_BOLD = ["rStyle", "rFonts"];

/** Build an rPr honouring schema order for the properties we set. */
export function buildRPr(doc: XmlDocument, spec: RunSpec): XmlElement | null {
  const rPr = spec.rPrTemplate ? (spec.rPrTemplate.cloneNode(true) as XmlElement) : createW(doc, "rPr");
  // drop tracked property changes copied from a template
  for (const change of childrenW(rPr, "rPrChange")) removeNode(change);
  if (spec.bold !== undefined) setToggle(rPr, "b", spec.bold, BEFORE_BOLD);
  if (spec.italic !== undefined) setToggle(rPr, "i", spec.italic, [...BEFORE_BOLD, "b", "bCs"]);
  if (spec.highlight) {
    for (const h of childrenW(rPr, "highlight")) removeNode(h);
    const highlight = createW(doc, "highlight", { val: spec.highlight });
    const before = childElements(rPr).find((c) => AFTER_HIGHLIGHT.includes(localName(c))) ?? null;
    rPr.insertBefore(highlight, before);
  }
  return childElements(rPr).length > 0 ? rPr : null;
}

function setToggle(rPr: XmlElement, name: string, on: boolean, precededBy: string[]): void {
  for (const existing of childrenW(rPr, name)) removeNode(existing);
  if (!on) return;
  const el = createW(rPr.ownerDocument!, name);
  let anchor: XmlElement | null = null;
  for (const child of childElements(rPr)) {
    if (precededBy.includes(localName(child))) anchor = child;
  }
  rPr.insertBefore(el, anchor ? anchor.nextSibling : rPr.firstChild);
}

export function createRun(doc: XmlDocument, spec: RunSpec): XmlElement {
  const run = createW(doc, "r");
  const rPr = buildRPr(doc, spec);
  if (rPr) run.appendChild(rPr);
  const lines = spec.text.split("\n");
  lines.forEach((line, i) => {
    if (i > 0) run.appendChild(createW(doc, "br"));
    if (line !== "") run.appendChild(createText(doc, line));
  });
  return run;
}

/** A new paragraph recorded as a tracked insertion (mark + runs). */
export function createInsertedParagraph(doc: XmlDocument, rev: RevisionContext, spec: ParagraphSpec): XmlElement {
  const p = createW(doc, "p");
  const pPr = createW(doc, "pPr");
  if (spec.pPrTemplate) {
    for (const child of childElements(spec.pPrTemplate)) {
      if (["rPr", "sectPr", "pPrChange", "pStyle"].includes(localName(child))) continue;
      pPr.appendChild(child.cloneNode(true));
    }
  }
  if (spec.styleId) pPr.insertBefore(createW(doc, "pStyle", { val: spec.styleId }), pPr.firstChild);
  p.appendChild(pPr);
  const ins = createRevision(doc, rev, "ins");
  for (const runSpec of spec.runs) ins.appendChild(createRun(doc, runSpec));
  p.appendChild(ins);
  markParagraphMark(p, rev, "ins");
  return p;
}

/* ------------------------------------------------------ text replacement */

/**
 * Split `run` so that `offset` (in its rendered text) becomes a run
 * boundary. Returns the run that now starts at `offset`, or null when no
 * split was needed. Both halves keep a copy of the rPr.
 */
export function splitRunAt(run: XmlElement, offset: number): XmlElement | null {
  const total = runText(run).length;
  if (offset <= 0 || offset >= total) return null;
  const doc = run.ownerDocument!;
  const right = createW(doc, "r");
  const rPr = childW(run, "rPr");
  if (rPr) right.appendChild(rPr.cloneNode(true));
  let pos = 0;
  let moving = false;
  for (const child of childElements(run)) {
    const name = localName(child);
    if (name === "rPr") continue;
    if (moving) {
      right.appendChild(child);
      continue;
    }
    const len = name === "t" ? renderedText(child).length : ["tab", "br", "cr", "noBreakHyphen"].includes(name) ? 1 : 0;
    if (pos + len <= offset) {
      pos += len;
      if (pos === offset) moving = true;
      continue;
    }
    // offset falls strictly inside this w:t: cut it
    const text = renderedText(child);
    const cut = offset - pos;
    const left = createText(doc, text.slice(0, cut));
    run.replaceChild(left, child);
    right.appendChild(createText(doc, text.slice(cut)));
    moving = true;
    pos = offset;
  }
  insertAfter(right, run);
  return right;
}

interface RunPiece {
  run: XmlElement;
  start: number;
  end: number;
}

function runPieces(p: XmlElement): RunPiece[] {
  let pos = 0;
  return visibleRuns(p).map((run) => {
    const start = pos;
    pos += runText(run).length;
    return { run, start, end: pos };
  });
}

/** Make `offset` fall on a run boundary inside paragraph `p`. */
function splitParagraphAt(p: XmlElement, offset: number): void {
  for (const piece of runPieces(p)) {
    if (piece.start < offset && offset < piece.end) {
      splitRunAt(piece.run, offset - piece.start);
      return;
    }
  }
}

export interface ReplaceResult {
  deleted: string;
  inserted: string;
}

/**
 * Replace the visible text of `p` in [start, end) with `newText` as a
 * tracked change. Runs are split at the boundaries, the covered runs are
 * wrapped in <w:del>, and the new text is inserted after them in a run that
 * clones the formatting of the first replaced run (or the run before the
 * insertion point). `highlight` marks the new text (e.g. "yellow").
 */
export function replaceParagraphRange(
  p: XmlElement,
  start: number,
  end: number,
  newText: string,
  rev: RevisionContext,
  highlight?: string
): ReplaceResult {
  const doc = p.ownerDocument!;
  splitParagraphAt(p, start);
  splitParagraphAt(p, end);
  const pieces = runPieces(p);
  const covered = pieces.filter((piece) => piece.start >= start && piece.end <= end && piece.end > piece.start);
  const deleted = covered.map((piece) => runText(piece.run)).join("");

  let template: XmlElement | null = null;
  let anchor: XmlElement | null = null; // node after which the insertion goes
  if (covered.length > 0) {
    template = childW(covered[0].run, "rPr")?.cloneNode(true) as XmlElement | null;
    for (const piece of covered) anchor = markRunDeleted(piece.run, rev) ?? anchor;
  } else {
    const before = pieces.filter((piece) => piece.end <= start).pop();
    const after = pieces.find((piece) => piece.start >= start);
    const neighbour = before?.run ?? after?.run ?? null;
    template = neighbour ? childW(neighbour, "rPr") : null;
    anchor = before ? outermostWrapper(before.run, p) : null;
  }

  if (newText !== "") {
    const ins = createRevision(doc, rev, "ins");
    ins.appendChild(createRun(doc, { text: newText, rPrTemplate: template, highlight }));
    if (anchor) insertAfter(ins, anchor);
    else {
      const pPr = childW(p, "pPr");
      const first = pieces[0] ? outermostWrapper(pieces[0].run, p) : null;
      p.insertBefore(ins, first ?? (pPr ? pPr.nextSibling : p.firstChild));
    }
  }
  return { deleted, inserted: newText };
}

/** The child of `p` that contains `run` (run itself, or its ins/hyperlink wrapper). */
function outermostWrapper(run: XmlElement, p: XmlElement): XmlElement {
  let node: XmlElement = run;
  while (node.parentNode && node.parentNode !== p) node = node.parentNode as XmlElement;
  return node;
}

/**
 * Replace the visible text of `p` in [start, end) with `newText`, touching
 * only the differing middle (expanded to whole words so the redline reads
 * naturally: "Fig. 1 |" -> "Figure 1." rather than "F" -> "Figure 1" + ".").
 */
export function replaceParagraphSpan(
  p: XmlElement,
  start: number,
  end: number,
  newText: string,
  rev: RevisionContext,
  highlight?: string
): ReplaceResult {
  const oldText = paragraphText(p).slice(start, end);
  if (oldText === newText) return { deleted: "", inserted: "" };
  let prefix = 0;
  const max = Math.min(oldText.length, newText.length);
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
  // expand to word boundaries
  while (prefix > 0 && !/\s/.test(oldText[prefix - 1])) prefix--;
  while (suffix > 0 && !/\s/.test(oldText[oldText.length - suffix])) suffix--;
  const replacement = newText.slice(prefix, newText.length - suffix);
  return replaceParagraphRange(p, start + prefix, start + oldText.length - suffix, replacement, rev, highlight);
}

/** Replace the whole visible text of `p` with `newText` (minimal word-level diff). */
export function replaceParagraphText(p: XmlElement, newText: string, rev: RevisionContext, highlight?: string): ReplaceResult {
  return replaceParagraphSpan(p, 0, paragraphText(p).length, newText, rev, highlight);
}
