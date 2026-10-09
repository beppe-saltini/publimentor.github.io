/**
 * Unit tests for the content parsers: figure legends, table captions,
 * supplemental items, the reference list, features, accessions and the
 * discouraged-phrase scan.
 *
 * All fixtures are synthetic (no real manuscript content).
 */

import { describe, expect, it } from "vitest";

import { detectStructure } from "../parse/headings";
import {
  assessLegendPlacement,
  parseFiguresAndTables,
  parseItemList,
} from "../parse/figures";
import {
  analyzeEntry,
  detectInTextStyle,
  parseReferences,
} from "../parse/references";
import { detectAccessions, detectFeatures, detectPhraseHits, classifyGeneration, sentenceAround } from "../parse/features";
import { indexLines, normalizeText } from "../parse/text-utils";

/** Convenience: run heading detection the way buildManuscriptModel does. */
function structure(text: string) {
  const lines = indexLines(text);
  const first = detectStructure(text, lines);
  const labels = parseFiguresAndTables(text, lines, first.outline);
  return { lines, ...detectStructure(text, lines, { labelLines: labels.labelLines }) };
}

// ============================================================
// Figure legends, tables, supplemental items
// ============================================================
describe("parseFiguresAndTables", () => {
  const cellStyle = normalizeText(
    [
      "Results",
      "Widget density rose.",
      "Discussion",
      "Widgets are useful.",
      "Figure 1. Widget density under load.",
      "(A) Density per reactor. Data are represented as mean ± SEM. *P < 0.05, two-tailed",
      "Student's t-test. Scale bar, 10 µm. See also Figure S1 and Table S1.",
      "Figure 2. Cooling curves.",
      "(A) Curves per run. Error bars indicate s.d.",
      "Table 1. Reactor parameters.",
      "Supplementary Fig. 1. Extra density measurements.",
      "Table S1. Primer sequences, Related to Figure 1 and STAR Methods.",
      "Video S1. Reactor assembly, Related to Figure 2.",
      "STAR Methods",
      "Widgets were counted by hand.",
    ].join("\n")
  );

  it("parses a Cell-style legend with all flags", () => {
    const { lines, outline } = structure(cellStyle);
    const parsed = parseFiguresAndTables(cellStyle, lines, outline);
    const first = parsed.figureLegends.find((l) => l.number === "1");
    expect(first).toBeDefined();
    expect(first?.label).toBe("Figure 1.");
    expect(first?.title).toBe("Widget density under load.");
    expect(first?.definesErrorBars).toBe(true);
    expect(first?.namesStatisticalTest).toBe(true);
    expect(first?.definesAsterisks).toBe(true);
    expect(first?.mentionsScaleBar).toBe(true);
    expect(first?.seeAlso).toEqual(["Figure S1", "Table S1"]);
  });

  it("flags a legend that defines neither asterisks nor a scale bar", () => {
    const { lines, outline } = structure(cellStyle);
    const parsed = parseFiguresAndTables(cellStyle, lines, outline);
    const second = parsed.figureLegends.find((l) => l.number === "2");
    expect(second?.definesErrorBars).toBe(true);
    expect(second?.definesAsterisks).toBe(false);
    expect(second?.mentionsScaleBar).toBe(false);
    expect(second?.namesStatisticalTest).toBe(false);
  });

  it("parses supplemental items with and without a Related to trailer", () => {
    const { lines, outline } = structure(cellStyle);
    const parsed = parseFiguresAndTables(cellStyle, lines, outline);
    const suppFigure = parsed.supplementalItems.find((s) => s.kind === "figure");
    // "Supplementary Fig. 1." keeps the number as written, without an S.
    expect(suppFigure?.number).toBe("1");
    expect(suppFigure?.relatedTo).toEqual([]);

    const suppTable = parsed.supplementalItems.find((s) => s.kind === "table");
    expect(suppTable?.number).toBe("S1");
    expect(suppTable?.relatedTo).toEqual(["Figure 1", "STAR Methods"]);

    const video = parsed.supplementalItems.find((s) => s.kind === "video");
    expect(video?.number).toBe("S1");
    expect(video?.relatedTo).toEqual(["Figure 2"]);
  });

  it("records main table captions separately from supplemental ones", () => {
    const { lines, outline } = structure(cellStyle);
    const parsed = parseFiguresAndTables(cellStyle, lines, outline);
    const main = parsed.tableCaptions.find((t) => t.number === "1");
    expect(main?.isSupplemental).toBe(false);
    expect(main?.title).toBe("Reactor parameters.");
    expect(parsed.tableCaptions.find((t) => t.number === "S1")?.isSupplemental).toBe(true);
  });

  it("does not take an in-text mention for a legend", () => {
    const text = normalizeText(
      [
        "Results",
        "Density rose under load (Fig. 3a) and fell after cooling.",
        "Fig. 3a), which suggests the module is coupled.",
        "Discussion",
        "Useful.",
      ].join("\n")
    );
    const { lines, outline } = structure(text);
    const parsed = parseFiguresAndTables(text, lines, outline);
    expect(parsed.figureLegends).toHaveLength(0);
  });

  it("collects distinct supplemental mentions in both naming styles", () => {
    const text = normalizeText(
      [
        "Results",
        "Density rose (Supplementary Fig. 1a) and again (Supplementary Fig. 1b).",
        "Cooling held (Figure S2) as did pressure (Table S3).",
      ].join("\n")
    );
    const { lines, outline } = structure(text);
    const parsed = parseFiguresAndTables(text, lines, outline);
    expect(parsed.supplementalMentions).toEqual([
      "Figure S2",
      "Supplementary Figure 1",
      "Table S3",
    ]);
  });

  it("parses item lists with kind inheritance", () => {
    expect(parseItemList("Figure S1 and Table S1")).toEqual(["Figure S1", "Table S1"]);
    expect(parseItemList("Figures S1, S2 and STAR Methods")).toEqual([
      "Figure S1",
      "Figure S2",
      "STAR Methods",
    ]);
  });
});

describe("assessLegendPlacement", () => {
  it("reports interspersed legends for a Nature-style layout", () => {
    const text = normalizeText(
      [
        "Results",
        "Density rose under load.",
        "Fig. 1 | Widget density under load.",
        "a, Density per reactor. Data are mean ± s.e.m.",
        "Cooling improves with density",
        "Cooling improved in every run and continued to improve for the rest of the",
        "experiment, which we repeated three times over several weeks of operation.",
        "Fig. 2 | Cooling curves.",
        "a, Curves per run.",
        "Discussion",
        "Widgets are useful.",
        "Materials and Methods",
        "Widgets were counted by hand.",
      ].join("\n")
    );
    const { lines, outline } = structure(text);
    const parsed = parseFiguresAndTables(text, lines, outline);
    const placement = assessLegendPlacement(text, outline, parsed.figureLegends);
    expect(parsed.figureLegends.map((l) => l.label)).toEqual(["Fig. 1 |", "Fig. 2 |"]);
    expect(placement.legendsInterspersed).toBe(true);
    expect(placement.legendsAfterMainText).toBe(false);
  });

  it("reports one trailing list for a Cell-style layout", () => {
    const text = normalizeText(
      [
        "Results",
        "Density rose under load.",
        "Discussion",
        "Widgets are useful.",
        "Figure 1. Widget density under load.",
        "(A) Density per reactor.",
        "Figure 2. Cooling curves.",
        "(A) Curves per run.",
        "STAR Methods",
        "Widgets were counted by hand.",
      ].join("\n")
    );
    const { lines, outline } = structure(text);
    const parsed = parseFiguresAndTables(text, lines, outline);
    const placement = assessLegendPlacement(text, outline, parsed.figureLegends);
    expect(placement.legendsInterspersed).toBe(false);
    expect(placement.legendsAfterMainText).toBe(true);
  });
});

// ============================================================
// References
// ============================================================
describe("parseReferences", () => {
  it("parses a numbered Nature-style list and its fields", () => {
    const text = normalizeText(
      [
        "Introduction",
        "Widgets matter for cooling1 and for pressure2, 3 in reactors.",
        "Results",
        "Density rose4-6 under load.",
        "References",
        "1. Smith, J., Roe, J. & Doe, A. Widget biogenesis in reactors. J. Widget Res. 23, 445-460 (2024).",
        "2. Roe, J. et al. Cooling by widgets. Nat. Cooling 8, 112-119 (2020).",
        "3. Doe, A. & Smith, J. Pressure limits of widgets. Widget Lett. 4, e12345 (2019).",
      ].join("\n")
    );
    const { lines, outline } = structure(text);
    const refs = parseReferences(text, lines, outline);

    expect(refs.style).toBe("numbered");
    expect(refs.count).toBe(3);
    expect(refs.headingText).toBe("References");
    expect(refs.inTextStyle).toBe("superscript-numeric");
    expect(refs.entries.every((e) => e.hasYear)).toBe(true);
    expect(refs.entries.every((e) => e.hasTitle)).toBe(true);
    expect(refs.entries.every((e) => e.hasJournal)).toBe(true);
    expect(refs.entries.every((e) => e.hasVolume)).toBe(true);
    expect(refs.entries.every((e) => e.hasPages)).toBe(true);
    // No DOIs anywhere in the list.
    expect(refs.entries.some((e) => e.hasDoi)).toBe(false);
    expect(refs.entries[0].authorCount).toBe(3);
    expect(refs.entries[1].usesEtAl).toBe(true);
    expect(refs.separateSupplementalList).toBe(false);
  });

  it("parses an author-year list with DOIs", () => {
    const text = normalizeText(
      [
        "Introduction",
        "Widgets matter (Smith et al., 2024) and cool well (Roe and Doe, 2020; Doe, 2019).",
        "References",
        "Doe, A. (2019). Pressure limits of widgets. Widget Letters 4, e12345. https://doi.org/10.1016/j.wl.2019.01.001.",
        "Roe, J., and Doe, A. (2020). Cooling by widgets. Nature Cooling 8, 112-119. https://doi.org/10.1038/s41586-020-1234-5.",
        "Smith, J., Roe, J., and Doe, A. (2024). Widget biogenesis in reactors. Journal of Widget Research 23, 445-460.",
      ].join("\n")
    );
    const { lines, outline } = structure(text);
    const refs = parseReferences(text, lines, outline);

    expect(refs.style).toBe("author-year");
    expect(refs.count).toBe(3);
    expect(refs.inTextStyle).toBe("author-year");
    expect(refs.entries.filter((e) => e.hasDoi)).toHaveLength(2);
    expect(refs.entries.every((e) => e.hasTitle)).toBe(true);
    expect(refs.entries.every((e) => e.hasJournal)).toBe(true);
  });

  it("detects bracketed in-text citations", () => {
    expect(detectInTextStyle("Widgets matter [1] and cool [2, 3] well [4-6].")).toBe(
      "bracketed-numeric"
    );
  });

  it("flags in-press and unpublished entries", () => {
    const entry = analyzeEntry(1, "Smith, J. Widgets in reactors. J. Widget Res. (in press).");
    expect(entry.isInPressOrUnpublished).toBe(true);
    const normal = analyzeEntry(2, "Roe, J. Cooling. Nat. Cooling 8, 112-119 (2020).");
    expect(normal.isInPressOrUnpublished).toBe(false);
  });

  it("notices a separate supplemental reference list", () => {
    const text = normalizeText(
      [
        "References",
        "1. Smith, J. Widgets. J. Widget Res. 1, 1-2 (2020).",
        "2. Roe, J. Cooling. Nat. Cooling 2, 3-4 (2021).",
        "3. Doe, A. Pressure. Widget Lett. 3, 5-6 (2022).",
        "Supplemental references",
        "1. Smith, J. Widgets again. J. Widget Res. 4, 7-8 (2023).",
      ].join("\n")
    );
    const { lines, outline } = structure(text);
    expect(parseReferences(text, lines, outline).separateSupplementalList).toBe(true);
  });
});

// ============================================================
// Features, accessions, phrases
// ============================================================
describe("detectFeatures", () => {
  const text = [
    "We performed bulk RNA-seq and single-cell RNA sequencing of reactor samples.",
    "Proteomics was done by LC-MS. Western blot analysis used a protein ladder with kDa markers.",
    "Confocal microscopy images show a scale bar of 10 um.",
    "Female and male mice aged 8 weeks old were used, as were samples from patients.",
    "Data are mean ± SEM; *P < 0.05. Custom code is available on GitHub.",
  ].join("\n");

  it("flags the features that are present", () => {
    const features = detectFeatures(text);
    for (const key of [
      "rnaSeq",
      "proteomics",
      "blotsOrGels",
      "micrographs",
      "errorBars",
      "asterisks",
      "vertebrates",
      "humans",
      "customCode",
      "sexReported",
      "ageReported",
      "molecularWeightMarkers",
    ] as const) {
      expect(features[key].present, key).toBe(true);
      expect(features[key].evidence.length, key).toBeGreaterThan(0);
    }
  });

  it("leaves absent features alone", () => {
    const features = detectFeatures(text);
    for (const key of [
      "microarray",
      "proteinStructure",
      "novelCompounds",
      "equations",
      "videos",
      "clinicalTrial",
      "batteriesOrPV",
      "devices",
    ] as const) {
      expect(features[key].present, key).toBe(false);
      expect(features[key].evidence, key).toEqual([]);
    }
  });

  it("does not call a DNA-damage sensor a device", () => {
    expect(detectFeatures("ATM is a DNA damage sensor in reactors.").devices.present).toBe(false);
  });

  it("tells data the paper generated from public data it only reanalysed", () => {
    // Reuse wording only: survival cohorts from a public resource.
    const reused = detectFeatures("Lung cancer microarray cohorts (probe 1234_at) were analysed with the Kaplan-Meier Plotter. Expression data were downloaded from GEO.");
    expect(reused.microarray).toMatchObject({ present: true, generated: false });
    // Generation wording wins when present in its own sentence.
    const generated = detectFeatures("We performed single-cell RNA sequencing of reactor samples. Raw data were deposited in the GSA (accession CRA000001).");
    expect(generated.rnaSeq).toMatchObject({ present: true, generated: true });
    // Mixed paper: a reused cohort and newly generated data of the same kind -> generated.
    const mixed = detectFeatures("Public microarray cohorts were downloaded from GEO. In addition, we performed microarray profiling on sorted cells.");
    expect(mixed.microarray.generated).toBe(true);
    // No cue either way and no structural context: assume generated (a missed deposition is the costlier error).
    expect(detectFeatures("Proteomics identified 400 proteins.").proteomics.generated).toBe(true);
    // The bare passive is not a generation cue: it reports other people's work as often as the authors' own.
    expect(detectFeatures("Public microarray cohorts were downloaded from GEO. Microarray profiling was performed on sorted cells.").microarray.generated).toBe(false);
    // Non-deposition features mirror `present`.
    expect(detectFeatures("Western blot analysis.").blotsOrGels.generated).toBe(true);
    expect(detectFeatures("Nothing here.").microarray).toMatchObject({ present: false, generated: false });
    // Reuse and generation cues in ONE sentence: the reuse wording wins for that sentence.
    expect(classifyGeneration("Data were collected from GEO cohorts.", [{ start: 0, end: 4 }])).toBe(false);
  });

  it("counts data as generated only in a methods-like section or with first-person wording", () => {
    const intro = "Introduction\nRNA-seq has revealed widespread splicing changes in reactors. Proteomics has been applied to the same question.";
    const methods = "Materials and Methods\nRNA-seq libraries were prepared from reactor samples and sequenced on a NovaSeq.";
    const text = `${intro}\n\n${methods}`;
    const methodsSpans = [{ start: text.indexOf("Materials and Methods"), end: text.length }];

    // Background mention in the Introduction: not generated; the same words in Methods: generated.
    const f = detectFeatures(text, { methodsSpans });
    expect(f.rnaSeq.generated).toBe(true);
    expect(f.proteomics).toMatchObject({ present: true, generated: false });

    // First-person / "in this study" / deposition wording counts anywhere in the text.
    const firstPerson = `${intro} We performed proteomics on 20 reactors.`;
    expect(detectFeatures(firstPerson, { methodsSpans: [{ start: firstPerson.length - 1, end: firstPerson.length }] }).proteomics.generated).toBe(true);
    const inThisStudy = "Discussion\nThe RNA-seq data generated in this study support the model.";
    expect(classifyGeneration(inThisStudy, [{ start: inThisStudy.indexOf("RNA-seq"), end: inThisStudy.indexOf("RNA-seq") + 7 }], { methodsSpans: [{ start: 0, end: 10 }] })).toBe(true);
    const deposited = "Discussion\nOur RNA-seq data have been deposited at GEO.";
    expect(classifyGeneration(deposited, [{ start: deposited.indexOf("RNA-seq"), end: deposited.indexOf("RNA-seq") + 7 }], { methodsSpans: [{ start: 0, end: 10 }] })).toBe(true);

    // Reuse wording wins even inside the methods section.
    const reusedMethods = "Methods\nRNA-seq data were downloaded from GEO and re-analysed.";
    expect(detectFeatures(reusedMethods, { methodsSpans: [{ start: 0, end: reusedMethods.length }] }).rnaSeq.generated).toBe(false);

    // No methods-like section at all (a review): nothing is generated, whatever the wording.
    const review = "Introduction\nRNA-seq has been detected in 12 studies. Sequencing has revealed new alleles. We performed a literature search of proteomics studies. Microarray data, GenBank sequences and crystal structures (PDB) are discussed.";
    const none = detectFeatures(review, { methodsSpans: [] });
    for (const key of ["rnaSeq", "proteomics", "microarray", "proteinStructure", "geneSequences"] as const) {
      expect(none[key].present, key).toBe(true);
      expect(none[key].generated, key).toBe(false);
    }
    // Non-depositable features still mirror `present`.
    expect(detectFeatures("Western blot analysis of mice.", { methodsSpans: [] }).blotsOrGels.generated).toBe(true);
  });

  it("sentenceAround isolates the sentence of a match", () => {
    const text = "First sentence here. The microarray data were downloaded from GEO. Last one.";
    const i = text.indexOf("microarray");
    expect(sentenceAround(text, i, i + 10)).toBe("The microarray data were downloaded from GEO.");
  });
});

describe("detectAccessions", () => {
  it("recognises repository accessions and names the repository", () => {
    const text = [
      "Sequencing data are at GEO (GSE123456) and SRA (PRJNA123456).",
      "Proteomics data are at PRIDE (PXD001234).",
      "Raw reads are in the Genome Sequence Archive (CRA047080) and OMIX (OMIX018925).",
      "Structures are in the PDB: 7ABC. Code is at https://doi.org/10.5281/zenodo.1234567.",
    ].join("\n");
    const accessions = detectAccessions(text);
    const byId = Object.fromEntries(accessions.map((a) => [a.id, a.repository]));
    expect(byId["GSE123456"]).toBe("GEO");
    expect(byId["PRJNA123456"]).toBe("BioProject");
    expect(byId["PXD001234"]).toBe("PRIDE");
    expect(byId["CRA047080"]).toBe("NGDC Genome Sequence Archive");
    expect(byId["OMIX018925"]).toBe("NGDC OMIX");
    expect(byId["7ABC"]).toBe("PDB");
    expect(byId["10.5281/zenodo.1234567"]).toBe("Zenodo");
    // Spans point back at the text.
    for (const a of accessions) {
      expect(text.slice(a.span.start, a.span.end)).toContain(a.id);
    }
  });

  it("does not invent a PDB id from a bare four-character code", () => {
    expect(detectAccessions("The 4T1C line was cultured in medium.")).toEqual([]);
  });
});

describe("detectPhraseHits", () => {
  it("collects novelty, previously-described and personal-communication phrases", () => {
    const text = [
      "We describe a novel widget and, for the first time, a new mechanism of cooling.",
      "Reactors were assembled as previously described and counted as described previously.",
      "Pressure data are not shown; one result is from a personal communication.",
    ].join("\n");
    const hits = detectPhraseHits(text);
    expect(hits.novelty.map((h) => h.text.toLowerCase())).toEqual([
      "novel",
      "for the first time",
      "new mechanism",
    ]);
    expect(hits.asDescribedPreviously).toHaveLength(2);
    expect(hits.personalCommunication.map((h) => h.text.toLowerCase())).toContain(
      "personal communication"
    );
    expect(hits.novelty[0].context).toContain("novel widget");
  });

  it("does not count the plain word new", () => {
    const hits = detectPhraseHits("We bought a new reactor and new tubing.");
    expect(hits.novelty).toHaveLength(0);
  });
});
