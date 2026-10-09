/**
 * Superscript citation recovery: digits that PDF extraction glued to the
 * preceding word become superscript runs, gene/protein/cell-line names stay
 * plain. All sentences here are synthetic.
 */
import { describe, expect, it } from "vitest";
import { slotSuperscriptMax } from "../render-docx";
import { splitSuperscriptCitations, superscriptCitationMax } from "../superscript-citations";
import { iscienceTarget, genericTarget } from "../target-structures";

/** The superscripted pieces of a sentence, in order. */
const sup = (text: string, maxRef = 36) => splitSuperscriptCitations(text, maxRef).filter((s) => s.superscript).map((s) => s.text);

describe("splitSuperscriptCitations", () => {
  it("superscripts trailing citation numbers after a lower-case word, incl. comma lists and ranges", () => {
    expect(sup("Widgets have long been studied1,2.")).toEqual(["1,2"]);
    expect(sup("Cells release stress signals8,9. Then")).toEqual(["8,9"]);
    expect(sup("These vesicles engage antitumor immunity1-4 . Current")).toEqual(["1-4"]);
    expect(sup("Widgets are stable organelles22–29 that")).toEqual(["22–29"]);
    expect(sup("Loss of widgets impairs assembly in cells12")).toEqual(["12"]);
    expect(sup("Mechanisms of widget formation32 , we asked")).toEqual(["32"]);
  });

  it("accepts spaced comma lists only when the run ends at punctuation", () => {
    expect(sup("This is caused by DNA damage11, 12 . The")).toEqual(["11, 12"]);
    expect(sup("The mechanism remains unclear4, 13-19 . Conversely")).toEqual(["4, 13-19"]);
    // "12, 13 mice" is a count, not a citation list.
    expect(sup("We analysed 1,000 cells12, 13 mice were used")).toEqual([]);
  });

  it("superscripts after 'et al.' and a closing parenthesis, but not after labels or decimals", () => {
    expect(sup("as shown by Smith et al.1 and others")).toEqual(["1"]);
    expect(sup("widget output rose (Fig. 1a)12 and")).toEqual(["12"]);
    expect(sup("Fig.1a shows widgets; see also Table1 and the pLKO.1 vector")).toEqual([]);
    expect(sup("P < 0.05 and 1,000 cells; ratio 2:1; (2019)12")).toEqual([]);
  });

  it("keeps the whole text as one plain segment and preserves every character", () => {
    const text = "Widgets have long been studied1,2. Gadgets too3.";
    const segments = splitSuperscriptCitations(text, 36);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments).toEqual([
      { text: "Widgets have long been studied", superscript: false },
      { text: "1,2", superscript: true },
      { text: ". Gadgets too", superscript: false },
      { text: "3", superscript: true },
      { text: ".", superscript: false },
    ]);
    expect(splitSuperscriptCitations("No digits here.", 36)).toEqual([{ text: "No digits here.", superscript: false }]);
  });

  it("leaves gene, protein and cell-line names alone", () => {
    const genes = "TSPAN4 and CD8 and p53 and H1299 and 4T1 cells and Tspan4 expression and Itga5 KO and mT4 cells and Rab35 and GRCm38 and HEK293T";
    expect(sup(genes)).toEqual([]);
    expect(splitSuperscriptCitations(genes, 36)).toEqual([{ text: genes, superscript: false }]);
    // Lower-case prefixes that legitimately carry digits, and 1-2 letter stems.
    expect(sup("|log2 fold change| > 1; featureCounts v1.5.0-p3; DESeq2 v1.20.0; on day7; chr17; mm10; miR-21")).toEqual([]);
    expect(sup("anti-CD8 (clone 53-6.7, BioLegend, Cat# 100708) and 5 µm2 sections")).toEqual([]);
  });

  it("requires every number to be within the reference count and ranges to ascend", () => {
    expect(sup("supported by earlier work40.", 36)).toEqual([]);
    expect(sup("supported by earlier work36.", 36)).toEqual(["36"]);
    expect(sup("supported by earlier work35,37.", 36)).toEqual([]);
    expect(sup("supported by earlier work4-1.", 36)).toEqual([]);
    expect(sup("supported by earlier work1-4.", 36)).toEqual(["1-4"]);
    expect(sup("supported by earlier work1-4.", 3)).toEqual([]);
    expect(sup("supported by earlier work1-4.", 0)).toEqual([]);
  });
});

describe("superscriptCitationMax / slotSuperscriptMax", () => {
  it("runs for superscript manuscripts or superscript journals, never for author-year text", () => {
    expect(superscriptCitationMax({ inTextStyle: "superscript-numeric", count: 36 }, genericTarget)).toBe(36);
    expect(superscriptCitationMax({ inTextStyle: "unknown", count: 36 }, iscienceTarget)).toBe(36);
    expect(superscriptCitationMax({ inTextStyle: "unknown", count: 36 }, genericTarget)).toBe(0);
    expect(superscriptCitationMax({ inTextStyle: "author-year", count: 36 }, iscienceTarget)).toBe(0);
    // No parsed list: fall back to the repaired references, else off.
    expect(superscriptCitationMax({ inTextStyle: "superscript-numeric", count: 0 }, iscienceTarget, 12)).toBe(12);
    expect(superscriptCitationMax({ inTextStyle: "superscript-numeric", count: 0 }, iscienceTarget)).toBe(0);
  });

  it("applies to citing prose only: not legends, tables, the KRT, supplemental titles or references", () => {
    for (const id of ["summary", "introduction", "results", "discussion", "acknowledgments", "method_details", "experimental_model", "lead_contact"]) {
      expect(slotSuperscriptMax(iscienceTarget, id, 36), id).toBe(36);
    }
    for (const id of ["figure_legends", "tables", "krt", "supplemental_titles", "references", "title_page"]) {
      expect(slotSuperscriptMax(iscienceTarget, id, 36), id).toBe(0);
    }
    expect(slotSuperscriptMax(iscienceTarget, "results", 0)).toBe(0);
  });
});
