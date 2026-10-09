/**
 * Coalesce fragmented runs (TypeScript port of the docx skill's merge_runs.py).
 *
 * Word fragments paragraph text across many <w:r> elements (revision ids,
 * spell-check markers, editing history). A phrase you can see in the
 * document therefore often does not exist as one string in the XML. Before
 * locating text we merge adjacent runs whose formatting (<w:rPr>) is
 * identical, drop proofErr markers and rsid attributes, and consolidate
 * adjacent <w:t> elements. Rendering is unchanged.
 *
 * Runs in two different <w:ins>/<w:del> wrappers are never merged (they
 * are not siblings), so existing tracked-change structure is preserved.
 */
import {
  childElements,
  childW,
  childrenW,
  descendantsW,
  elementText,
  hasPreserve,
  isElement,
  isW,
  localName,
  removeNode,
  renderedText,
  rootElement,
  serializeElement,
  setPreserve,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
} from "./xml";

/** Merge runs across the whole part. Returns the number of runs merged away. */
export function mergeRuns(doc: XmlDocument): number {
  const root = rootElement(doc);

  for (const err of descendantsW(root, "proofErr")) removeNode(err);

  const runs = descendantsW(root, "r");
  for (const run of runs) stripRsidAttributes(run);

  const containers = new Set<XmlNode>();
  for (const run of runs) if (run.parentNode) containers.add(run.parentNode);

  let merged = 0;
  for (const container of containers) merged += mergeRunsIn(container);
  return merged;
}

function stripRsidAttributes(el: XmlElement): void {
  const attrs = el.attributes;
  const toRemove: string[] = [];
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i].name;
    if (name.toLowerCase().includes("rsid")) toRemove.push(name);
  }
  for (const name of toRemove) el.removeAttribute(name);
}

function mergeRunsIn(container: XmlNode): number {
  let merged = 0;
  let run = nextRun(container.firstChild, true);
  while (run) {
    for (;;) {
      const next = nextElementSibling(run);
      if (next && isW(next, "r") && canMerge(run, next)) {
        moveRunContent(run, next);
        removeNode(next);
        merged++;
      } else break;
    }
    consolidateText(run, "t");
    consolidateText(run, "delText");
    run = nextRun(run.nextSibling, true);
  }
  return merged;
}

function nextRun(start: XmlNode | null, inclusive: boolean): XmlElement | null {
  let node: XmlNode | null = inclusive ? start : start?.nextSibling ?? null;
  while (node) {
    if (isW(node, "r")) return node;
    node = node.nextSibling;
  }
  return null;
}

function nextElementSibling(node: XmlNode): XmlElement | null {
  let sibling: XmlNode | null = node.nextSibling;
  while (sibling) {
    if (isElement(sibling)) return sibling;
    sibling = sibling.nextSibling;
  }
  return null;
}

/** Two runs can merge when their rPr serialize identically (or both lack one). */
function canMerge(a: XmlElement, b: XmlElement): boolean {
  const ra = childW(a, "rPr");
  const rb = childW(b, "rPr");
  if ((ra === null) !== (rb === null)) return false;
  if (!ra || !rb) return true;
  return serializeElement(ra) === serializeElement(rb);
}

function moveRunContent(target: XmlElement, source: XmlElement): void {
  for (const child of childElements(source)) {
    if (localName(child) !== "rPr") target.appendChild(child);
  }
}

/**
 * Join directly adjacent text elements of one kind inside a run. The merged
 * text is the *rendered* text of each piece, so a non-preserve "Hello " that
 * Word draws as "Hello" stays "Hello" (see merge_runs.py).
 */
function consolidateText(run: XmlElement, name: "t" | "delText"): void {
  const texts = childrenW(run, name);
  for (let i = texts.length - 1; i > 0; i--) {
    const curr = texts[i];
    const prev = texts[i - 1];
    if (!isAdjacent(prev, curr)) continue;
    const mergedText = renderedText(prev) + renderedText(curr);
    const hadPreserve = hasPreserve(prev) || hasPreserve(curr);
    while (prev.firstChild) prev.removeChild(prev.firstChild);
    prev.appendChild(run.ownerDocument!.createTextNode(mergedText));
    removeNode(curr);
    if (hadPreserve || mergedText !== mergedText.trim()) setPreserve(prev);
    else if (hasPreserve(prev)) prev.removeAttribute("xml:space");
  }
}

function isAdjacent(a: XmlNode, b: XmlNode): boolean {
  let node: XmlNode | null = a.nextSibling;
  while (node) {
    if (node === b) return true;
    if (isElement(node)) return false;
    if (node.nodeType === 3 && (node.nodeValue ?? "").trim() !== "") return false;
    node = node.nextSibling;
  }
  return false;
}

/** Exposed for tests: the raw text of a run's w:t children. */
export function runRawText(run: XmlElement): string {
  return childrenW(run, "t").map(elementText).join("");
}
