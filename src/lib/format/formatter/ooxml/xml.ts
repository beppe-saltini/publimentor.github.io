/**
 * Low-level XML helpers for editing WordprocessingML (word/document.xml).
 *
 * We work on a real DOM (@xmldom/xmldom) rather than regexes: Word splits
 * text across many runs, nests paragraphs inside tables and tracked-change
 * wrappers, and schema order matters. The DOM is serialized back without any
 * pretty-printing so untouched markup stays byte-identical (apart from the
 * XML prolog, which we copy verbatim from the input).
 */
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";
export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/* The DOM types exported by @xmldom/xmldom are structurally close to the
 * browser's; we alias them so the rest of the code reads naturally. */
export type XmlDocument = Document;
export type XmlNode = Node;
export type XmlElement = Element;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;

const PROLOG_RE = /^﻿?\s*<\?xml[^>]*\?>\s*/;

/** Parse a WordprocessingML part. Throws on malformed XML. */
export function parseXml(xml: string): XmlDocument {
  const errors: string[] = [];
  const parser = new DOMParser({
    errorHandler: {
      error: (message: unknown) => errors.push(String(message)),
      fatalError: (message: unknown) => errors.push(String(message)),
    },
  });
  let doc: XmlDocument | undefined;
  try {
    doc = parser.parseFromString(xml, "application/xml");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  if (!doc || errors.length > 0 || !doc.documentElement) {
    throw new Error(`Malformed XML: ${errors[0] ?? "no document element"}`);
  }
  return doc;
}

/**
 * Serialize the document element and prepend the exact prolog (XML
 * declaration + line ending) of the original part, so we never change
 * bytes Word did not ask us to change.
 */
export function serializeXml(doc: XmlDocument, originalXml: string): string {
  const prologMatch = PROLOG_RE.exec(originalXml);
  const prolog = prologMatch ? prologMatch[0] : "";
  const body = new XMLSerializer().serializeToString(doc.documentElement as XmlElement);
  return prolog + body;
}

export function isElement(node: XmlNode | null | undefined): node is XmlElement {
  return !!node && node.nodeType === ELEMENT_NODE;
}

/** The root element of a parsed part (typed as a plain Element). */
export function rootElement(doc: XmlDocument): XmlElement {
  return doc.documentElement as XmlElement;
}

/** True when `node` is an element in the WordprocessingML namespace with this local name. */
export function isW(node: XmlNode | null | undefined, localName: string): node is XmlElement {
  if (!isElement(node)) return false;
  const el = node;
  const local = el.localName ?? el.nodeName.split(":").pop();
  return local === localName && (el.namespaceURI === W_NS || el.namespaceURI == null);
}

export function localName(el: XmlElement): string {
  return el.localName ?? el.nodeName.split(":").pop() ?? el.nodeName;
}

export function childElements(parent: XmlNode): XmlElement[] {
  const out: XmlElement[] = [];
  const children = parent.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isElement(child)) out.push(child);
  }
  return out;
}

export function childW(parent: XmlNode, localName: string): XmlElement | null {
  for (const child of childElements(parent)) {
    if (isW(child, localName)) return child;
  }
  return null;
}

export function childrenW(parent: XmlNode, localName: string): XmlElement[] {
  return childElements(parent).filter((c) => isW(c, localName));
}

/**
 * Depth-first list of descendant elements with the given local name, in
 * document order. `stopAt` names elements whose subtree is not entered
 * (e.g. a nested paragraph inside a text box).
 */
export function descendantsW(root: XmlNode, name: string, stopAt: string[] = []): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (node: XmlNode) => {
    for (const child of childElements(node)) {
      if (isW(child, name)) out.push(child);
      if (stopAt.some((s) => isW(child, s))) continue;
      visit(child);
    }
  };
  visit(root);
  return out;
}

/** Nearest ancestor (excluding `node`) that is a w:<localName>, or null. */
export function closestW(node: XmlNode, name: string, until?: XmlNode): XmlElement | null {
  let current: XmlNode | null = node.parentNode;
  while (current && current !== until) {
    if (isW(current, name)) return current;
    current = current.parentNode;
  }
  return null;
}

/** Concatenated character data directly inside an element. */
export function elementText(el: XmlElement): string {
  let text = "";
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_NODE) {
      text += child.nodeValue ?? "";
    }
  }
  return text;
}

/**
 * What Word actually draws for a w:t: without xml:space="preserve" the edge
 * whitespace is dropped. Matching text must use this, not the raw bytes.
 */
export function renderedText(el: XmlElement): string {
  const raw = elementText(el);
  return hasPreserve(el) ? raw : raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

export function hasPreserve(el: XmlElement): boolean {
  return el.getAttributeNS(XML_NS, "space") === "preserve" || el.getAttribute("xml:space") === "preserve";
}

export function setPreserve(el: XmlElement): void {
  el.setAttributeNS(XML_NS, "xml:space", "preserve");
}

export function getW(el: XmlElement, attr: string): string | null {
  const v = el.getAttributeNS(W_NS, attr);
  if (v !== null && v !== "") return v;
  const prefixed = el.getAttribute(`w:${attr}`);
  return prefixed === "" ? null : prefixed;
}

export function setW(el: XmlElement, attr: string, value: string): void {
  el.setAttributeNS(W_NS, `w:${attr}`, value);
}

/** Create a `w:<name>` element with optional w:-prefixed attributes. */
export function createW(doc: XmlDocument, name: string, attrs: Record<string, string> = {}): XmlElement {
  const el = doc.createElementNS(W_NS, `w:${name}`);
  for (const [k, v] of Object.entries(attrs)) setW(el, k, v);
  return el;
}

/** Create `<w:t>` (or another text-bearing element) with correct whitespace handling. */
export function createText(doc: XmlDocument, text: string, name = "t"): XmlElement {
  const el = createW(doc, name);
  el.appendChild(doc.createTextNode(text));
  if (text !== text.trim() || /\s{2,}/.test(text)) setPreserve(el);
  return el;
}

export function insertAfter(newNode: XmlNode, reference: XmlNode): void {
  const parent = reference.parentNode;
  if (!parent) throw new Error("insertAfter: reference node has no parent");
  parent.insertBefore(newNode, reference.nextSibling);
}

export function removeNode(node: XmlNode): void {
  node.parentNode?.removeChild(node);
}

/** Replace `el` with its children (used when unwrapping w:ins). */
export function unwrap(el: XmlElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

export function serializeElement(el: XmlElement): string {
  return new XMLSerializer().serializeToString(el);
}

/** Escape text for direct string insertion into XML (used for styles.xml). */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
