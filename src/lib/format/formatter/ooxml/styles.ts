/**
 * word/styles.xml helpers.
 *
 * Two jobs: (1) tell the paragraph classifier which paragraph styles are
 * headings (by styleId, by name "heading N", or by outline level), and
 * (2) make sure Heading1/Heading2 exist so inserted section headings render
 * as headings. styles.xml is edited by string insertion before </w:styles>
 * so the rest of the part stays byte-identical.
 */
import { childW, childrenW, descendantsW, getW, parseXml, rootElement } from "./xml";

export interface StyleInfo {
  styleId: string;
  name: string;
  /** 1-based heading level when the style is a heading, otherwise undefined. */
  headingLevel?: number;
}

export type StyleMap = Map<string, StyleInfo>;

const HEADING_ID_RE = /^heading\s*([1-9])$/i;
const HEADING_NAME_RE = /^heading\s+([1-9])$/i;

/** Parse paragraph styles. Tolerates a missing or malformed styles part. */
export function parseStyleMap(stylesXml: string | undefined): StyleMap {
  const map: StyleMap = new Map();
  if (!stylesXml) return map;
  let doc;
  try {
    doc = parseXml(stylesXml);
  } catch {
    return map;
  }
  for (const style of descendantsW(rootElement(doc), "style")) {
    const type = getW(style, "type");
    if (type && type !== "paragraph") continue;
    const styleId = getW(style, "styleId");
    if (!styleId) continue;
    const nameEl = childW(style, "name");
    const name = (nameEl && getW(nameEl, "val")) ?? styleId;
    const info: StyleInfo = { styleId, name };

    const byId = HEADING_ID_RE.exec(styleId);
    const byName = HEADING_NAME_RE.exec(name);
    if (byId) info.headingLevel = Number(byId[1]);
    else if (byName) info.headingLevel = Number(byName[1]);
    else {
      const pPr = childW(style, "pPr");
      const outline = pPr && childW(pPr, "outlineLvl");
      const lvl = outline && getW(outline, "val");
      if (lvl !== null && lvl !== undefined && /^\d$/.test(lvl)) info.headingLevel = Number(lvl) + 1;
    }
    map.set(styleId, info);
  }
  return map;
}

/** True when the document defines at least one heading-level paragraph style. */
export function hasHeadingStyles(map: StyleMap): boolean {
  for (const info of map.values()) if (info.headingLevel) return true;
  return false;
}

/** styleId to use for an inserted heading at `level`, preferring existing styles. */
export function headingStyleId(map: StyleMap, level: 1 | 2 | 3): string {
  for (const info of map.values()) if (info.headingLevel === level) return info.styleId;
  return `Heading${level}`;
}

const HEADING_STYLE_XML: Record<1 | 2, string> = {
  1: `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>`,
  2: `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>`,
};

export const MINIMAL_STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  `</w:styles>`;

/**
 * Ensure Heading1 and Heading2 are defined. Returns the (possibly unchanged)
 * XML and whether anything was added. When the document already has heading
 * styles under other ids (e.g. a localized "Überschrift 1"), nothing is added
 * because `headingStyleId` will reuse those.
 */
export function ensureHeadingStyles(stylesXml: string | undefined): { xml: string; added: boolean } {
  const xml = stylesXml && stylesXml.includes("<w:styles") ? stylesXml : MINIMAL_STYLES_XML;
  const map = parseStyleMap(xml);
  const missing = ([1, 2] as const).filter((level) => ![...map.values()].some((s) => s.headingLevel === level));
  if (missing.length === 0) return { xml, added: xml !== stylesXml };
  const closing = xml.lastIndexOf("</w:styles>");
  if (closing < 0) return { xml, added: false };
  const insert = missing.map((l) => HEADING_STYLE_XML[l]).join("");
  return { xml: xml.slice(0, closing) + insert + xml.slice(closing), added: true };
}

/** Exposed for tests: ids of styles whose `w:name` matches, e.g. ["Heading1"]. */
export function styleIdsNamed(map: StyleMap, name: string): string[] {
  return [...map.values()].filter((s) => s.name.toLowerCase() === name.toLowerCase()).map((s) => s.styleId);
}

/** Does this styles part declare a style with the given id? (string check, cheap) */
export function stylesDeclare(stylesXml: string | undefined, styleId: string): boolean {
  if (!stylesXml) return false;
  const doc = parseXml(stylesXml);
  return childrenW(rootElement(doc), "style").some((s) => getW(s, "styleId") === styleId);
}
