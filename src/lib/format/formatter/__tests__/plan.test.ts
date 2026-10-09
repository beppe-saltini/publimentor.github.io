import { describe, expect, it } from "vitest";
import type { FormatCheckReport } from "@/lib/format/profile";
import { buildLayout, dropSlotHeading, longestIncreasingRun } from "../layout";
import { inferRelatedFigure, seeAlsoSentence } from "../legends";
import { extractAntibodies, extractCellLines, extractMouseStrains, extractPlasmids, extractSoftware, prefillKrtRows } from "../krt";
import { routeMethodsSubsection } from "../methods";
import { collectAuthorActions, planFormatting } from "../plan";
import { normalizeHeading, splitParagraphs } from "../plan-utils";
import { buildDataAndCode, classifyCodeStatement, inferDataTypes, leadContactFromAuthorsLine, markLeadContact, nextFootnoteNumber } from "../statements";
import { iscienceTarget } from "../target-structures";
import type { LayoutSlot } from "../types";
import { features, makeModel, section, statement, suppl } from "./fixtures";

const ids = (slots: LayoutSlot[]) => slots.map((s) => s.slotId);

describe("planFormatting (iScience, offline references)", () => {
  it("assembles the slots in the journal order and inserts the missing mandatory ones", async () => {
    const plan = await planFormatting(makeModel(), iscienceTarget, { repairReferences: false });
    expect(ids(plan.layout!.slots)).toEqual(["summary", "introduction", "results", "discussion", "resource_availability", "limitations", "acknowledgments", "author_contributions", "declaration_of_interests", "figure_legends", "star_methods", "supplemental_titles", "references"]);
    const limitations = plan.layout!.slots.find((s) => s.slotId === "limitations")!;
    expect(limitations.inserted).toBe(true);
    expect(limitations.blocks[0]).toMatchObject({ type: "placeholder" });
    const insertOp = plan.operations.find((o) => o.kind === "insert_section" && o.slotId === "limitations")!;
    expect(insertOp.automatic).toBe(false);
    expect(insertOp.needsAuthorInput).toMatch(/Limitations of the study/);
  });

  it("renames headings to the journal wording", async () => {
    const plan = await planFormatting(makeModel(), iscienceTarget, { repairReferences: false });
    const renames = plan.operations.filter((o) => o.kind === "rename_heading").map((o) => `${o.before}->${o.after}`);
    expect(renames).toContain("Abstract->Summary");
    expect(renames).toContain("Competing interests->Declaration of Interests");
    expect(renames).toContain("Acknowledgements->Acknowledgments");
    expect(renames).toContain("Methods->STAR Methods");
  });

  it("merges the availability statements under Resource Availability and prefills the bullets", async () => {
    const plan = await planFormatting(makeModel(), iscienceTarget, { repairReferences: false });
    const ra = plan.layout!.slots.find((s) => s.slotId === "resource_availability")!;
    expect(ra.children.map((c) => c.heading)).toEqual(["Lead Contact", "Materials Availability", "Data and Code Availability"]);
    const lead = ra.children[0].blocks[0] as { type: string; text: string };
    expect(lead.text).toContain("Jane Doe (jane@example.org)");
    expect(lead.type).toBe("paragraph");
    const dc = ra.children[2].blocks.map((b) => ("text" in b ? b.text : ""));
    expect(dc[0]).toMatch(/^RNA-seq data have been deposited at GEO under accession numbers GSE12345 and are publicly available/);
    expect(dc[1]).toBe("This paper does not report original code.");
    expect(dc[2]).toMatch(/available from the lead contact upon request/);
    expect(plan.operations.some((o) => o.kind === "merge_sections" && /Data availability/.test(o.before || ""))).toBe(true);
    // Materials availability was absent: placeholder + author action.
    expect(ra.children[1].blocks[0].type).toBe("placeholder");
    expect(plan.authorActions.some((a) => a.slotId === "materials_availability")).toBe(true);
  });

  it("collects legends with journal titles and See-also lines, and retitles supplemental items", async () => {
    const model = makeModel();
    model.supplementalItems[0].relatedTo = ["Fig. 1"];
    const plan = await planFormatting(model, iscienceTarget, { repairReferences: false });
    const legends = plan.layout!.slots.find((s) => s.slotId === "figure_legends")!;
    const texts = legends.blocks.map((b) => ("text" in b ? b.text : ""));
    expect(texts[0]).toBe("Figure 1. Widgets control gadgets");
    expect(texts[1]).toMatch(/See also Figure S1\.$/);
    expect(texts[2]).toBe("Figure 2. Sprockets are dispensable");
    expect(plan.operations.some((o) => o.kind === "collect_legends")).toBe(true);
    expect(plan.operations.filter((o) => o.kind === "retitle_legend")).toHaveLength(2);
    const sup = plan.layout!.slots.find((s) => s.slotId === "supplemental_titles")!;
    const supTexts = sup.blocks.map((b) => ("text" in b ? b.text : ""));
    expect(supTexts[0]).toBe("Figure S1. Widgets in detail, Related to Figure 1");
    // Table S1 is cited only in Results near Fig. 2 -> inferred.
    expect(supTexts[1]).toBe("Table S1. Primer sequences, Related to Figure 2");
  });

  it("falls back to a placeholder when the related main item cannot be inferred", async () => {
    const model = makeModel({ supplementalItems: [suppl("video", "1", "Supplementary Video 1. Cells moving.")] });
    const plan = await planFormatting(model, iscienceTarget, { repairReferences: false });
    const sup = plan.layout!.slots.find((s) => s.slotId === "supplemental_titles")!;
    expect(sup.blocks[0]).toMatchObject({ type: "placeholder", text: "Video S1. Cells moving, Related to [Figure N / STAR Methods]" });
    expect(plan.authorActions.some((a) => /Video S1/.test(a.text))).toBe(true);
  });

  it("builds STAR Methods with a prefilled KRT and routed subsections", async () => {
    const plan = await planFormatting(makeModel(), iscienceTarget, { repairReferences: false });
    const star = plan.layout!.slots.find((s) => s.slotId === "star_methods")!;
    expect(star.children.map((c) => c.slotId)).toEqual(["krt", "experimental_model", "method_details", "quantification"]);
    const table = star.children[0].blocks[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") return;
    const cells = table.rows.filter((r) => r.cells).map((r) => r.cells!.join("|"));
    expect(cells).toContain("[Data type] data|This paper|GEO: GSE12345");
    expect(cells.some((c) => c.startsWith("4T1|ATCC|ATCC CRL-2539"))).toBe(true);
    expect(cells.some((c) => /^Mouse: BALB\/c\|Vital River/.test(c))).toBe(true);
    expect(cells.some((c) => /anti-CD8 antibody \(clone 53-6.7\)\|BioLegend\|Cat# 100708/.test(c))).toBe(true);
    expect(cells.some((c) => /pLKO.1\|Addgene\|Addgene #8453/.test(c))).toBe(true);
    expect(cells.some((c) => /GraphPad Prism v9/.test(c))).toBe(true);
    expect(table.rows.filter((r) => r.group)).toHaveLength(12);
    const model = star.children[1];
    expect(model.blocks.filter((b) => b.type === "heading").map((b) => (b as { text: string }).text)).toEqual(["Cell culture", "Mice"]);
    const quant = star.children[3];
    expect(quant.blocks[0]).toMatchObject({ type: "heading", text: "Statistical analysis" });
    expect(plan.operations.some((o) => o.kind === "prefill_krt" && !o.automatic)).toBe(true);
  });

  it("flags summary problems, Nature boilerplate, highlights and in-press references as author actions", async () => {
    const long = Array.from({ length: 160 }, (_, i) => `word${i}`).join(" ");
    const model = makeModel();
    model.summary = { headingText: "Abstract", text: long, wordCount: 160, paragraphCount: 2, containsCitations: true };
    const plan = await planFormatting(model, iscienceTarget, { repairReferences: false });
    const texts = plan.authorActions.map((a) => a.text);
    expect(texts.some((t) => /shorten the Summary to 150 words/.test(t))).toBe(true);
    expect(texts.some((t) => /Highlights/.test(t))).toBe(true);
    expect(texts.some((t) => /in press or unpublished/.test(t))).toBe(true);
    // The Nature-style correspondence line names Jane Doe, so the footnote is added, not requested.
    expect(texts.some((t) => /Lead Contact with a footnote/.test(t))).toBe(false);
    expect(plan.operations.some((o) => o.topic === "lead_contact_footnote" && o.automatic)).toBe(true);
    expect(plan.operations.some((o) => /Dropped the Nature-style "Additional information"/.test(o.description))).toBe(true);
    expect(plan.stats.automatic + plan.stats.needsAuthor).toBe(plan.operations.length);
    // Offline references are rendered in the target style and noted.
    expect(plan.references[0].formatted).toMatch(/^Doe, J., Roe, R., and Poe, E.A. \(2021\)/);
    expect(plan.operations.some((o) => /reformatted offline/.test(o.description))).toBe(true);
  });

  it("adds the AI declaration only when the text mentions generative AI", async () => {
    const without = await planFormatting(makeModel(), iscienceTarget, { repairReferences: false });
    expect(ids(without.layout!.slots)).not.toContain("ai_declaration");
    const model = makeModel();
    model.text += "\nWe used ChatGPT to polish the language.";
    const withAi = await planFormatting(model, iscienceTarget, { repairReferences: false });
    const ai = withAi.layout!.slots.find((s) => s.slotId === "ai_declaration")!;
    expect(ai.inserted).toBe(true);
    expect((ai.blocks[0] as { text: string }).text).toMatch(/\[NAME TOOL \/ SERVICE\]/);
  });

  it("records moves when the source order differs and flags the citation style when needed", async () => {
    const model = makeModel();
    // Put Discussion before Results in the source.
    const [abstract, intro, results, discussion, ...rest] = model.sections;
    model.sections = [abstract, intro, discussion, results, ...rest];
    const tmp = results.span;
    results.span = discussion.span;
    discussion.span = tmp;
    model.references.inTextStyle = "bracketed-numeric";
    const plan = await planFormatting(model, iscienceTarget, { repairReferences: false });
    expect(plan.operations.some((o) => o.kind === "move_block" && /Results|Discussion/.test(o.description))).toBe(true);
    expect(plan.operations.some((o) => o.kind === "convert_citations")).toBe(true);
  });

  it("links author actions to open checks of a report and de-duplicates them", async () => {
    const report = {
      profileId: "iscience",
      profileVersion: "1",
      checkedAt: "now",
      results: [
        { checkId: "iscience.sections.limitations", status: "fail", summary: "No Limitations of the study section", evidence: [], confidence: "high", detector: "rule" },
        { checkId: "iscience.summary.length", status: "fail", summary: "Summary too long", evidence: [], confidence: "high", detector: "rule" },
        { checkId: "iscience.summary.heading", status: "fail", summary: "Titled Abstract", evidence: [], confidence: "high", detector: "rule" },
        { checkId: "iscience.file.word", status: "fail", summary: "PDF supplied", evidence: [], confidence: "high", detector: "rule" },
      ],
      summary: {},
      letter: { preamble: "", items: [], text: "" },
      stats: {},
    } as unknown as FormatCheckReport;
    const plan = await planFormatting(makeModel(), iscienceTarget, { repairReferences: false, report });
    const lim = plan.authorActions.find((a) => a.slotId === "limitations")!;
    expect(lim.checkIds).toEqual(["iscience.sections.limitations"]);
    // The Abstract -> Summary rename settles the heading check only, never the length check.
    const rename = plan.operations.find((o) => o.kind === "rename_heading" && o.slotId === "summary")!;
    expect(rename.checkIds).toEqual(["iscience.summary.heading"]);
    expect(plan.operations.some((o) => o.checkIds?.includes("iscience.summary.length"))).toBe(false);
    // The KRT prefill covers deposition failures caused by the missing table, not by missing accessions.
    const depositReport = { ...report, results: [
      { checkId: "iscience.data.rnaseq", status: "fail", summary: "RNA-seq accession codes found (GSE12345) but there is no Key Resources Table to list them in", evidence: [], confidence: "high", detector: "rule" },
      { checkId: "iscience.data.proteomics", status: "fail", summary: "proteomics detected but no matching accession code found", evidence: [], confidence: "high", detector: "rule" },
    ] } as unknown as FormatCheckReport;
    const krtPlan = await planFormatting(makeModel(), iscienceTarget, { repairReferences: false, report: depositReport });
    const krtOp = krtPlan.operations.find((o) => o.kind === "prefill_krt")!;
    expect(krtOp.checkIds).toEqual(["iscience.data.rnaseq"]);
    // Rebuilding a PDF as Word settles the file-format check.
    const pdfOp = plan.operations.find((o) => o.topic === "pdf_to_docx")!;
    expect(pdfOp.automatic).toBe(true);
    expect(pdfOp.checkIds).toEqual(["iscience.file.word"]);
    const dupes = collectAuthorActions([
      { id: "1", kind: "note", automatic: false, description: "a", needsAuthorInput: "Do X.", slotId: "x", checkIds: ["c1"] },
      { id: "2", kind: "note", automatic: false, description: "b", needsAuthorInput: "do x.", checkIds: ["c2"] },
    ]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].checkIds).toEqual(["c1", "c2"]);
  });

  it("works on an almost empty model by inserting placeholders everywhere", async () => {
    const model = makeModel({ sections: [], statements: {}, figureLegends: [], supplementalItems: [], accessions: [], summary: undefined, references: { style: "unknown", count: 0, entries: [], inTextStyle: "unknown", separateSupplementalList: false }, text: "Nothing here." });
    const { layout, operations } = buildLayout(model, iscienceTarget);
    expect(layout.slots.every((s) => s.inserted || s.slotId === "star_methods")).toBe(true);
    expect(operations.filter((o) => o.kind === "insert_section").length).toBeGreaterThanOrEqual(9);
  });
});

describe("helpers", () => {
  it("normalizeHeading strips numbering and punctuation", () => {
    expect(normalizeHeading("2. RESULTS:")).toBe("results");
    expect(normalizeHeading("STAR★Methods")).toBe("star methods");
  });

  it("splitParagraphs handles blank-line and PDF-style bodies", () => {
    expect(splitParagraphs("One.\n\nTwo.")).toEqual(["One.", "Two."]);
    expect(splitParagraphs("A long line that wraps\nand continues here.\nNext paragraph starts.")).toEqual(["A long line that wraps and continues here.", "Next paragraph starts."]);
  });

  it("routes methods subsections and infers data types / code statements", () => {
    expect(routeMethodsSubsection("Mice and tumor models")).toBe("experimental_model");
    expect(routeMethodsSubsection("2.3 Statistical analysis")).toBe("quantification");
    expect(routeMethodsSubsection("Western blotting")).toBe("method_details");
    expect(routeMethodsSubsection("Data availability")).toBe("skip");
    expect(inferDataTypes("Single-cell RNA sequencing, bulk RNA sequencing and proteomic data were deposited")).toBe("Single-cell RNA-seq, bulk RNA-seq and proteomics");
    expect(classifyCodeStatement("Code is available at https://github.com/lab/repo.")).toEqual({ kind: "deposited", url: "https://github.com/lab/repo" });
    expect(classifyCodeStatement("This study did not generate original code.").kind).toBe("none");
  });

  it("buildDataAndCode leaves a placeholder when nothing is known", () => {
    const model = makeModel({ accessions: [], statements: {} });
    const built = buildDataAndCode(model);
    expect(built.needsAuthor).toBe(true);
    expect(built.blocks[0].type).toBe("placeholder");
    const withSection = buildDataAndCode(makeModel({ accessions: [], statements: { dataAvailability: statement("Data availability", "This study did not generate new data.") } }));
    expect((withSection.blocks[0] as { text: string }).text).toBe("This paper does not report original data.");
  });

  it("KRT extractors find identifiers and default unknowns to N/A", () => {
    expect(extractCellLines("HeLa cells were used.")[0]).toMatchObject({ resource: "HeLa", source: "N/A", identifier: "N/A" });
    expect(extractMouseStrains("C57BL/6J mice (Jackson Laboratory)")[0]).toMatchObject({ resource: "Mouse: C57BL/6J", source: "Jackson Laboratory" });
    expect(extractAntibodies("anti-Ki67 (Abcam, Cat# ab15580, RRID: AB_443209)")[0].identifier).toBe("Cat# ab15580; RRID: AB_443209");
    expect(extractPlasmids("Addgene plasmid #12260 was used")[0]).toMatchObject({ resource: "[Plasmid name]", identifier: "Addgene #12260" });
    expect(extractSoftware("Images were analysed in ImageJ 1.53 and R v4.2.1")).toEqual(expect.arrayContaining([expect.objectContaining({ resource: "ImageJ v1.53" }), expect.objectContaining({ resource: "R v4.2.1" })]));
    expect(prefillKrtRows(makeModel({ accessions: [], text: "nothing to see" }), "nothing")).toEqual([]);
  });

  it("legend helpers build See-also sentences and infer related figures", () => {
    expect(seeAlsoSentence(["Figure S1"])).toBe("See also Figure S1.");
    expect(seeAlsoSentence(["Figure S1", "Figure S2", "Table S1"])).toBe("See also Figures S1 and S2 and Table S1.");
    const text = "Output rose (Fig. 3c; Supplementary Fig. 2a). Later (Fig. 3d, Supplementary Fig. 2b) and (Fig. 1a, Supplementary Fig. 2c).";
    expect(inferRelatedFigure(suppl("figure", "2", "x"), text)).toBe("Figure 3");
    expect(inferRelatedFigure(suppl("figure", "9", "x"), text)).toBeUndefined();
  });

  it("longestIncreasingRun keeps the in-order items", () => {
    expect(Array.from(longestIncreasingRun([10, 30, 20, 40])).sort()).toEqual([0, 1, 3]);
  });

  /** A top-level section whose span is placed right after `after` in the source. */
  const sectionAfter = (model: ReturnType<typeof makeModel>, after: string, text: string, body: string) => {
    const anchor = model.sections.find((s) => s.heading.text === after)!;
    const sec = section(text, body);
    sec.span = { start: anchor.span.end + 1, end: anchor.span.end + 1 + text.length + body.length + 2 };
    sec.heading.span = { start: sec.span.start, end: sec.span.start + text.length };
    return sec;
  };

  it("sections unknown to the journal are kept at the end of Discussion with an author action", async () => {
    const model = makeModel();
    model.sections.splice(4, 0, sectionAfter(model, "Discussion", "Perspectives", "Some outlook text."));
    const plan = await planFormatting(model, iscienceTarget, { repairReferences: false });
    const disc = plan.layout!.slots.find((s) => s.slotId === "discussion")!;
    expect(disc.blocks.some((b) => b.type === "heading" && b.text === "Perspectives")).toBe(true);
    expect(plan.authorActions.some((a) => /"Perspectives"/.test(a.text))).toBe(true);
  });

  it("never reports an orphan section that sits after the References heading (reference entries taken for headings)", async () => {
    const model = makeModel();
    const entry = "86. Bartley L. A CRISPR Platform for Rapid";
    model.sections.push(sectionAfter(model, "References", entry, "Gene Editing. J Widgets 12, 1-9 (2020)."));
    model.outline = model.sections.map((s) => s.heading);
    const plan = await planFormatting(model, iscienceTarget, { repairReferences: false });
    const disc = plan.layout!.slots.find((s) => s.slotId === "discussion")!;
    expect(disc.blocks.some((b) => b.type === "heading" && b.text === entry)).toBe(false);
    expect(plan.authorActions.some((a) => /Bartley|integrate or remove/.test(a.text))).toBe(false);
    expect(plan.operations.some((o) => /Bartley/.test(o.description))).toBe(false);
  });
});

describe("title page, figures and subject details (Yu-paper follow-ups)", () => {
  it("marks the inferred lead contact in the author list and adds the footnote line", () => {
    // The fixture's "Additional information" names Jane Doe for correspondence; affiliations use 1 and 2.
    const { layout, operations } = buildLayout(makeModel(), iscienceTarget);
    expect(layout.titlePage.authorsLine).toBe("Jane Doe1,3*, John Roe2, Edgar A. Poe1");
    expect(layout.titlePage.leadContactLine).toBe("3Lead contact");
    expect(layout.titlePage.placeholders.some((p) => /Lead Contact footnote/.test(p))).toBe(false);
    const op = operations.find((o) => o.topic === "lead_contact_footnote")!;
    expect(op.automatic).toBe(true);
    expect(op.after).toContain("Jane Doe1,3*");
  });

  it("falls back to a single starred author, and to a placeholder when nobody can be inferred", () => {
    const model = makeModel({ sections: makeModel().sections.filter((s) => s.heading.text !== "Additional information") });
    model.text = model.text.replace(/Correspondence and requests[^\n]*/g, "");
    const starred = buildLayout(model, iscienceTarget);
    expect(starred.layout.titlePage.leadContactLine).toBe("3Lead contact");
    expect(starred.layout.titlePage.authorsLine).toContain("Jane Doe1,3*");

    const nobody = buildLayout({ ...model, authorsLine: "J. Doe1, J. Roe2" }, iscienceTarget);
    expect(nobody.layout.titlePage.leadContactLine).toBeUndefined();
    expect(nobody.layout.titlePage.placeholders.some((p) => /Lead Contact footnote/.test(p))).toBe(true);
    expect(nobody.operations.some((o) => o.topic === "lead_contact_footnote" && !o.automatic)).toBe(true);
  });

  it("writes the footnote but asks for the marker when the name is known but not in the author list", () => {
    const model = makeModel({ authorsLine: "J. Doe1*, J. Roe2" });
    const { layout, operations } = buildLayout(model, iscienceTarget);
    expect(layout.titlePage.leadContactLine).toBe("3Lead contact (Jane Doe)");
    expect(layout.titlePage.placeholders.some((p) => /Mark Jane Doe with the footnote marker "3"/.test(p))).toBe(true);
    expect(operations.some((o) => o.topic === "lead_contact_footnote" && !o.automatic)).toBe(true);
  });

  it("keeps an existing footnote untouched", () => {
    const { layout, operations } = buildLayout(makeModel({ hasLeadContactFootnote: true }), iscienceTarget);
    expect(layout.titlePage.leadContactLine).toBeUndefined();
    expect(layout.titlePage.authorsLine).toBe("Jane Doe1*, John Roe2, Edgar A. Poe1");
    expect(operations.some((o) => o.topic === "lead_contact_footnote")).toBe(false);
  });

  it("asks for the figures as separate files only when the source is a PDF with legends", () => {
    const pdf = buildLayout(makeModel(), iscienceTarget).operations.find((o) => o.topic === "figures_separate_files");
    expect(pdf).toBeDefined();
    expect(pdf!.automatic).toBe(false);
    expect(pdf!.needsAuthorInput).toMatch(/separate files with high resolution/);
    expect(buildLayout(makeModel({ sourceType: "docx" }), iscienceTarget).operations.some((o) => o.topic === "figures_separate_files")).toBe(false);
    expect(buildLayout(makeModel({ figureLegends: [] }), iscienceTarget).operations.some((o) => o.topic === "figures_separate_files")).toBe(false);
  });

  it("asks for the missing sex/age of subjects, naming only what is missing", () => {
    const neither = buildLayout(makeModel(), iscienceTarget).operations.find((o) => o.topic === "subject_details")!;
    expect(neither.needsAuthorInput).toMatch(/^Please report the sex and age or developmental stage of all animal subjects/);
    const sexOnly = buildLayout(makeModel({ features: features(["vertebrates", "ageReported"]) }), iscienceTarget).operations.find((o) => o.topic === "subject_details")!;
    expect(sexOnly.needsAuthorInput).toMatch(/^Please report the sex of all/);
    expect(buildLayout(makeModel({ features: features(["vertebrates", "ageReported", "sexReported"]) }), iscienceTarget).operations.some((o) => o.topic === "subject_details")).toBe(false);
    expect(buildLayout(makeModel({ features: features(["rnaSeq"]) }), iscienceTarget).operations.some((o) => o.topic === "subject_details")).toBe(false);
  });

  it("does not repeat a slot heading as its own first subheading", () => {
    const model = makeModel();
    const methods = model.sections.find((s) => s.heading.text === "Methods")!;
    methods.children = methods.children.map((c) => (c.heading.text === "Statistical analysis" ? { ...c, heading: { ...c.heading, text: "Quantification and statistical analysis" } } : c));
    const { layout } = buildLayout(model, iscienceTarget);
    const quant = layout.slots.find((s) => s.slotId === "star_methods")!.children.find((c) => c.slotId === "quantification")!;
    expect(quant.blocks.some((b) => b.type === "heading" && /quantification and statistical analysis/i.test(b.text))).toBe(false);
    expect(quant.blocks[0]).toMatchObject({ type: "paragraph" });
    expect(dropSlotHeading([{ type: "heading", text: "Results", level: 2 }, { type: "heading", text: "Other", level: 2 }], "RESULTS")).toEqual([{ type: "heading", text: "Other", level: 2 }]);
  });

  it("lead-contact helpers: starred author, footnote numbering, marker insertion", () => {
    expect(leadContactFromAuthorsLine("Jane Doe1*, John Roe2")).toBe("Jane Doe");
    expect(leadContactFromAuthorsLine("Jane Doe1*, John Roe2*")).toBeUndefined(); // two corresponding authors
    expect(leadContactFromAuthorsLine("Li-Hua Wang1,2†")).toBe("Li-Hua Wang");
    expect(leadContactFromAuthorsLine(undefined)).toBeUndefined();
    expect(nextFootnoteNumber({ authorsLine: "A Bee1,4, C Dee2", affiliations: ["1 X", "2 Y"] })).toBe(5);
    expect(nextFootnoteNumber({ authorsLine: undefined, affiliations: ["X", "Y", "Z"] })).toBe(4);
    expect(markLeadContact("Jane Doe1*, John Roe2", "Jane Doe", "3")).toBe("Jane Doe1,3*, John Roe2");
    expect(markLeadContact("Jane Doe, John Roe", "Jane Doe", "3")).toBe("Jane Doe3, John Roe");
    expect(markLeadContact("J. Doe, J. Roe", "Jane Doe", "3")).toBeUndefined();
  });
});
