/**
 * Unit tests for the OOXML primitives behind applyPlanToDocx: run merging,
 * paragraph text/heading classification, tracked-change primitives,
 * accept/reject, and style handling. All inputs are tiny synthetic XML.
 */
import { describe, expect, it } from "vitest";
import { acceptChangesIn, listTrackedChangesIn, rejectChangesIn } from "../ooxml/inspect";
import { mergeRuns, runRawText } from "../ooxml/merge-runs";
import {
  classifyHeading,
  locateParagraph,
  normalizeText,
  paragraphOriginalText,
  paragraphText,
  sectionEnd,
  textSimilarity,
  visibleRuns,
} from "../ooxml/paragraphs";
import { ensureHeadingStyles, hasHeadingStyles, headingStyleId, parseStyleMap } from "../ooxml/styles";
import {
  createInsertedParagraph,
  createRevisionContext,
  deleteParagraph,
  replaceParagraphText,
  revisionDate,
  splitRunAt,
  type RevisionContext,
} from "../ooxml/tracked";
import { childW, childrenW, descendantsW, parseXml, rootElement, serializeElement, serializeXml } from "../ooxml/xml";
import { buildDocumentXml, STYLES_WITH_HEADINGS, STYLES_WITHOUT_HEADINGS, type FixtureParagraph } from "./docx-fixture";

const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;

function docOf(paragraphs: FixtureParagraph[]) {
  const xml = buildDocumentXml(paragraphs);
  const doc = parseXml(xml);
  const body = childW(rootElement(doc), "body")!;
  return { xml, doc, body, paragraphs: childrenW(body, "p") };
}

function rev(doc: Document): RevisionContext {
  return createRevisionContext(doc, "PubliMentor", "2026-10-09T10:00:00Z");
}

const headingCtx = { styles: parseStyleMap(STYLES_WITH_HEADINGS), topLevelNames: new Set(["results", "discussion", "references"]) };

describe("xml helpers", () => {
  it("round-trips a part preserving the prolog and not pretty-printing", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document ${W}><w:body><w:p><w:r><w:t xml:space="preserve">a &amp; b </w:t></w:r></w:p></w:body></w:document>`;
    const doc = parseXml(xml);
    expect(serializeXml(doc, xml)).toBe(xml);
  });

  it("rejects input without a document element", () => {
    expect(() => parseXml("")).toThrow(/Malformed/);
    expect(() => parseXml("just text")).toThrow(/Malformed/);
  });
});

describe("mergeRuns", () => {
  it("merges adjacent runs with identical formatting and keeps different ones apart", () => {
    const { doc, paragraphs } = docOf([
      { text: [{ text: "Hel" }, { text: "lo " }, { text: "world", bold: true }, { text: "!", bold: true }] },
    ]);
    expect(mergeRuns(doc)).toBe(2);
    const runs = visibleRuns(paragraphs[0]);
    expect(runs.map(runRawText)).toEqual(["Hello ", "world!"]);
    expect(paragraphText(paragraphs[0])).toBe("Hello world!");
  });

  it("uses rendered text: a non-preserve edge space is dropped when merging", () => {
    const xml = `<w:document ${W}><w:body><w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p></w:body></w:document>`;
    const doc = parseXml(xml);
    mergeRuns(doc);
    expect(paragraphText(descendantsW(rootElement(doc), "p")[0])).toBe("Helloworld");
  });

  it("strips proofErr markers and rsid attributes", () => {
    const xml = `<w:document ${W}><w:body><w:p><w:proofErr w:type="spellStart"/><w:r w:rsidR="00A1"><w:t>Text</w:t></w:r><w:proofErr w:type="spellEnd"/></w:p></w:body></w:document>`;
    const doc = parseXml(xml);
    mergeRuns(doc);
    const out = serializeElement(rootElement(doc));
    expect(out).not.toContain("proofErr");
    expect(out).not.toContain("rsid");
  });

  it("never merges runs across tracked-change wrappers", () => {
    const xml = `<w:document ${W}><w:body><w:p><w:r><w:t>a</w:t></w:r><w:ins w:id="1" w:author="X" w:date="2020-01-01T00:00:00Z"><w:r><w:t>b</w:t></w:r></w:ins><w:r><w:t>c</w:t></w:r></w:p></w:body></w:document>`;
    const doc = parseXml(xml);
    expect(mergeRuns(doc)).toBe(0);
    expect(listTrackedChangesIn(doc)).toEqual([expect.objectContaining({ type: "ins", text: "b", author: "X" })]);
  });
});

describe("paragraph classification and lookup", () => {
  it("normalizes headings (numbering, case, punctuation, typographic dashes)", () => {
    expect(normalizeText("2.1  Materials and Methods:")).toBe("materials and methods");
    expect(normalizeText("“Results” – part")).toBe('"results" - part');
    expect(normalizeText("III. Discussion.")).toBe("discussion");
  });

  it("classifies styled headings, bold pseudo-headings and body text", () => {
    const { paragraphs } = docOf([
      { text: "Results", style: "Heading1" },
      { text: "Sub", style: "Heading2" },
      { text: [{ text: "Discussion", bold: true }] },
      { text: [{ text: "A bold subsection title", bold: true }] },
      { text: [{ text: "A bold sentence ends with a period.", bold: true }] },
      { text: "Plain body text" },
      { text: [{ text: "Fig. 1 | Bold legend title", bold: true }] },
    ]);
    const kinds = paragraphs.map((p) => classifyHeading(p, headingCtx));
    expect(kinds).toEqual([
      { level: 1, source: "style" },
      { level: 2, source: "style" },
      { level: 1, source: "bold" },
      { level: 2, source: "bold" },
      null,
      null,
      null,
    ]);
  });

  it("computes section extents by heading level", () => {
    const { body } = docOf([
      { text: "Results", style: "Heading1" },
      { text: "body" },
      { text: "Sub", style: "Heading2" },
      { text: "more body" },
      { text: "Discussion", style: "Heading1" },
      { text: "end" },
    ]);
    const blocks = childrenW(body, "p");
    expect(sectionEnd(blocks, 0, headingCtx)).toBe(4);
    expect(sectionEnd(blocks, 2, headingCtx)).toBe(4);
    expect(sectionEnd(blocks, 4, headingCtx)).toBe(6);
  });

  it("locates paragraphs exactly, by prefix, and by token similarity", () => {
    const { paragraphs } = docOf([
      { text: "Abstract", style: "Heading1" },
      { text: "Doe, J. & Roe, R. A synthetic study of widgets. J. Synth. Res. 12, 100-110 (2020)." },
      { text: "Abstract thinking is hard" },
    ]);
    expect(locateParagraph(paragraphs, "abstract", headingCtx)?.index).toBe(0);
    expect(locateParagraph(paragraphs, "Doe, J. & Roe, R. A synthetic study", headingCtx)?.index).toBe(1);
    // PDF-extracted text with different spacing and a dropped word still matches the reference.
    expect(locateParagraph(paragraphs, "Doe J & Roe R. synthetic study of widgets. J Synth Res 12, 100-110 (2020)", headingCtx)?.index).toBe(1);
    expect(locateParagraph(paragraphs, "Something else entirely", headingCtx)).toBeNull();
    expect(textSimilarity("alpha beta gamma", "gamma beta alpha")).toBe(1);
    expect(textSimilarity("alpha beta", "delta")).toBe(0);
  });
});

describe("tracked-change primitives", () => {
  it("formats revision dates like Word", () => {
    expect(revisionDate(new Date("2026-10-09T10:00:00.123Z"))).toBe("2026-10-09T10:00:00Z");
  });

  it("starts ids above existing ones", () => {
    const xml = `<w:document ${W}><w:body><w:p><w:bookmarkStart w:id="7" w:name="x"/><w:r><w:t>a</w:t></w:r></w:p></w:body></w:document>`;
    const ctx = createRevisionContext(parseXml(xml), "A");
    expect(ctx.nextId()).toBe("8");
    expect(ctx.nextId()).toBe("9");
  });

  it("splits a run at a character offset keeping formatting on both halves", () => {
    const { paragraphs } = docOf([{ text: [{ text: "Hello world", bold: true }] }]);
    const run = visibleRuns(paragraphs[0])[0];
    const right = splitRunAt(run, 5)!;
    expect(runRawText(run)).toBe("Hello");
    expect(runRawText(right)).toBe(" world");
    expect(childW(right, "rPr")).not.toBeNull();
    expect(serializeElement(right)).toContain('<w:t xml:space="preserve"> world</w:t>');
    expect(splitRunAt(run, 0)).toBeNull();
    expect(splitRunAt(run, 5)).toBeNull();
  });

  it("replaces only the differing words across run boundaries", () => {
    const { doc, paragraphs } = docOf([{ text: [{ text: "Fig. 1 | Widget ", bold: true }, { text: "assembly shown here." }] }]);
    const result = replaceParagraphText(paragraphs[0], "Figure 1. Widget assembly shown here.", rev(doc));
    expect(result).toEqual({ deleted: "Fig. 1 |", inserted: "Figure 1." });
    expect(paragraphText(paragraphs[0])).toBe("Figure 1. Widget assembly shown here.");
    expect(paragraphOriginalText(paragraphs[0])).toBe("Fig. 1 | Widget assembly shown here.");
    // the inserted run inherits the bold formatting of the run it replaces
    const ins = descendantsW(paragraphs[0], "ins")[0];
    expect(serializeElement(ins)).toContain("<w:rPr><w:b/></w:rPr><w:t>Figure 1.</w:t>");
  });

  it("deletes a paragraph with a deleted mark and delText runs, which accept removes", () => {
    const { doc, body, paragraphs } = docOf([{ text: "Keep" }, { text: [{ text: "Gone" }, { text: " away", bold: true }] }, { text: "Also keep" }]);
    deleteParagraph(paragraphs[1], rev(doc));
    const xml = serializeElement(paragraphs[1]);
    // (serializing a subtree re-declares xmlns:w on the element; the full part does not)
    expect(xml).toMatch(/^<w:p[^>]*><w:pPr><w:rPr><w:del w:id="\d+" w:author="PubliMentor" w:date="2026-10-09T10:00:00Z"\/><\/w:rPr><\/w:pPr><w:del [^>]*><w:r><w:delText>Gone<\/w:delText><\/w:r><\/w:del>/);
    expect(paragraphText(paragraphs[1])).toBe("");
    acceptChangesIn(rootElement(doc));
    expect(childrenW(body, "p").map(paragraphText)).toEqual(["Keep", "Also keep"]);
  });

  it("creates inserted paragraphs that reject cleanly and accept to plain paragraphs", () => {
    const { doc, body } = docOf([{ text: "First" }]);
    const p = createInsertedParagraph(doc, rev(doc), { styleId: "Heading1", runs: [{ text: "New ", highlight: "yellow" }, { text: "[TOKEN]", highlight: "yellow", bold: true }] });
    body.insertBefore(p, childW(body, "sectPr"));
    const serialized = serializeElement(p);
    expect(serialized).toContain('<w:pStyle w:val="Heading1"/><w:rPr><w:ins ');
    expect(serialized).toContain('<w:rPr><w:b/><w:highlight w:val="yellow"/></w:rPr><w:t>[TOKEN]</w:t>');

    const rejected = parseXml(serializeXml(doc, ""));
    rejectChangesIn(rootElement(rejected), (el) => el.getAttribute("w:author") === "PubliMentor");
    expect(descendantsW(rootElement(rejected), "p").map(paragraphText)).toEqual(["First"]);

    acceptChangesIn(rootElement(doc));
    expect(childrenW(body, "p").map(paragraphText)).toEqual(["First", "New [TOKEN]"]);
    expect(descendantsW(rootElement(doc), "ins")).toHaveLength(0);
  });

  it("accepting a deleted paragraph mark joins the remaining content with the next paragraph", () => {
    const xml = `<w:document ${W}><w:body><w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A" w:date="2020-01-01T00:00:00Z"/></w:rPr></w:pPr><w:r><w:t>Alpha </w:t></w:r></w:p><w:p><w:r><w:t>beta</w:t></w:r></w:p></w:body></w:document>`;
    const doc = parseXml(xml);
    acceptChangesIn(rootElement(doc));
    expect(descendantsW(rootElement(doc), "p").map(paragraphText)).toEqual(["Alphabeta"]);
  });
});

describe("styles", () => {
  it("maps heading styles by id, name or outline level", () => {
    const xml = `<w:styles ${W}><w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Custom"><w:name w:val="My Section"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style><w:style w:type="character" w:styleId="Heading3Char"><w:name w:val="Heading 3 Char"/></w:style></w:styles>`;
    const map = parseStyleMap(xml);
    expect(map.get("berschrift1")?.headingLevel).toBe(1);
    expect(map.get("Custom")?.headingLevel).toBe(2);
    expect(map.has("Heading3Char")).toBe(false);
    expect(hasHeadingStyles(map)).toBe(true);
    expect(headingStyleId(map, 1)).toBe("berschrift1");
    expect(headingStyleId(map, 3)).toBe("Heading3");
  });

  it("adds Heading1/Heading2 only when missing, by string insertion", () => {
    const added = ensureHeadingStyles(STYLES_WITHOUT_HEADINGS);
    expect(added.added).toBe(true);
    expect(added.xml.startsWith(STYLES_WITHOUT_HEADINGS.replace("</w:styles>", ""))).toBe(true);
    expect(added.xml).toContain('w:styleId="Heading1"');
    expect(added.xml.endsWith("</w:styles>")).toBe(true);
    expect(ensureHeadingStyles(STYLES_WITH_HEADINGS)).toEqual({ xml: STYLES_WITH_HEADINGS, added: false });
    expect(ensureHeadingStyles(undefined).xml).toContain('w:styleId="Heading2"');
  });
});
