/**
 * Minimal OPC (zip) access for .docx files via jszip.
 *
 * Only the parts we touch are read as strings; every other entry is copied
 * through untouched when the package is written back.
 */
import JSZip from "jszip";

export const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const DOCUMENT_PART = "word/document.xml";
export const STYLES_PART = "word/styles.xml";
export const DOCUMENT_RELS_PART = "word/_rels/document.xml.rels";
export const CONTENT_TYPES_PART = "[Content_Types].xml";

export interface OpenedDocx {
  zip: JSZip;
  documentXml: string;
  stylesXml?: string;
}

export async function openDocx(buffer: Buffer | Uint8Array): Promise<OpenedDocx> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await readPart(zip, DOCUMENT_PART);
  if (documentXml === undefined) {
    throw new Error("Not a Word document: word/document.xml is missing");
  }
  const stylesXml = await readPart(zip, STYLES_PART);
  return { zip, documentXml, stylesXml };
}

export async function readPart(zip: JSZip, path: string): Promise<string | undefined> {
  const file = zip.file(path);
  if (!file) return undefined;
  return file.async("string");
}

/** Write the given parts (others are kept) and serialize the package. */
export async function writeDocx(zip: JSZip, parts: Record<string, string>): Promise<Buffer> {
  for (const [path, content] of Object.entries(parts)) zip.file(path, content);
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    mimeType: DOCX_CONTENT_TYPE,
  });
  return Buffer.from(out);
}

/**
 * Make sure a part is wired into the package: a relationship from
 * document.xml and a content-type override. Needed only when the source
 * document lacks word/styles.xml and we have to create it.
 */
export async function ensurePartRegistered(
  zip: JSZip,
  partPath: string,
  relType: string,
  contentType: string
): Promise<void> {
  const target = partPath.replace(/^word\//, "");
  const rels = (await readPart(zip, DOCUMENT_RELS_PART)) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  if (!rels.includes(`Target="${target}"`)) {
    const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
    const nextId = (ids.length ? Math.max(...ids) : 0) + 1;
    const rel = `<Relationship Id="rId${nextId}" Type="${relType}" Target="${target}"/>`;
    zip.file(DOCUMENT_RELS_PART, rels.replace("</Relationships>", `${rel}</Relationships>`));
  }
  const types = await readPart(zip, CONTENT_TYPES_PART);
  if (types && !types.includes(`PartName="/${partPath}"`)) {
    const override = `<Override PartName="/${partPath}" ContentType="${contentType}"/>`;
    zip.file(CONTENT_TYPES_PART, types.replace("</Types>", `${override}</Types>`));
  }
}
