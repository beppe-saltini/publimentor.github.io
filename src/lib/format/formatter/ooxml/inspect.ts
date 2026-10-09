/**
 * Reading back tracked changes: accept all, reject (a given author's)
 * changes, list revisions, and validate that every text difference between
 * an original and a redlined document is recorded as a tracked change.
 *
 * Accepting a deleted paragraph mark joins the paragraph with the next one
 * (so a paragraph whose runs are all deleted vanishes), which is what Word
 * does and what pandoc/LibreOffice sometimes get wrong (see the docx skill).
 */
import {
  childElements,
  childW,
  createText,
  descendantsW,
  elementText,
  getW,
  hasPreserve,
  isW,
  localName,
  parseXml,
  removeNode,
  serializeXml,
  setPreserve,
  unwrap,
  rootElement,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
} from "./xml";
import { paragraphText } from "./paragraphs";
import { DOCUMENT_PART, openDocx, writeDocx } from "./package";

export type RevisionFilter = (el: XmlElement) => boolean;

const PROPERTY_CHANGES = [
  "rPrChange", "pPrChange", "sectPrChange", "tblPrChange", "tblPrExChange",
  "trPrChange", "tcPrChange", "tblGridChange", "numberingChange", "cellIns", "cellDel",
];
const MOVE_RANGES = ["moveFromRangeStart", "moveFromRangeEnd", "moveToRangeStart", "moveToRangeEnd"];

/** Is this revision element the marker on a paragraph mark (pPr/rPr/ins|del)? */
function isParagraphMarkMarker(el: XmlElement): boolean {
  const parent = el.parentNode;
  return !!parent && isW(parent, "rPr") && !!parent.parentNode && isW(parent.parentNode, "pPr");
}

function isRowMarker(el: XmlElement): boolean {
  return !!el.parentNode && isW(el.parentNode, "trPr");
}

/** The w:p owning a paragraph-mark marker (pPr/rPr/ins|del). */
function markerParagraph(marker: XmlElement): XmlElement {
  return marker.parentNode!.parentNode!.parentNode as XmlElement;
}

/** The w:tr owning a row marker (trPr/ins|del). */
function markerRow(marker: XmlElement): XmlElement {
  return marker.parentNode!.parentNode as XmlElement;
}

/** Accept the revisions matching `filter` (all by default) inside `root`. */
export function acceptChangesIn(root: XmlElement, filter: RevisionFilter = () => true): void {
  const deletedMarks: XmlElement[] = [];
  for (const name of ["del", "moveFrom"]) {
    for (const el of descendantsW(root, name)) {
      if (!filter(el)) continue;
      if (isParagraphMarkMarker(el)) {
        const p = markerParagraph(el);
        deletedMarks.push(p);
        removeNode(el);
      } else if (isRowMarker(el)) {
        removeNode(markerRow(el));
      } else removeNode(el);
    }
  }
  for (const name of ["ins", "moveTo"]) {
    for (const el of descendantsW(root, name)) {
      if (!filter(el)) continue;
      if (isParagraphMarkMarker(el) || isRowMarker(el)) removeNode(el);
      else unwrap(el);
    }
  }
  for (const name of [...PROPERTY_CHANGES, ...MOVE_RANGES]) {
    for (const el of descendantsW(root, name)) if (filter(el)) removeNode(el);
  }
  for (const p of deletedMarks) joinWithNextParagraph(p);
}

/**
 * Reject the revisions matching `filter`: inserted content is removed,
 * deleted content is restored. Used by the validator to recover the
 * original text from a redlined document.
 */
export function rejectChangesIn(root: XmlElement, filter: RevisionFilter = () => true): void {
  const insertedMarks: XmlElement[] = [];
  for (const name of ["ins", "moveTo"]) {
    for (const el of descendantsW(root, name)) {
      if (!filter(el)) continue;
      if (isParagraphMarkMarker(el)) {
        insertedMarks.push(markerParagraph(el));
        removeNode(el);
      } else if (isRowMarker(el)) {
        removeNode(markerRow(el));
      } else removeNode(el);
    }
  }
  for (const name of ["del", "moveFrom"]) {
    for (const el of descendantsW(root, name)) {
      if (!filter(el)) continue;
      if (isParagraphMarkMarker(el) || isRowMarker(el)) {
        removeNode(el);
        continue;
      }
      for (const t of descendantsW(el, "delText")) renameTextElement(t, "t");
      for (const t of descendantsW(el, "delInstrText")) renameTextElement(t, "instrText");
      unwrap(el);
    }
  }
  for (const name of MOVE_RANGES) for (const el of descendantsW(root, name)) if (filter(el)) removeNode(el);
  for (const p of insertedMarks) joinWithNextParagraph(p);
}

function renameTextElement(el: XmlElement, newName: string): void {
  const doc = el.ownerDocument!;
  const replacement = createText(doc, elementText(el), newName);
  if (hasPreserve(el)) setPreserve(replacement);
  el.parentNode!.replaceChild(replacement, el);
}

/**
 * Join paragraph `p` with the following paragraph: its content moves to the
 * start of the next paragraph and `p` disappears. Without a following
 * paragraph an emptied `p` is simply removed.
 */
function joinWithNextParagraph(p: XmlElement): void {
  if (!p.parentNode) return;
  let next: XmlNode | null = p.nextSibling;
  while (next && !isW(next, "p")) next = isW(next, "tbl") || isW(next, "sectPr") ? null : next.nextSibling;
  const content = childElements(p).filter((c) => localName(c) !== "pPr");
  if (next && isW(next, "p")) {
    const nextPPr = childW(next, "pPr");
    let anchor: XmlNode | null = nextPPr ? nextPPr.nextSibling : next.firstChild;
    for (const node of content) {
      next.insertBefore(node, anchor);
      anchor = node.nextSibling;
    }
    removeNode(p);
  } else if (paragraphText(p).trim() === "") {
    removeNode(p);
  }
}

/** Return a copy of the document with every tracked change accepted. */
export async function acceptAllChanges(buffer: Buffer): Promise<Buffer> {
  const opened = await openDocx(buffer);
  const doc = parseXml(opened.documentXml);
  acceptChangesIn(rootElement(doc));
  return writeDocx(opened.zip, { [DOCUMENT_PART]: serializeXml(doc, opened.documentXml) });
}

export interface TrackedChange {
  type: "ins" | "del";
  text: string;
  author: string;
  id?: string;
  date?: string;
}

/** Content revisions (with text) in document order; paragraph-mark markers are omitted. */
export function listTrackedChangesIn(doc: XmlDocument): TrackedChange[] {
  const out: TrackedChange[] = [];
  const visit = (node: XmlElement) => {
    for (const child of childElements(node)) {
      const name = localName(child);
      if ((name === "ins" || name === "del" || name === "moveTo" || name === "moveFrom") && !isParagraphMarkMarker(child) && !isRowMarker(child)) {
        const type = name === "ins" || name === "moveTo" ? "ins" : "del";
        const text = revisionText(child);
        out.push({
          type,
          text,
          author: getW(child, "author") ?? "",
          id: getW(child, "id") ?? undefined,
          date: getW(child, "date") ?? undefined,
        });
        continue;
      }
      visit(child);
    }
  };
  visit(rootElement(doc));
  return out;
}

/** Text inside a revision wrapper, w:t and w:delText interleaved in document order. */
function revisionText(el: XmlElement): string {
  let text = "";
  const visit = (node: XmlElement) => {
    for (const child of childElements(node)) {
      const name = localName(child);
      if (name === "t" || name === "delText") text += elementText(child);
      else if (name === "tab") text += "\t";
      else if (name === "br" || name === "cr") text += "\n";
      else visit(child);
    }
  };
  visit(el);
  return text;
}

export async function listTrackedChanges(buffer: Buffer): Promise<TrackedChange[]> {
  const opened = await openDocx(buffer);
  return listTrackedChangesIn(parseXml(opened.documentXml));
}

/** Visible (all-accepted) paragraph texts of a document, empty ones dropped. */
export async function extractParagraphTexts(buffer: Buffer): Promise<string[]> {
  const opened = await openDocx(buffer);
  const doc = parseXml(opened.documentXml);
  acceptChangesIn(rootElement(doc));
  return descendantsW(rootElement(doc), "p")
    .map((p) => paragraphText(p).trim())
    .filter((t) => t !== "");
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** Number of revisions attributed to `author` in the modified document. */
  changeCount: number;
}

/**
 * The redlining check from the docx skill's `validate --author`: reject every
 * change by `author` in the modified document and compare its text with the
 * original's current view. Any remaining difference was edited without being
 * tracked. Also checks revision ids are unique and each revision has a date.
 */
export async function validateTrackedChanges(
  original: Buffer,
  modified: Buffer,
  author: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const [origOpened, modOpened] = await Promise.all([openDocx(original), openDocx(modified)]);
  const origDoc = parseXml(origOpened.documentXml);
  const modDoc = parseXml(modOpened.documentXml);

  const revisions = ["ins", "del", "moveFrom", "moveTo"].flatMap((n) => descendantsW(rootElement(modDoc), n));
  const seen = new Map<string, number>();
  let changeCount = 0;
  for (const rev of revisions) {
    const id = getW(rev, "id");
    if (id === null) errors.push(`${localName(rev)} without w:id`);
    else seen.set(id, (seen.get(id) ?? 0) + 1);
    if (getW(rev, "author") === author) {
      changeCount++;
      if (!getW(rev, "date")) errors.push(`${localName(rev)} ${id} by ${author} has no w:date`);
    }
  }
  for (const [id, count] of seen) if (count > 1) errors.push(`duplicate revision id ${id} (${count} uses)`);

  // Text diff after rejecting our changes.
  const byAuthor: RevisionFilter = (el) => getW(el, "author") === author;
  rejectChangesIn(rootElement(modDoc), byAuthor);
  acceptChangesIn(rootElement(origDoc));
  acceptChangesIn(rootElement(modDoc));
  const textOf = (doc: XmlDocument) =>
    descendantsW(rootElement(doc), "p")
      .map((p) => paragraphText(p).replace(/\s+/g, " ").trim())
      .filter((t) => t !== "");
  const a = textOf(origDoc);
  const b = textOf(modDoc);
  if (a.join("\n") !== b.join("\n")) {
    const firstDiff = a.findIndex((line, i) => line !== b[i]);
    errors.push(
      `untracked text change near paragraph ${firstDiff + 1}: original "${(a[firstDiff] ?? "").slice(0, 80)}" vs modified "${(b[firstDiff] ?? "").slice(0, 80)}"`
    );
  }
  return { ok: errors.length === 0, errors, changeCount };
}
