/**
 * Builds small synthetic .docx files for the apply-docx tests and demo.
 *
 * No real manuscript text is used here: every fixture is hand-written. The
 * package is the minimum Word needs: [Content_Types].xml, _rels/.rels,
 * word/document.xml, word/_rels/document.xml.rels and (optionally)
 * word/styles.xml.
 */
import JSZip from "jszip";

export interface FixtureRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  superscript?: boolean;
}

export interface FixtureParagraph {
  /** Plain text, or runs (adjacent runs with identical formatting simulate Word's fragmentation). */
  text: string | FixtureRun[];
  /** Paragraph style id, e.g. "Heading1". */
  style?: string;
  /** Extra raw XML placed inside the paragraph before the runs (e.g. a proofErr). */
  rawBeforeRuns?: string;
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function runXml(run: FixtureRun): string {
  const props = [run.bold ? "<w:b/>" : "", run.italic ? "<w:i/>" : "", run.superscript ? '<w:vertAlign w:val="superscript"/>' : ""].join("");
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : "";
  const preserve = run.text !== run.text.trim() ? ' xml:space="preserve"' : "";
  return `<w:r>${rPr}<w:t${preserve}>${escapeXml(run.text)}</w:t></w:r>`;
}

export function paragraphXml(p: FixtureParagraph): string {
  const pPr = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : "";
  const runs = typeof p.text === "string" ? [{ text: p.text }] : p.text;
  return `<w:p>${pPr}${p.rawBeforeRuns ?? ""}${runs.map(runXml).join("")}</w:p>`;
}

export function buildDocumentXml(paragraphs: FixtureParagraph[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${paragraphs.map(paragraphXml).join("")}` +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

export const STYLES_WITH_HEADINGS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
  `<w:styles xmlns:w="${W_NS}">` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>` +
  `</w:styles>`;

export const STYLES_WITHOUT_HEADINGS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
  `<w:styles xmlns:w="${W_NS}">` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  `</w:styles>`;

const CONTENT_TYPES = (withStyles: boolean) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  (withStyles
    ? `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`
    : "") +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOCUMENT_RELS = (withStyles: boolean) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  (withStyles
    ? `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    : "") +
  `</Relationships>`;

export interface BuildDocxOptions {
  /** styles.xml content; `null` omits the part entirely. Defaults to STYLES_WITH_HEADINGS. */
  stylesXml?: string | null;
  /** Use a pre-built document.xml instead of generating one from `paragraphs`. */
  documentXml?: string;
}

/** Zip a minimal Word package. */
export async function buildDocx(paragraphs: FixtureParagraph[], options: BuildDocxOptions = {}): Promise<Buffer> {
  const stylesXml = options.stylesXml === undefined ? STYLES_WITH_HEADINGS : options.stylesXml;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES(stylesXml !== null));
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", options.documentXml ?? buildDocumentXml(paragraphs));
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS(stylesXml !== null));
  if (stylesXml !== null) zip.file("word/styles.xml", stylesXml);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

/** Read one part of a .docx as a string (undefined when missing). */
export async function readDocxPart(buffer: Buffer, path: string): Promise<string | undefined> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(path)?.async("string");
}
