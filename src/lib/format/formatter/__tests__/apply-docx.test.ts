/**
 * End-to-end tests for applyPlanToDocx: every operation kind is applied to a
 * small synthetic .docx and verified through listTrackedChanges (what the
 * reviewer sees), acceptAllChanges (the final text) and the redlining
 * validator (every change is tracked, ids unique). Fixtures are hand-written.
 */
import { describe, expect, it } from "vitest";
import mammoth from "mammoth";
import {
  acceptAllChanges,
  applyPlanToDocx,
  extractParagraphTexts,
  listTrackedChanges,
  orderOperations,
  trackedOutputFileName,
  validateTrackedChanges,
  TRACKED_CHANGES_AUTHOR,
} from "../apply-docx";
import type { FormatOperation, FormatPlan, TargetStructure } from "../types";
import { buildDocx, readDocxPart, STYLES_WITHOUT_HEADINGS, type FixtureParagraph } from "./docx-fixture";

/* ------------------------------------------------------------ fixtures */

/** A small journal spec in the shape of the iScience target (independent of it). */
const target: TargetStructure = {
  profileId: "testjournal",
  fileFormat: "docx",
  slots: [
    { id: "summary", heading: "Summary", level: 1, aliases: ["summary", "abstract"], required: true, kind: "summary" },
    { id: "introduction", heading: "Introduction", level: 1, aliases: ["introduction"], required: true, kind: "body" },
    { id: "results", heading: "Results", level: 1, aliases: ["results"], required: true, kind: "body" },
    { id: "discussion", heading: "Discussion", level: 1, aliases: ["discussion"], required: true, kind: "body" },
    {
      id: "limitations",
      heading: "Limitations of the Study",
      level: 1,
      aliases: ["limitations of the study", "limitations"],
      required: true,
      kind: "statement",
      placeholderTemplate: "[Limitations of the study: a paragraph highlighting the potential caveats of the work.]",
    },
    { id: "data_code", heading: "Data and Code Availability", level: 1, aliases: ["data and code availability"], required: true, kind: "statement" },
    {
      id: "declaration_of_interests",
      heading: "Declaration of Interests",
      level: 1,
      aliases: ["declaration of interests", "competing interests"],
      required: true,
      kind: "statement",
    },
    { id: "figure_legends", heading: "Figure Legends", level: 1, aliases: ["figure legends", "figure captions"], required: true, kind: "legends" },
    {
      id: "star_methods",
      heading: "STAR Methods",
      level: 1,
      aliases: ["star methods", "methods", "materials and methods"],
      required: true,
      kind: "methods",
      children: [
        { id: "krt", heading: "Key Resources Table", level: 2, aliases: ["key resources table"], required: true, kind: "krt" },
        { id: "method_details", heading: "Method Details", level: 2, aliases: ["method details"], required: true, kind: "methods" },
      ],
    },
    { id: "references", heading: "References", level: 1, aliases: ["references", "bibliography"], required: true, kind: "references" },
  ],
  headingRenames: { abstract: "Summary", "competing interests": "Declaration of Interests", "materials and methods": "STAR Methods" },
  legendTitle: { template: "Figure {n}. {title}", label: "Figure", separator: ". " },
  supplementalTitle: {
    figure: "Figure S{n}. {title}",
    table: "Table S{n}. {title}",
    video: "Video S{n}. {title}",
    data: "Data S{n}. {title}",
    scheme: "Scheme S{n}. {title}",
    relatedToTemplate: ", Related to {related}",
  },
  references: { style: "cell-press", citationStyle: "superscript-numeric", etAlAfter: 10, includeDoi: true, doiAsUrl: true },
  summary: { heading: "Summary", maxWords: 150, singleParagraph: true },
  title: { maxChars: 145, noPunctuation: true },
  placeholderStyle: { prefix: "[AUTHOR ACTION NEEDED]", highlight: "yellow" },
  krtTemplate: { headings: ["REAGENT or RESOURCE", "SOURCE", "IDENTIFIER"], rowGroups: ["Antibodies", "Software and algorithms"] },
};

const LEGEND_1 = "Fig. 1 | Synthetic widget assembly. (a) Schematic of the assembly line. (b) Yield per batch; error bars show s.d.";
const REF_1 = "1. Doe, J. & Roe, R. A synthetic study of widgets. J. Synth. Res. 12, 100-110 (2020).";
const REF_1_NEW = "1. Doe, J., and Roe, R. (2020). A synthetic study of widgets. J. Synth. Res. 12, 100-110. https://doi.org/10.1000/synth.2020.1.";

/** Nature-style manuscript: heading styles, legend interspersed in Results. */
const manuscript: FixtureParagraph[] = [
  { text: "A synthetic manuscript about widgets", style: "Title" },
  { text: "Abstract", style: "Heading1" },
  { text: "Widgets are useful. Here we assemble them synthetically." },
  { text: "Introduction", style: "Heading1" },
  { text: "Widgets have a long history in synthetic test fixtures." },
  { text: "Results", style: "Heading1" },
  { text: "Assembly line yield", style: "Heading2" },
  { text: "The assembly line produced widgets at high yield (Fig. 1a)." },
  { text: [{ text: "Fig. 1 | Synthetic widget assembly.", bold: true }, { text: " (a) Schematic of the assembly line. (b) Yield per batch; error bars show s.d." }] },
  { text: "Further results followed." },
  { text: "Discussion", style: "Heading1" },
  { text: "Our widgets compare favourably with earlier widgets." },
  { text: "Materials and Methods", style: "Heading1" },
  { text: "Widgets were assembled as described." },
  { text: "Competing interests", style: "Heading1" },
  { text: "The authors declare no competing interests." },
  { text: "References", style: "Heading1" },
  { text: REF_1 },
  { text: "2. Poe, E. Another synthetic reference. Synth. Lett. 3, 1-2 (2021)." },
];

function op(partial: Partial<FormatOperation> & Pick<FormatOperation, "kind">): FormatOperation {
  return { id: partial.id ?? `op-${partial.kind}`, automatic: true, description: partial.kind, ...partial };
}

function plan(operations: FormatOperation[], references: FormatPlan["references"] = []): FormatPlan {
  return { profileId: target.profileId, targetStructureVersion: "1.0.0", operations, references, authorActions: [], stats: { automatic: operations.length, needsAuthor: 0 } };
}

const FIXED_DATE = new Date("2026-10-09T10:00:00Z");

async function apply(operations: FormatOperation[], paragraphs = manuscript, references: FormatPlan["references"] = []) {
  const original = await buildDocx(paragraphs);
  const result = await applyPlanToDocx(original, plan(operations, references), target, { fileName: "widgets.docx", date: FIXED_DATE });
  return { original, result, changes: await listTrackedChanges(result.buffer), accepted: await extractParagraphTexts(result.buffer) };
}

/* --------------------------------------------------------------- tests */

describe("applyPlanToDocx", () => {
  it("renames a heading as a tracked deletion plus insertion in the same paragraph", async () => {
    const { result, changes, accepted } = await apply([op({ kind: "rename_heading", before: "Abstract", after: "Summary" })]);
    expect(changes).toEqual([
      expect.objectContaining({ type: "del", text: "Abstract", author: TRACKED_CHANGES_AUTHOR }),
      expect.objectContaining({ type: "ins", text: "Summary", author: TRACKED_CHANGES_AUTHOR }),
    ]);
    expect(changes[0].date).toBe("2026-10-09T10:00:00Z");
    expect(accepted).toContain("Summary");
    expect(accepted).not.toContain("Abstract");
    expect(result.applied[0]).toMatchObject({ kind: "rename_heading", status: "applied" });
    // The rename happens inside the original heading paragraph: it keeps its style.
    const xml = (await readDocxPart(result.buffer, "word/document.xml"))!;
    expect(xml).toMatch(/<w:p><w:pPr><w:pStyle w:val="Heading1"\/><\/w:pPr><w:del [^>]*><w:r><w:delText>Abstract<\/w:delText><\/w:r><\/w:del><w:ins [^>]*><w:r><w:t>Summary<\/w:t><\/w:r><\/w:ins><\/w:p>/);
  });

  it("moves an interspersed legend out of Results to the end of the Discussion section", async () => {
    const { changes, accepted } = await apply([op({ kind: "move_block", before: LEGEND_1, after: "Discussion" })]);
    const deleted = changes.filter((c) => c.type === "del").map((c) => c.text).join("");
    const inserted = changes.filter((c) => c.type === "ins").map((c) => c.text).join("");
    expect(deleted).toBe(LEGEND_1);
    expect(inserted).toBe(LEGEND_1);
    const results = accepted.indexOf("Results");
    const discussion = accepted.indexOf("Discussion");
    const methods = accepted.indexOf("Materials and Methods");
    const legend = accepted.indexOf(LEGEND_1);
    expect(legend).toBeGreaterThan(discussion);
    expect(legend).toBeLessThan(methods);
    expect(accepted.slice(results, discussion)).not.toContain(LEGEND_1);
    expect(accepted.filter((t) => t === LEGEND_1)).toHaveLength(1);
  });

  it("moves a whole section to its slot position without duplicating its heading", async () => {
    const { result, accepted, changes } = await apply([
      op({ id: "r", kind: "rename_heading", before: "Materials and Methods", after: "STAR Methods" }),
      op({ id: "m", kind: "move_block", before: "STAR Methods", slotId: "star_methods" }),
    ]);
    expect(result.applied.map((a) => a.status)).toEqual(["applied", "applied"]);
    expect(accepted.filter((t) => t === "STAR Methods")).toHaveLength(1);
    // Slot order: ... declaration_of_interests, figure_legends, star_methods, references.
    const heading = accepted.indexOf("STAR Methods");
    expect(heading).toBeGreaterThan(accepted.indexOf("The authors declare no competing interests."));
    expect(accepted[heading + 1]).toBe("Widgets were assembled as described.");
    expect(accepted[heading + 2]).toBe("References");
    expect(changes.filter((c) => c.type === "del").map((c) => c.text)).toContain("Widgets were assembled as described.");
  });

  it("collects legends into a newly created Figure Legends section placed per the slot order", async () => {
    const withTwoLegends: FixtureParagraph[] = [
      ...manuscript.slice(0, 10),
      { text: "Fig. 2 | Second widget. Another legend." },
      ...manuscript.slice(10),
    ];
    const { result, accepted, changes } = await apply([op({ kind: "collect_legends" })], withTwoLegends);
    expect(result.applied[0]).toMatchObject({ status: "applied", detail: expect.stringContaining("2 legend(s)") });
    // Slot order says "after Declaration of Interests": in this manuscript that is the
    // "Competing interests" section, so the new section lands between it and References.
    const heading = accepted.indexOf("Figure Legends");
    expect(heading).toBeGreaterThan(accepted.indexOf("The authors declare no competing interests."));
    expect(heading).toBeLessThan(accepted.indexOf("References"));
    expect(accepted[heading + 1]).toBe(LEGEND_1);
    expect(accepted[heading + 2]).toBe("Fig. 2 | Second widget. Another legend.");
    expect(changes.some((c) => c.type === "ins" && c.text === "Figure Legends")).toBe(true);
    // Moved copies keep their formatting: the bold title run is still bold.
    const xml = (await readDocxPart(result.buffer, "word/document.xml"))!;
    expect(xml).toMatch(/<w:ins [^>]*><w:r><w:rPr><w:b\/><\/w:rPr><w:t>Fig\. 1 \| Synthetic widget assembly\.<\/w:t><\/w:r>/);
  });

  it("inserts a highlighted placeholder section where the slot order says", async () => {
    const { result, accepted } = await apply([op({ kind: "insert_placeholder", slotId: "limitations", automatic: false })]);
    const heading = accepted.indexOf("Limitations of the Study");
    expect(heading).toBeGreaterThan(accepted.indexOf("Our widgets compare favourably with earlier widgets."));
    expect(accepted[heading + 1]).toBe(target.slots[4].placeholderTemplate);
    const xml = (await readDocxPart(result.buffer, "word/document.xml"))!;
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/><w:rPr><w:ins [^>]*\/><\/w:rPr><\/w:pPr><w:ins [^>]*><w:r><w:t>Limitations of the Study<\/w:t>/);
    expect(xml).toMatch(/<w:rPr><w:highlight w:val="yellow"\/><\/w:rPr><w:t>\[Limitations of the study/);
  });

  it("inserts prefilled content into an existing section and highlights only bracketed tokens", async () => {
    const text = "Further information should be directed to the lead contact, [NAME] ([EMAIL]).";
    const { result, accepted } = await apply([op({ kind: "insert_section", slotId: "introduction", after: text })]);
    expect(accepted[accepted.indexOf("Introduction") + 1]).toBe(text);
    const xml = (await readDocxPart(result.buffer, "word/document.xml"))!;
    expect(xml).toMatch(/<w:r><w:rPr><w:highlight w:val="yellow"\/><\/w:rPr><w:t>\[NAME\]<\/w:t><\/w:r>/);
    expect(xml).toMatch(/<w:r><w:t xml:space="preserve">Further information should be directed to the lead contact, <\/w:t><\/w:r>/);
  });

  it("replaces a reference paragraph with the journal-style rendering", async () => {
    const { changes, accepted } = await apply([op({ kind: "rewrite_reference", before: REF_1, after: REF_1_NEW })]);
    expect(accepted).toContain(REF_1_NEW);
    expect(accepted).not.toContain(REF_1);
    expect(changes.filter((c) => c.type === "del").map((c) => c.text).join("")).toContain("& Roe, R. A synthetic study");
    expect(changes.filter((c) => c.type === "ins").map((c) => c.text).join("")).toContain("https://doi.org/10.1000/synth.2020.1");
  });

  it("falls back to plan.references when a rewrite_reference has no before text", async () => {
    const references = [{ index: 1, original: REF_1, formatted: REF_1_NEW, matched: true, confidence: 0.95, fields: { authors: [] } }];
    const { accepted } = await apply([op({ kind: "rewrite_reference", after: REF_1_NEW })], manuscript, references);
    expect(accepted).toContain(REF_1_NEW);
  });

  it("retitles a legend and appends a see-also note inside the matched paragraph", async () => {
    const retitled = LEGEND_1.replace("Fig. 1 | Synthetic widget assembly.", "Figure 1. Synthetic widget assembly.");
    const { changes, accepted, result } = await apply([
      op({ id: "a", kind: "retitle_legend", before: "Fig. 1 | Synthetic widget assembly.", after: "Figure 1. Synthetic widget assembly." }),
      op({ id: "b", kind: "add_see_also", before: LEGEND_1, after: `${LEGEND_1} See also Figure S1.` }),
    ]);
    expect(result.applied.map((a) => a.status)).toEqual(["applied", "applied"]);
    expect(accepted).toContain(`${retitled} See also Figure S1.`);
    // The retitle touches only the title words; the see-also is appended even though the
    // operation quotes the pre-retitle text.
    expect(changes.map((c) => `${c.type}:${c.text}`)).toEqual(["del:Fig. 1 |", "ins:Figure 1.", "ins: See also Figure S1."]);
  });

  it("merges a section into another and dissolves its heading", async () => {
    const { accepted, changes } = await apply([op({ kind: "merge_sections", before: "Materials and Methods", slotId: "star_methods" })]);
    // No STAR Methods heading exists, so one is created at the slot position and the body moves under it.
    expect(accepted).not.toContain("Materials and Methods");
    const heading = accepted.indexOf("STAR Methods");
    expect(heading).toBeGreaterThan(-1);
    expect(accepted[heading + 1]).toBe("Widgets were assembled as described.");
    expect(changes.some((c) => c.type === "del" && c.text === "Materials and Methods")).toBe(true);
  });

  it("inserts the Key Resources Table skeleton as a tracked table under STAR Methods", async () => {
    const { result, accepted } = await apply([
      op({ id: "r", kind: "rename_heading", before: "Materials and Methods", after: "STAR Methods" }),
      op({ id: "k", kind: "prefill_krt" }),
    ]);
    expect(result.applied.map((a) => a.status)).toEqual(["applied", "applied"]);
    const xml = (await readDocxPart(result.buffer, "word/document.xml"))!;
    expect(xml).toMatch(/<w:tbl>.*<w:trPr><w:ins [^>]*\/><\/w:trPr>/);
    expect(accepted.indexOf("Key Resources Table")).toBe(accepted.indexOf("STAR Methods") + 1);
    expect(accepted).toContain("REAGENT or RESOURCE");
    expect(accepted).toContain("Antibodies");
  });

  it("logs operations whose text cannot be found as skipped and leaves the text unchanged", async () => {
    const { result, changes, accepted } = await apply([
      op({ id: "x", kind: "rename_heading", before: "Nonexistent heading", after: "Whatever" }),
      op({ id: "n", kind: "note", automatic: false, description: "Please supply highlights.", needsAuthorInput: "Please supply highlights." }),
    ]);
    expect(result.applied).toEqual([
      expect.objectContaining({ opId: "x", status: "skipped" }),
      expect.objectContaining({ opId: "n", status: "manual" }),
    ]);
    expect(changes).toEqual([]);
    expect(accepted).toEqual(await extractParagraphTexts(await buildDocx(manuscript)));
    expect(result.stats).toMatchObject({ applied: 0, skipped: 1, manual: 1 });
  });

  it("keeps untouched paragraphs byte-identical and the package convertible by mammoth", async () => {
    const { original, result } = await apply([
      op({ id: "a", kind: "rename_heading", before: "Abstract", after: "Summary" }),
      op({ id: "b", kind: "rewrite_reference", before: REF_1, after: REF_1_NEW }),
    ]);
    const before = (await readDocxPart(original, "word/document.xml"))!;
    const after = (await readDocxPart(result.buffer, "word/document.xml"))!;
    const paragraphsOf = (xml: string) => xml.match(/<w:p>.*?<\/w:p>/g) ?? [];
    const untouched = paragraphsOf(before).filter((p) => !p.includes("Abstract") && !p.includes("Doe, J."));
    expect(untouched.length).toBeGreaterThan(10);
    for (const p of untouched) expect(after).toContain(p);
    expect(after.startsWith(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document`)).toBe(true);
    expect(after).not.toMatch(/<w:body>.*xmlns:w=/);
    expect(await readDocxPart(result.buffer, "word/styles.xml")).toBe(await readDocxPart(original, "word/styles.xml"));

    const html = await mammoth.convertToHtml({ buffer: result.buffer });
    expect(html.value).toContain("Summary");
    expect(html.value).toContain("Introduction");
    expect(result.fileName).toBe("widgets-testjournal-tracked.docx");
    expect(result.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("passes the redlining validator: unique ids, dated, and no untracked text change", async () => {
    const { original, result } = await apply([
      op({ id: "a", kind: "rename_heading", before: "Abstract", after: "Summary" }),
      op({ id: "b", kind: "rename_heading", before: "Competing interests", after: "Declaration of Interests" }),
      op({ id: "c", kind: "collect_legends" }),
      op({ id: "d", kind: "insert_placeholder", slotId: "limitations", automatic: false }),
      op({ id: "e", kind: "rewrite_reference", before: REF_1, after: REF_1_NEW }),
      op({ id: "f", kind: "prefill_krt" }),
    ]);
    const validation = await validateTrackedChanges(original, result.buffer, TRACKED_CHANGES_AUTHOR);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(validation.changeCount).toBeGreaterThan(10);
    // Accepting everything yields the journal order for the touched parts.
    const accepted = await extractParagraphTexts(await acceptAllChanges(result.buffer));
    expect(accepted.indexOf("Summary")).toBe(1);
    expect(accepted.indexOf("Limitations of the Study")).toBeGreaterThan(accepted.indexOf("Discussion"));
    expect(accepted.indexOf("Figure Legends")).toBeGreaterThan(accepted.indexOf("Declaration of Interests"));
    // "Materials and Methods" is an alias of the STAR Methods slot, so the KRT opens that section.
    expect(accepted.indexOf("Key Resources Table")).toBe(accepted.indexOf("Materials and Methods") + 1);
  });

  it("detects an untracked edit (validator negative case)", async () => {
    const original = await buildDocx(manuscript);
    const tampered = await buildDocx(manuscript.map((p) => (p.text === "Further results followed." ? { text: "Silently edited." } : p)));
    const validation = await validateTrackedChanges(original, tampered, TRACKED_CHANGES_AUTHOR);
    expect(validation.ok).toBe(false);
    expect(validation.errors[0]).toContain("untracked text change");
  });

  it("works on documents without heading styles: bold pseudo-headings, fragmented runs, styles added", async () => {
    const boldDoc: FixtureParagraph[] = [
      { text: [{ text: "Abs", bold: true }, { text: "tract", bold: true }] },
      { text: "Widgets are useful." },
      { text: [{ text: "Results", bold: true }], rawBeforeRuns: '<w:proofErr w:type="spellStart"/>' },
      { text: [{ text: "Yield", bold: true }] },
      { text: "High yield was observed." },
      { text: "Fig. 1 | A legend. Body of the legend." },
      { text: [{ text: "Discussion", bold: true }] },
      { text: "We discuss." },
      { text: [{ text: "References", bold: true }] },
      { text: REF_1 },
    ];
    const original = await buildDocx(boldDoc, { stylesXml: STYLES_WITHOUT_HEADINGS });
    const result = await applyPlanToDocx(
      original,
      plan([
        op({ id: "a", kind: "rename_heading", before: "Abstract", after: "Summary" }),
        op({ id: "b", kind: "collect_legends" }),
      ]),
      target,
      { date: FIXED_DATE }
    );
    expect(result.stats.runsMerged).toBe(1);
    expect(result.applied.map((a) => a.status)).toEqual(["applied", "applied"]);
    const accepted = await extractParagraphTexts(result.buffer);
    expect(accepted[0]).toBe("Summary");
    // "Yield" is a bold subsection title (level 2), so the Results section runs to "Discussion";
    // the legends section is created after Discussion (next existing slot in order is References).
    expect(accepted.indexOf("Figure Legends")).toBe(accepted.indexOf("References") - 2);
    expect(accepted[accepted.indexOf("Figure Legends") + 1]).toBe("Fig. 1 | A legend. Body of the legend.");
    const styles = (await readDocxPart(result.buffer, "word/styles.xml"))!;
    expect(styles).toContain('w:styleId="Heading1"');
    expect(styles).toContain('w:styleId="Heading2"');
    expect(styles.startsWith(STYLES_WITHOUT_HEADINGS.slice(0, 120))).toBe(true);
    const xml = (await readDocxPart(result.buffer, "word/document.xml"))!;
    expect(xml).not.toContain("proofErr");
    expect((await validateTrackedChanges(original, result.buffer, TRACKED_CHANGES_AUTHOR)).ok).toBe(true);
  });

  it("creates styles.xml (and registers it) when the package has none", async () => {
    const original = await buildDocx(manuscript.slice(1, 6), { stylesXml: null });
    const result = await applyPlanToDocx(original, plan([op({ kind: "insert_placeholder", slotId: "limitations", automatic: false })]), target);
    expect(await readDocxPart(result.buffer, "word/styles.xml")).toContain('w:styleId="Heading1"');
    expect(await readDocxPart(result.buffer, "word/_rels/document.xml.rels")).toContain('Target="styles.xml"');
    expect(await readDocxPart(result.buffer, "[Content_Types].xml")).toContain('PartName="/word/styles.xml"');
  });

  describe("planner field conventions", () => {
    it("retitles a legend quoted as a truncated snippet by editing only its head", async () => {
      const { changes, accepted } = await apply([
        op({ kind: "retitle_legend", before: "Fig. 1 | Synthetic widget assembly. (a) Schematic of the asse\u2026", after: "Figure 1. Synthetic widget assembly" }),
      ]);
      expect(changes.map((c) => `${c.type}:${c.text}`)).toEqual(["del:Fig. 1 |", "ins:Figure 1."]);
      expect(accepted).toContain(LEGEND_1.replace("Fig. 1 |", "Figure 1."));
    });

    it("retitles a title-only legend line when the snippet runs into the next paragraph", async () => {
      const doc: FixtureParagraph[] = [
        ...manuscript.slice(0, 8),
        { text: [{ text: "Fig. 3 | Widgets under stress.", bold: true }] },
        { text: "a, Survival under heat. b, Survival under cold." },
        ...manuscript.slice(8),
      ];
      const { changes, accepted, result } = await apply(
        [op({ kind: "retitle_legend", before: "Fig. 3 | Widgets under stress. a, Survival under heat. b, Surviv\u2026", after: "Figure 3. Widgets under stress" })],
        doc
      );
      expect(result.applied[0].status).toBe("applied");
      expect(changes.map((c) => `${c.type}:${c.text}`)).toEqual(["del:Fig. 3 |", "ins:Figure 3."]);
      expect(accepted).toContain("Figure 3. Widgets under stress.");
      expect(accepted).toContain("a, Survival under heat. b, Survival under cold.");
    });

    it("treats `after` as content to move (not a destination) unless it names a heading exactly", async () => {
      const doc: FixtureParagraph[] = [
        ...manuscript.slice(0, 13),
        { text: "Widgets were assembled as", style: "Heading2" },
        ...manuscript.slice(13),
      ];
      const { result, accepted } = await apply([op({ kind: "move_block", slotId: "method_details", after: "Widgets were assembled as descr\u2026" })], doc);
      expect(result.applied[0].status).toBe("applied");
      expect(accepted[accepted.indexOf("Method Details") + 1]).toBe("Widgets were assembled as described.");
    });

    it("retitles a supplemental item at both ends (label in front, Related-to at the end)", async () => {
      const doc: FixtureParagraph[] = [...manuscript, { text: "Supplementary Information", style: "Heading1" }, { text: "Sparse widgets improve the response to heat." }];
      const { changes, accepted } = await apply(
        [op({ kind: "retitle_supplemental", before: "Sparse widgets improve the response to heat.", after: "Figure S1. Sparse widgets improve the response to heat, Related to Figure 1" })],
        doc
      );
      expect(changes.map((c) => `${c.type}:${c.text}`)).toEqual(["ins:Figure S1. ", "del:heat.", "ins:heat, Related to Figure 1"]);
      expect(accepted).toContain("Figure S1. Sparse widgets improve the response to heat, Related to Figure 1");
    });

    it("moves the section matching a slot to its journal position when only slotId is given", async () => {
      const { result, accepted } = await apply([op({ kind: "move_block", slotId: "star_methods" })]);
      expect(result.applied[0].status).toBe("applied");
      const heading = accepted.indexOf("Materials and Methods");
      expect(accepted[heading - 1]).toBe("The authors declare no competing interests.");
      expect(accepted[heading + 1]).toBe("Widgets were assembled as described.");
      expect(accepted[heading + 2]).toBe("References");
    });

    it("moves a content paragraph into a child slot named by slotId with the text in `after`", async () => {
      const { result, accepted } = await apply([op({ kind: "move_block", slotId: "method_details", after: "Widgets were assembled as descr\u2026" })]);
      expect(result.applied[0]).toMatchObject({ status: "applied" });
      const heading = accepted.indexOf("Method Details");
      expect(accepted[heading - 1]).toBe("Materials and Methods");
      expect(accepted[heading + 1]).toBe("Widgets were assembled as described.");
      expect(accepted[heading + 2]).toBe("Competing interests");
      expect(accepted.filter((t) => t === "Widgets were assembled as described.")).toHaveLength(1);
    });

    it("merges several ' / '-separated sections into one slot", async () => {
      const doc: FixtureParagraph[] = [
        ...manuscript.slice(0, 14),
        { text: "Data availability", style: "Heading1" },
        { text: "Data are deposited at a repository." },
        { text: "Code availability", style: "Heading1" },
        { text: "Code is on a public host." },
        ...manuscript.slice(14),
      ];
      const { accepted, changes } = await apply(
        [op({ kind: "merge_sections", before: "Data availability / Code availability", after: "Lead Contact / Data and Code Availability", slotId: "data_code" })],
        doc
      );
      expect(accepted).not.toContain("Data availability");
      expect(accepted).not.toContain("Code availability");
      const heading = accepted.indexOf("Data and Code Availability");
      expect(accepted.slice(heading + 1, heading + 3)).toEqual(["Data are deposited at a repository.", "Code is on a public host."]);
      expect(changes.filter((c) => c.type === "del").map((c) => c.text)).toEqual(expect.arrayContaining(["Data availability", "Code availability"]));
    });

    it("creates only the heading when insert_section's text is the slot heading itself", async () => {
      const { result, accepted } = await apply([op({ kind: "insert_section", slotId: "limitations", after: "Limitations of the Study" })]);
      expect(result.applied[0]).toMatchObject({ status: "applied", detail: expect.stringContaining("0 paragraph(s) created") });
      expect(accepted.filter((t) => t === "Limitations of the Study")).toHaveLength(1);
    });

    it("never moves blocks for operations the planner marked as needing the authors", async () => {
      const { result, changes } = await apply([
        op({ kind: "move_block", before: "A synthetic manuscript about widgets", slotId: "discussion", automatic: false, needsAuthorInput: "Please integrate or remove this section." }),
      ]);
      expect(result.applied[0]).toMatchObject({ status: "manual", detail: "Please integrate or remove this section." });
      expect(changes).toEqual([]);
    });
  });

  it("orders operations text edits -> renames -> structure -> inserts -> KRT", () => {
    const ordered = orderOperations([
      op({ id: "1", kind: "prefill_krt" }),
      op({ id: "2", kind: "insert_placeholder" }),
      op({ id: "3", kind: "move_block" }),
      op({ id: "4", kind: "rename_heading" }),
      op({ id: "5", kind: "retitle_legend" }),
      op({ id: "6", kind: "rewrite_reference" }),
    ]);
    expect(ordered.map((o) => o.id)).toEqual(["5", "6", "4", "3", "2", "1"]);
  });

  it("derives the output file name from the original", () => {
    expect(trackedOutputFileName("My Paper (final).docx", "iscience")).toBe("My_Paper_final_-iscience-tracked.docx");
    expect(trackedOutputFileName("/tmp/x/paper.PDF", "iscience")).toBe("paper-iscience-tracked.docx");
    expect(trackedOutputFileName(undefined, "iscience")).toBe("manuscript-iscience-tracked.docx");
  });
});
