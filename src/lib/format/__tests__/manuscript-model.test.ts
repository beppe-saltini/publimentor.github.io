/**
 * End-to-end tests for buildManuscriptModel.
 *
 * Two synthetic manuscripts are used: one that follows the Cell Press layout
 * (STAR Methods, legends as one trailing list, required statements) and one in
 * the Nature style (Abstract, interspersed legends, "Competing interests"),
 * which is the shape the checker has to flag. A tiny DOCX is generated with
 * jszip to exercise the Word path.
 */

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { buildManuscriptModel, detectSourceType, excerpt } from "../manuscript-model";
import { htmlToLines } from "../parse/docx";

// ============================================================
// Fixtures
// ============================================================

/** A compliant, Cell-style manuscript. */
const CELL_STYLE = [
  "Widget biogenesis improves reactor cooling",
  "Jane Smith1,3,* and John Roe2",
  "1 Department of Widgets, Example University, City 10001, Country.",
  "2 Institute of Cooling, Second University, Other City 20002, Country.",
  "3 Lead contact",
  "*Correspondence: jane@example.edu (J.S.)",
  "",
  "Summary",
  "Widgets improve reactor cooling in every trial we ran.",
  "",
  "Introduction",
  "Reactors need cooling.",
  "",
  "Results",
  "Widget density rises under load",
  "Density rose in every run (Figure 1).",
  "",
  "Discussion",
  "Widgets are useful.",
  "",
  "Limitations of the study",
  "Only two reactors were tested.",
  "",
  "Acknowledgments",
  "We thank the workshop.",
  "",
  "Author contributions",
  "J.S. designed the study; J.R. ran the reactors.",
  "",
  "Declaration of interests",
  "The authors declare no competing interests.",
  "",
  "Inclusion and diversity",
  "We support inclusive, diverse and equitable research.",
  "",
  "Figure 1. Widget density under load.",
  "(A) Density per reactor. Data are represented as mean ± SEM. *P < 0.05,",
  "two-tailed Student's t-test. Scale bar, 10 µm. See also Figure S1.",
  "",
  "Figure 2. Cooling curves.",
  "(A) Curves per run. Error bars indicate s.d.",
  "",
  "STAR Methods",
  "KEY RESOURCES TABLE",
  "Reagent | Source | Identifier",
  "Anti-widget antibody | Example Bio | AB_123456",
  "",
  "RESOURCE AVAILABILITY",
  "Lead contact",
  "Further information and requests for resources should be directed to the lead",
  "contact, Jane Smith (jane@example.edu).",
  "Materials availability",
  "This study did not generate new unique reagents.",
  "Data and code availability",
  "RNA-seq data have been deposited at GEO under accession GSE123456. Custom code",
  "is available on Zenodo.",
  "",
  "EXPERIMENTAL MODEL AND SUBJECT DETAILS",
  "Female and male mice aged 8 weeks old were housed in pairs. All work was",
  "approved by the Institutional Animal Care and Use Committee of Example",
  "University.",
  "",
  "METHOD DETAILS",
  "Immunoblot analysis used a protein ladder with kDa markers.",
  "",
  "QUANTIFICATION AND STATISTICAL ANALYSIS",
  "Data are mean ± SEM and were compared with two-tailed Student's t-tests.",
  "",
  "ADDITIONAL RESOURCES",
  "The protocol is registered at NCT01234567.",
  "",
  "Supplemental item titles",
  "Figure S1. Extra density measurements, Related to Figure 1.",
  "Table S1. Primer sequences, Related to STAR Methods.",
  "",
  "References",
  "1. Smith, J., Roe, J. & Doe, A. Widget biogenesis. J. Widget Res. 23, 445-460 (2024). https://doi.org/10.1016/j.jwr.2024.01.001.",
  "2. Roe, J. et al. Cooling by widgets. Nat. Cooling 8, 112-119 (2020). https://doi.org/10.1038/s41586-020-1234-5.",
  "3. Doe, A. & Smith, J. Pressure limits. Widget Lett. 4, e12345 (2019). https://doi.org/10.1002/wl.12345.",
].join("\n");

/** A Nature-style manuscript: what the checker must flag. */
const NATURE_STYLE = [
  "Augmenting widget biogenesis potentiates reactor cooling",
  "Jane Smith1 , John Roe2 , Ada Doe1*",
  "1 Department of Widgets, Example University, City 10001, Country.",
  "*Correspondence: jane@example.edu (J.S.)",
  "",
  "Abstract",
  "Cooling can engage widget biogenesis, but how load is converted into cooling",
  "remains unclear. Here we show that widgets matter.",
  "",
  "Introduction",
  "Reactors need cooling.",
  "",
  "Results",
  "Widget density rises under load",
  "Density rose in every run (Fig. 1a) and again under cisplatin.",
  "",
  "Fig. 1 | Widget density under load.",
  "a, Density per reactor. n = 6 reactors per group. Data are mean ± s.e.m. P",
  "values were calculated using two-way ANOVA. Scale bars, 1 cm.",
  "",
  "Cooling improves with density",
  "Cooling improved in every run and continued to improve for the remainder of the",
  "experiment, which we repeated three times over several weeks of operation.",
  "",
  "Fig. 2 | Cooling curves.",
  "a, Curves per run. n = 8 reactors per group.",
  "",
  "Discussion",
  "Widgets are useful.",
  "",
  "Materials and Methods",
  "Mice and tumor models",
  "Female mice were housed in pairs. All procedures were approved by the",
  "Institutional Animal Care and Use Committee of Example University.",
  "Immunoblotting",
  "Immunoblot analysis was performed on reactor lysates.",
  "Quantification and statistical analysis",
  "Data are mean ± s.e.m.",
  "Data availability",
  "RNA-seq data have been deposited under accession CRA047080.",
  "Code availability",
  "Analysis code is available on request.",
  "",
  "Acknowledgements",
  "We thank the workshop.",
  "",
  "Author contributions",
  "J.S. designed the study.",
  "",
  "Competing interests",
  "The authors declare no competing interests.",
  "",
  "Supplementary information",
  "Supplementary Fig. 1. Extra density measurements.",
  "Supplementary Table 1. Primer sequences.",
  "",
  "References",
  "1. Smith, J., Roe, J. & Doe, A. Widget biogenesis. J. Widget Res. 23, 445-460 (2024).",
  "2. Roe, J. et al. Cooling by widgets. Nat. Cooling 8, 112-119 (2020).",
  "3. Doe, A. & Smith, J. Pressure limits. Widget Lett. 4, e12345 (2019).",
].join("\n");

// ============================================================
// Source type detection
// ============================================================
describe("detectSourceType", () => {
  it("sniffs a PDF by its magic bytes", () => {
    expect(detectSourceType({ buffer: Buffer.from("%PDF-1.7\n…") })).toBe("pdf");
  });

  it("sniffs a DOCX by its zip header", () => {
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(detectSourceType({ buffer: zipHeader })).toBe("docx");
  });

  it("falls back to the file name and mime type", () => {
    expect(detectSourceType({ fileName: "paper.pdf" })).toBe("pdf");
    expect(detectSourceType({ fileName: "paper.docx" })).toBe("docx");
    expect(detectSourceType({ text: "plain" })).toBe("text");
  });
});

// ============================================================
// Cell-style manuscript
// ============================================================
describe("buildManuscriptModel — Cell-style manuscript", () => {
  it("models the title page, summary and structure", async () => {
    const model = await buildManuscriptModel({ text: CELL_STYLE, fileName: "compliant.txt" });

    expect(model.sourceType).toBe("text");
    expect(model.fileName).toBe("compliant.txt");
    expect(model.pageCount).toBeUndefined();
    expect(model.title).toBe("Widget biogenesis improves reactor cooling");
    expect(model.affiliations).toHaveLength(2);
    expect(model.correspondingEmails).toEqual(["jane@example.edu"]);
    expect(model.hasLeadContactFootnote).toBe(true);
    expect(model.summary?.headingText).toBe("Summary");
    expect(model.summary?.wordCount).toBe(9);
    expect(model.wordCount).toBeGreaterThan(200);

    const names = model.outline.map((h) => h.normalized);
    expect(names.indexOf("summary")).toBeLessThan(names.indexOf("introduction"));
    expect(names).toContain("star methods");
    expect(names).toContain("references");
  });

  it("finds every required statement under its own heading", async () => {
    const model = await buildManuscriptModel({ text: CELL_STYLE });
    const s = model.statements;
    expect(s.resourceAvailability?.headingText).toBe("RESOURCE AVAILABILITY");
    expect(s.leadContact?.headingText).toBe("Lead contact");
    expect(s.materialsAvailability?.headingText).toBe("Materials availability");
    expect(s.dataAndCodeAvailability?.headingText).toBe("Data and code availability");
    expect(s.limitations?.headingText).toBe("Limitations of the study");
    expect(s.declarationOfInterests?.headingText).toBe("Declaration of interests");
    expect(s.inclusionAndDiversity?.headingText).toBe("Inclusion and diversity");
    expect(s.keyResourcesTable?.headingText).toBe("KEY RESOURCES TABLE");
    expect(s.additionalResources?.headingText).toBe("ADDITIONAL RESOURCES");
    expect(s.ethicsAnimal).toBeDefined();
  });

  it("reports STAR Methods as present with its group headings", async () => {
    const model = await buildManuscriptModel({ text: CELL_STYLE });
    expect(model.starMethods.present).toBe(true);
    expect(model.starMethods.headingText).toBe("STAR Methods");
    expect(model.starMethods.hasKeyResourcesTable).toBe(true);
    expect(model.starMethods.headings).toContain("METHOD DETAILS");
    expect(model.starMethods.headings).toContain("QUANTIFICATION AND STATISTICAL ANALYSIS");
  });

  it("reports legends as one list after the main text", async () => {
    const model = await buildManuscriptModel({ text: CELL_STYLE });
    const main = model.figureLegends.filter((l) => !l.number.startsWith("S"));
    expect(main.map((l) => l.label)).toEqual(["Figure 1.", "Figure 2."]);
    expect(model.legendsInterspersed).toBe(false);
    expect(model.legendsAfterMainText).toBe(true);
    expect(main[0].definesErrorBars).toBe(true);
    expect(main[0].definesAsterisks).toBe(true);
    expect(main[0].mentionsScaleBar).toBe(true);
    expect(main[0].seeAlso).toEqual(["Figure S1"]);
  });

  it("reads supplemental items with their Related to targets", async () => {
    const model = await buildManuscriptModel({ text: CELL_STYLE });
    const figure = model.supplementalItems.find((i) => i.kind === "figure");
    expect(figure?.number).toBe("S1");
    expect(figure?.relatedTo).toEqual(["Figure 1"]);
    const table = model.supplementalItems.find((i) => i.kind === "table");
    expect(table?.relatedTo).toEqual(["STAR Methods"]);
  });

  it("reports references with DOIs and the deposition accession", async () => {
    const model = await buildManuscriptModel({ text: CELL_STYLE });
    expect(model.references.count).toBe(3);
    expect(model.references.style).toBe("numbered");
    expect(model.references.entries.every((e) => e.hasDoi)).toBe(true);
    expect(model.accessions.map((a) => a.repository)).toContain("GEO");
    expect(model.features.rnaSeq.present).toBe(true);
    expect(model.features.customCode.present).toBe(true);
    expect(model.features.molecularWeightMarkers.present).toBe(true);
    expect(model.features.sexReported.present).toBe(true);
    expect(model.features.ageReported.present).toBe(true);
  });
});

// ============================================================
// Nature-style manuscript
// ============================================================
describe("buildManuscriptModel — Nature-style manuscript", () => {
  it("flags the heading, legend and statement differences", async () => {
    const model = await buildManuscriptModel({ text: NATURE_STYLE });

    // Summary is called Abstract.
    expect(model.summary?.headingText).toBe("Abstract");
    // Legends are interspersed and use the "Fig. 1 |" label style.
    expect(model.legendsInterspersed).toBe(true);
    expect(model.legendsAfterMainText).toBe(false);
    expect(model.figureLegends[0].label).toBe("Fig. 1 |");
    // Asterisks are never defined in the legends.
    expect(model.figureLegends.every((l) => !l.definesAsterisks)).toBe(true);
    expect(model.figureLegends[0].definesErrorBars).toBe(true);
    expect(model.figureLegends[0].namesStatisticalTest).toBe(true);

    // No Lead Contact footnote, no Resource Availability, no KRT, no limits.
    expect(model.hasLeadContactFootnote).toBe(false);
    expect(model.statements.resourceAvailability).toBeUndefined();
    expect(model.statements.leadContact).toBeUndefined();
    expect(model.statements.dataAndCodeAvailability).toBeUndefined();
    expect(model.statements.keyResourcesTable).toBeUndefined();
    expect(model.statements.limitations).toBeUndefined();
    expect(model.statements.inclusionAndDiversity).toBeUndefined();
    expect(model.statements.highlights).toBeUndefined();
    // Separate availability statements do exist.
    expect(model.statements.dataAvailability?.headingText).toBe("Data availability");
    expect(model.statements.codeAvailability?.headingText).toBe("Code availability");
    // Declaration of interests is there under the wrong name.
    expect(model.statements.declarationOfInterests?.headingText).toBe("Competing interests");

    // Methods are not STAR-structured.
    expect(model.starMethods.present).toBe(false);
    expect(model.starMethods.headingText).toBe("Materials and Methods");
    expect(model.starMethods.headings).toContain("Quantification and statistical analysis");

    // References carry no DOIs; supplemental items have no "Related to".
    expect(model.references.entries.some((e) => e.hasDoi)).toBe(false);
    expect(model.supplementalItems.every((i) => i.relatedTo.length === 0)).toBe(true);
    expect(model.supplementalItems.map((i) => i.number)).toEqual(["1", "1"]);
    // Blots without a molecular-weight marker.
    expect(model.features.blotsOrGels.present).toBe(true);
    expect(model.features.molecularWeightMarkers.present).toBe(false);
    // Animal work reported without an age.
    expect(model.features.vertebrates.present).toBe(true);
    expect(model.features.sexReported.present).toBe(true);
    expect(model.features.ageReported.present).toBe(false);
    expect(model.accessions[0].repository).toBe("NGDC Genome Sequence Archive");
  });

  it("gives spans that quote back the manuscript", async () => {
    const model = await buildManuscriptModel({ text: NATURE_STYLE });
    const legend = model.figureLegends[0];
    expect(model.text.slice(legend.span.start, legend.span.end)).toContain("Widget density under load");
    expect(excerpt(model, legend.span, 0)).toContain("Fig. 1 |");
    const heading = model.outline.find((h) => h.normalized === "discussion");
    expect(model.text.slice(heading!.span.start, heading!.span.end)).toBe("Discussion");
  });
});

// ============================================================
// DOCX path
// ============================================================

/** Minimal OOXML body with heading styles, a table, equations and changes. */
function wordDocumentXml(): string {
  const heading = (style: string, label: string) =>
    `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${label}</w:t></w:r></w:p>`;
  const para = (textContent: string) => `<w:p><w:r><w:t>${textContent}</w:t></w:r></w:p>`;
  const cell = (textContent: string) =>
    `<w:tc><w:p><w:r><w:t>${textContent}</w:t></w:r></w:p></w:tc>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:o="urn:schemas-microsoft-com:office:office">
  <w:body>
    ${heading("Heading1", "Summary")}
    ${para("Widgets improve reactor cooling in every trial we ran.")}
    ${heading("Heading1", "STAR Methods")}
    ${heading("Heading2", "Key resources table")}
    <w:tbl>
      <w:tr>${cell("Reagent")}${cell("Source")}${cell("Identifier")}</w:tr>
      <w:tr>${cell("Anti-widget antibody")}${cell("Example Bio")}${cell("AB_123456")}</w:tr>
    </w:tbl>
    ${heading("Heading2", "Method details")}
    <w:p><w:r><w:t>Cooling follows the equation</w:t></w:r><m:oMath><m:r><m:t>a=b</m:t></m:r></m:oMath></w:p>
    <w:p><w:r><w:object><o:OLEObject ProgID="Equation.DSMT4" ShapeID="_x0000_i1025"/></w:object></w:r></w:p>
    <w:p><w:r><w:drawing/></w:r></w:p>
    <w:p><w:ins w:id="1" w:author="Editor"><w:r><w:t>Inserted by the editor.</w:t></w:r></w:ins></w:p>
    ${heading("Heading1", "References")}
    ${para("1. Smith, J. Widget biogenesis. J. Widget Res. 23, 445-460 (2024).")}
    ${para("2. Roe, J. et al. Cooling by widgets. Nat. Cooling 8, 112-119 (2020).")}
    ${para("3. Doe, A. &amp; Smith, J. Pressure limits. Widget Lett. 4, e12345 (2019).")}
  </w:body>
</w:document>`;
}

async function buildDocxBuffer(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file("word/document.xml", wordDocumentXml());
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("buildManuscriptModel — review article (no methods)", () => {
  const REVIEW = [
    "Widgets in reactor biology: a review",
    "Jane Smith1 and John Roe2",
    "1 Department of Widgets, Example University, City 10001, Country.",
    "",
    "Summary",
    "We review how widgets shape reactor cooling in mice and patients.",
    "",
    "Introduction",
    "RNA-seq has revealed widespread widget expression in mouse models and in patients with",
    "reactor disease. Proteomics has been applied to the same question, and microarray",
    "studies have detected widgets in every tissue examined. Crystal structures (PDB) exist.",
    "",
    "Discussion",
    "Sequencing has revealed that the loss of widgets has been detected in many lineages.",
    "GenBank sequences of widget homologues are now available for most species.",
    "",
    "Declaration of Interests",
    "The authors declare no competing interests.",
    "",
    "References",
    "1. Smith J, Roe R. Widgets in reactors. J Widgets. 2019;12(3):100-110.",
    "2. Doe A. Cooling without widgets. Reactor Res. 2020;4:1-9.",
    "12. The loss of alleles on chromosome 3 has been detected",
    "in many reactor lineages. Reactor Res. 2020;4:1-9.",
    "86. Bartley L. A CRISPR Platform for Rapid",
    "Reactor Editing. Nat Reactors. 2021;8:55-60.",
    "91. Marignani P. Loss of tumour suppressors",
    "in cooling cells. Cell Cooling. 2018;2:7-8.",
  ].join("\n");

  it("keeps reference entries out of the outline and reports no generated data", async () => {
    const model = await buildManuscriptModel({ text: REVIEW, fileName: "review.txt" });
    expect(model.outline.map((h) => h.normalized)).toEqual(["summary", "introduction", "discussion", "declaration of interests", "references"]);
    expect(model.sections.map((s) => s.heading.normalized)).toEqual(["summary", "introduction", "discussion", "declaration of interests", "references"]);
    expect(model.starMethods.headingText).toBeUndefined();
    // The data types are mentioned, but a review generates none of them.
    for (const key of ["rnaSeq", "proteomics", "microarray", "proteinStructure", "geneSequences"] as const) {
      expect(model.features[key].present, key).toBe(true);
      expect(model.features[key].generated, key).toBe(false);
    }
    // Subjects are mentioned too; the ethics rules decide what that means.
    expect(model.features.vertebrates.present).toBe(true);
    expect(model.features.humans.present).toBe(true);
  });
});

describe("htmlToLines", () => {
  it("keeps heading levels and joins table rows", () => {
    const { lines, explicitHeadings } = htmlToLines(
      "<h1>Summary</h1><p>Widgets matter.</p><h2>Key resources table</h2>" +
        "<table><tr><td><p>Reagent</p></td><td><p>Source</p></td></tr></table>"
    );
    expect(lines).toContain("Reagent | Source");
    const headingTexts = [...explicitHeadings.entries()].map(([idx, level]) => `${level}:${lines[idx]}`);
    expect(headingTexts).toEqual(["1:Summary", "2:Key resources table"]);
  });

  it("decodes entities", () => {
    const { lines } = htmlToLines("<p>Widgets &amp; cooling &#8212; 10&nbsp;µm</p>");
    expect(lines[0]).toBe("Widgets & cooling — 10 µm");
  });
});

describe("buildManuscriptModel — DOCX", () => {
  it("reads headings, tables, equations and tracked changes", async () => {
    const buffer = await buildDocxBuffer();
    const model = await buildManuscriptModel({ buffer, fileName: "final.docx" });

    expect(model.sourceType).toBe("docx");
    expect(model.docx).toBeDefined();
    expect(model.docx?.wordTables).toBe(1);
    expect(model.docx?.ommlEquations).toBe(1);
    expect(model.docx?.mathTypeObjects).toBe(1);
    expect(model.docx?.imagesInBody).toBe(1);
    expect(model.docx?.trackedChanges).toBe(true);
    expect(model.docx?.usesHeadingStyles).toBe(true);

    // Word heading styles drive the outline, so no heuristics are needed.
    expect(model.outline.map((h) => `${h.level}:${h.normalized}`)).toEqual([
      "1:summary",
      "1:star methods",
      "2:key resources table",
      "2:method details",
      "1:references",
    ]);
    expect(model.summary?.wordCount).toBe(9);
    expect(model.starMethods.present).toBe(true);
    expect(model.starMethods.hasKeyResourcesTable).toBe(true);
    expect(model.text).toContain("Anti-widget antibody | Example Bio | AB_123456");
    expect(model.references.style).toBe("numbered");
    expect(model.references.count).toBe(3);
    expect(model.references.entries[1].usesEtAl).toBe(true);
  });
});
