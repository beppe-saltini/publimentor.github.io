import JSZip from "jszip";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { planFormatting } from "../plan";
import { outputFileName, renderFormattedDocx } from "../render-docx";
import { iscienceTarget } from "../target-structures";
import { makeModel } from "./fixtures";

/** Heading texts in document order from mammoth's HTML. */
function headings(html: string, level: 1 | 2 | 3): string[] {
  return Array.from(html.matchAll(new RegExp(`<h${level}[^>]*>(.*?)</h${level}>`, "g")), (m) => m[1].replace(/<[^>]+>/g, "").trim());
}

describe("renderFormattedDocx", () => {
  it("produces a Word file whose headings follow the iScience order", async () => {
    const model = makeModel();
    const plan = await planFormatting(model, iscienceTarget, { repairReferences: false });
    const doc = await renderFormattedDocx(model, plan, iscienceTarget, { journalName: "iScience" });
    expect(doc.kind).toBe("rebuilt");
    expect(doc.fileName).toBe("widgets-paper-iscience-formatted.docx");
    expect(doc.contentType).toContain("wordprocessingml");

    const { value: html } = await mammoth.convertToHtml({ buffer: doc.buffer });
    const h1 = headings(html, 1);
    expect(h1).toEqual(["Summary", "Introduction", "Results", "Discussion", "Resource Availability", "Limitations of the Study", "Acknowledgments", "Author Contributions", "Declaration of Interests", "Figure titles and legends", "STAR Methods", "Supplemental information titles and legends", "References", "Formatting change log"]);
    const h2 = headings(html, 2);
    expect(h2.slice(h2.indexOf("Lead Contact"), h2.indexOf("Lead Contact") + 3)).toEqual(["Lead Contact", "Materials Availability", "Data and Code Availability"]);
    expect(h2).toEqual(expect.arrayContaining(["Key Resources Table", "Experimental Model and Study Participant Details", "Method Details", "Quantification and Statistical Analysis"]));
    expect(html).toContain("Widgets regulate gadget assembly in vivo");
    // Title page: marked author list, Lead Contact footnote, correspondence line.
    expect(html).toContain("Jane Doe1,3*");
    expect(html).toContain("3Lead contact");
    expect(html).toContain("*Correspondence: jane@example.org");
    // A slot heading never doubles as its own first subheading.
    expect(headings(html, 2).filter((h) => h === "Quantification and Statistical Analysis")).toHaveLength(1);
    expect(headings(html, 3)).not.toContain("Quantification and Statistical Analysis");
    expect(html).toContain("[AUTHOR ACTION NEEDED]");
    expect(html).toContain("Figure 1. Widgets control gadgets");
    expect(html).toContain("REAGENT or RESOURCE");
    expect(html).toContain("Doe, J., Roe, R., and Poe, E.A. (2021)");
  });

  it("highlights placeholders, uses a real table and numbered lists in the OOXML", async () => {
    const model = makeModel();
    const plan = await planFormatting(model, iscienceTarget, { repairReferences: false });
    const doc = await renderFormattedDocx(model, plan, iscienceTarget, { journalName: "iScience" });
    const zip = await JSZip.loadAsync(doc.buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
    expect((xml.match(/<w:tbl>/g) || []).length).toBeGreaterThanOrEqual(1);
    expect(xml).not.toContain("<w:gridSpan"); // no merged cells in the KRT
    expect(xml).toContain("<w:numPr>");
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*\n[^<]*<\/w:t>/); // no raw newlines in runs
    const numbering = await zip.file("word/numbering.xml")!.async("string");
    expect(numbering).toContain('w:val="decimal"');
    expect(numbering).toContain('w:val="bullet"');
    expect(xml).toContain("Key Resources Table");
    expect(xml).toContain("[not verified on Crossref");
  });

  it("restores glued superscript citations in citing prose only, leaving gene names and legends alone", async () => {
    const model = makeModel();
    // Introduction already reads "...studied1,2."; add gene names plus one more citation.
    model.sections[1].body += " TSPAN4, CD8, p53, H1299 and 4T1 cells were used3.";
    // A legend is never citing prose: "cells3." stays flat there.
    model.figureLegends[1].body = "a, Sprocket loss in 4T1 cells3. n = 3.";
    const plan = await planFormatting(model, iscienceTarget, { repairReferences: false });
    const doc = await renderFormattedDocx(model, plan, iscienceTarget, { journalName: "iScience" });
    const zip = await JSZip.loadAsync(doc.buffer);
    const xml = await zip.file("word/document.xml")!.async("string");

    const superscriptRuns = Array.from(xml.matchAll(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:vertAlign w:val="superscript"\/>(?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>([^<]*)<\/w:t><\/w:r>/g), (m) => m[1]);
    expect(superscriptRuns).toEqual(["1,2", "3"]);
    // The text itself is unchanged, only split into runs: gene names sit in a plain run right before the superscript.
    expect(xml).toContain("TSPAN4, CD8, p53, H1299 and 4T1 cells were used</w:t>");
    expect(xml).toContain("Widgets have long been studied</w:t>");
    expect(xml).toContain("a, Sprocket loss in 4T1 cells3. n = 3.</w:t>");
    const { value: html } = await mammoth.convertToHtml({ buffer: doc.buffer });
    expect(html).toContain("studied<sup>1,2</sup>.");
    expect(html).toContain("were used<sup>3</sup>.");
    expect(html).toContain("4T1 cells3. n = 3.");
  });

  it("derives the file name from the original and sanitizes it", () => {
    expect(outputFileName(makeModel({ fileName: "My Paper (final).docx" }), "iscience")).toBe("My-Paper-final-iscience-formatted.docx");
    expect(outputFileName(makeModel({ fileName: undefined }), "generic")).toBe("manuscript-generic-formatted.docx");
  });
});
