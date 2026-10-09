/**
 * Unit tests for the manuscript parser helpers: PDF cleanup, heading/section
 * detection, the summary block, the title page, the required statements and
 * the methods block.
 *
 * All fixtures are synthetic: short texts written to imitate what unpdf
 * produces for a line-numbered manuscript PDF (no real manuscript content).
 */

import { describe, expect, it } from "vitest";

import { cleanPdfPages } from "../parse/pdf-clean";
import { detectStructure, findHeading, looksLikeCitation, methodsLikeSpans, numberedReferenceRunStart } from "../parse/headings";
import { parseFiguresAndTables } from "../parse/figures";
import {
  parseFrontMatter,
  parseStarMethods,
  parseStatements,
  parseSummary,
} from "../parse/statements";
import { indexLines, normalizeText } from "../parse/text-utils";

/** Convenience: run heading detection the way buildManuscriptModel does. */
function structure(text: string) {
  const lines = indexLines(text);
  const first = detectStructure(text, lines);
  const labels = parseFiguresAndTables(text, lines, first.outline);
  return { lines, ...detectStructure(text, lines, { labelLines: labels.labelLines }) };
}

// ============================================================
// PDF cleanup
// ============================================================
describe("cleanPdfPages", () => {
  it("strips sequential line numbers glued to the end of lines", () => {
    const pages = [
      [
        "1",
        "Widget biogenesis improves cooling in reactors1",
        "Jane Smith1 , John Roe2",
        "1 Department of Widgets, Example University, City, Country.2",
        "Body text starts here and runs to the edge of the measure3",
        "and continues on the following typeset line.4",
      ].join("\n"),
      [
        "2",
        "Abstract5",
        "We report that widgets matter for cooling efficiency in reactors.6",
        "7",
        "Introduction8",
      ].join("\n"),
    ];

    const { text, pageCount, strippedLineNumbers } = cleanPdfPages(pages);

    expect(pageCount).toBe(2);
    expect(strippedLineNumbers).toBeGreaterThanOrEqual(6);
    // Page numbers and line numbers are gone.
    expect(text).toContain("Widget biogenesis improves cooling in reactors\n");
    expect(text).toContain("Abstract\n");
    expect(text).toContain("Introduction");
    expect(text).not.toMatch(/reactors1/);
    // The superscript affiliation marker on the author line is not a line
    // number, so it survives.
    expect(text).toContain("Jane Smith1 , John Roe");
  });

  it("leaves a document without line numbering untouched", () => {
    const pages = [
      ["Widgets and cooling", "We measured 12 reactors in 2023", "Each run lasted 4"].join("\n"),
    ];
    const { text, strippedLineNumbers } = cleanPdfPages(pages);
    expect(strippedLineNumbers).toBe(0);
    expect(text).toContain("12 reactors in 2023");
    expect(text).toContain("Each run lasted 4");
  });

  it("removes a running header repeated across pages", () => {
    const bodies = [
      "Reactors were assembled by hand.",
      "Cooling curves rose steadily.",
      "Density scaled with the applied load.",
      "Pressure stayed within the safe band.",
      "Widgets survived a week of operation.",
      "Every run was repeated three times.",
    ];
    const pages = bodies.map((body, i) =>
      [`${i + 1}`, "Smith et al. Widget biogenesis", body].join("\n")
    );
    const { text, removedRunningHeads } = cleanPdfPages(pages);
    expect(removedRunningHeads).toEqual(["smith et al widget biogenesis"]);
    expect(text).not.toContain("Smith et al. Widget biogenesis");
    expect(text).toContain("Density scaled with the applied load.");
  });

  it("reflows hyphenated and dash-broken line breaks", () => {
    const pages = [
      [
        "The experimental requirement was clear and the require-",
        "ment was met by every damage-",
        "associated marker in the WDG–",
        "GDG5 pathway.",
      ].join("\n"),
    ];
    const { text } = cleanPdfPages(pages);
    // "requirement" appears elsewhere, so the hyphen is dropped…
    expect(text).toContain("requirement was met");
    // …while a genuine compound keeps it.
    expect(text).toContain("damage-associated marker");
    expect(text).toContain("WDG–GDG5 pathway");
  });
});

// ============================================================
// Headings and sections
// ============================================================
describe("detectStructure", () => {
  const text = normalizeText(
    [
      "Widget biogenesis improves cooling",
      "Jane Smith1 and John Roe2",
      "Summary",
      "We show that widgets matter.",
      "Introduction",
      "Reactors need cooling.",
      "Results",
      "Widget density rises under load",
      "Density rose in every run.",
      "Discussion",
      "Widgets are useful.",
      "STAR Methods",
      "KEY RESOURCES TABLE",
      "Reagent | Source | Identifier",
      "RESOURCE AVAILABILITY",
      "Lead contact",
      "Requests go to the lead contact, Jane Smith (jane@example.edu).",
      "METHOD DETAILS",
      "2.1 Reactor assembly",
      "Parts were assembled by hand.",
      "QUANTIFICATION AND STATISTICAL ANALYSIS",
      "Data are mean ± SEM.",
      "References",
      "1. Smith, J. Widgets. J. Widgets 1, 1-2 (2020).",
    ].join("\n")
  );

  it("recovers the section order", () => {
    const { outline } = structure(text);
    const names = outline.map((h) => h.normalized);
    expect(names).toContain("summary");
    expect(names.indexOf("summary")).toBeLessThan(names.indexOf("introduction"));
    expect(names.indexOf("results")).toBeLessThan(names.indexOf("discussion"));
    expect(names).toContain("star methods");
    expect(names).toContain("key resources table");
    expect(names).toContain("quantification and statistical analysis");
    expect(names).toContain("references");
  });

  it("detects sentence-case subheadings and numbered headings", () => {
    const { outline } = structure(text);
    expect(outline.some((h) => h.normalized === "widget density rises under load")).toBe(true);
    const numbered = outline.find((h) => h.text.startsWith("2.1"));
    expect(numbered?.level).toBe(2);
  });

  it("drops title-page lines from the outline", () => {
    const { outline } = structure(text);
    expect(outline.some((h) => h.normalized.startsWith("widget biogenesis improves"))).toBe(false);
  });

  it("nests sections by heading level", () => {
    const { sections } = structure(text);
    const star = sections.find((s) => s.heading.normalized === "star methods");
    expect(star).toBeDefined();
    expect(star?.children.map((c) => c.heading.normalized)).toContain("resource availability");
    const resource = star?.children.find((c) => c.heading.normalized === "resource availability");
    expect(resource?.children.map((c) => c.heading.normalized)).toContain("lead contact");
  });

  it("ignores a wrapped sentence that reads like a section name", () => {
    const fragment = normalizeText(
      ["Summary", "We note that the authors declare no", "competing interests.", "Introduction", "Text."].join("\n")
    );
    const { outline } = structure(fragment);
    expect(outline.some((h) => h.normalized === "competing interests")).toBe(false);
  });
});

describe("detectStructure — reference lists and numbered headings", () => {
  const body = [
    "Summary",
    "Widgets matter in reactors.",
    "Introduction",
    "Reactors need cooling and widgets.",
    "Discussion",
    "Widgets remain useful.",
  ];
  const vancouverList = [
    "References",
    "1. Smith J, Roe R. Widgets in reactors. J Widgets. 2019;12(3):100-110.",
    "2. Doe A. Cooling without widgets",
    "12. The loss of alleles on chromosome 3 has been detected",
    "in many reactor lineages. Reactor Res. 2020;4:1-9.",
    "86. Bartley L. A CRISPR Platform for Rapid",
    "Reactor Editing. Nat Reactors. 2021;8:55-60.",
    "91. Marignani P. Loss of tumour suppressors",
    "in cooling cells. Cell Cooling. 2018;2:7-8.",
  ];

  it("never takes a line of the numbered reference list for a section heading", () => {
    const text = normalizeText([...body, ...vancouverList].join("\n"));
    const { outline, sections } = structure(text);
    expect(outline.map((h) => h.normalized)).toEqual(["summary", "introduction", "discussion", "references"]);
    // Everything after References belongs to the References section.
    expect(sections.map((s) => s.heading.normalized)).toEqual(["summary", "introduction", "discussion", "references"]);
    expect(sections[3].body).toContain("91. Marignani P.");
  });

  it("still finds known back-matter headings after the reference list", () => {
    const text = normalizeText(
      [...body, ...vancouverList, "Figure Legends", "Figure 1. Widgets.", "(A) A widget.", "Supplemental Information", "Figure S1. More widgets."].join("\n")
    );
    const { outline } = structure(text);
    const names = outline.map((h) => h.normalized);
    expect(names).toContain("figure legends");
    expect(names).toContain("supplemental information");
    expect(names.some((n) => /bartley|marignani|chromosome/.test(n))).toBe(false);
  });

  it("re-enables numbered headings after a Nature-style Methods section that follows the references", () => {
    const text = normalizeText(
      [...body, ...vancouverList, "Methods", "1. Reactor assembly", "Parts were assembled by hand.", "2. Statistics", "Two-tailed t tests were used."].join("\n")
    );
    const { outline } = structure(text);
    const names = outline.map((h) => h.normalized);
    expect(names).toContain("methods");
    expect(names).toContain("reactor assembly");
    expect(names).toContain("statistics");
    expect(names.some((n) => /bartley|marignani/.test(n))).toBe(false);
  });

  it("rejects numbered lines that read like citations even before the References heading", () => {
    const text = normalizeText(
      [...body, "3. Bartley L. A CRISPR Platform for Rapid", "5. Smith, J. Widgets and their uses", "7. Roe R, Doe A. Cooling. Nature 12:1-9", "9. Cooling has been detected in reactors", "4. Reactor Assembly", "Parts were assembled by hand."].join("\n")
    );
    const { outline } = structure(text);
    const names = outline.map((h) => h.normalized);
    expect(names).toContain("reactor assembly");
    expect(names.some((n) => /bartley|smith|roe|has been detected/.test(n))).toBe(false);
  });

  it("looksLikeCitation recognises author initials, years, volume:pages, DOIs and et al.", () => {
    for (const line of [
      "Bartley L. A CRISPR Platform for Rapid",
      "Liu SY, Chen X. Widgets",
      "Smith, J. Widgets and their uses",
      "Widgets and their uses (2019)",
      "Widgets and their uses. Nature 2019",
      "J Widgets 12(3):100",
      "Nat Reactors 8, 55-60",
      "Widgets doi 10.1000/xyz123",
      "Widgets et al. Reactors",
      "The loss of alleles has been detected",
    ]) {
      expect(looksLikeCitation(line), line).toBe(true);
    }
    for (const line of ["Reactor Assembly", "Western Blot Analysis", "Statistical analysis", "DNA Extraction", "Cell Culture and Transfection"]) {
      expect(looksLikeCitation(line), line).toBe(false);
    }
  });

  it("caps plain heading numbers at 20 unless the document numbers hierarchically", () => {
    const flat = normalizeText([...body, "4. Reactor Assembly", "Parts were assembled.", "24. Reactor Cooling", "More parts.", "86. Bartley Platform", "Text."].join("\n"));
    const flatNames = structure(flat).outline.map((h) => h.normalized);
    expect(flatNames).toContain("reactor assembly");
    expect(flatNames).not.toContain("reactor cooling");
    expect(flatNames).not.toContain("bartley platform");

    const hierarchical = normalizeText([...body, "4. Reactor Assembly", "4.1 Parts", "Parts were assembled.", "24. Reactor Cooling", "More parts."].join("\n"));
    const hierNames = structure(hierarchical).outline.map((h) => h.normalized);
    expect(hierNames).toContain("parts");
    expect(hierNames).toContain("reactor cooling");
  });

  it("treats a headingless trailing numbered run of citations as the reference list", () => {
    const list = [
      "1. Smith J, Roe R. Widgets in reactors. J Widgets. 2019;12(3):100-110.",
      "2. Doe A, Poe E. Cooling without widgets. Reactor Res. 2020;4:1-9.",
      "3. Lee K, Kim H. Sprockets and gadgets in reactor design. Nat Reactors. 2021;8:55-60.",
      "4. Marignani P. Loss of tumour suppressors",
      "in cooling cells. Cell Cooling. 2018;2:7-8.",
      "5. Bartley L. A CRISPR Platform for Rapid",
      "Reactor Editing. Nat Reactors. 2021;8:55-60.",
      "6. Chen X. Widgets Revisited",
    ];
    const text = normalizeText([...body, ...list].join("\n"));
    const lines = indexLines(text);
    expect(numberedReferenceRunStart(lines)).toBe(body.length);
    const names = structure(text).outline.map((h) => h.normalized);
    expect(names).toEqual(["summary", "introduction", "discussion"]);
    // Numbered section headings are not a reference run.
    const sections = normalizeText(["1. Introduction", "Text.", "2. Results", "Text.", "3. Discussion", "Text.", "4. Methods", "Text.", "5. Conclusions", "Text."].join("\n"));
    expect(numberedReferenceRunStart(indexLines(sections))).toBeNull();
  });
});

describe("methodsLikeSpans", () => {
  it("covers the methods section under any name, with its subsections, and nothing else", () => {
    const text = normalizeText(
      ["Summary", "Widgets matter.", "Introduction", "RNA-seq has revealed much.", "Results", "Widgets rose.", "Materials and Methods", "Cell culture", "Cells were grown.", "RNA sequencing", "Libraries were prepared.", "Discussion", "Widgets are useful.", "References", "1. Smith J. Widgets. J Widgets 1:1-2."].join("\n")
    );
    const { outline } = structure(text);
    const spans = methodsLikeSpans(text, outline);
    expect(spans).toHaveLength(1);
    const covered = text.slice(spans[0].start, spans[0].end);
    expect(covered).toContain("Materials and Methods");
    expect(covered).toContain("Libraries were prepared.");
    expect(covered).not.toContain("Discussion");
    expect(covered).not.toContain("RNA-seq has revealed");
  });

  it("is empty for a manuscript without a methods section", () => {
    const text = normalizeText(["Summary", "Widgets matter.", "Introduction", "Text.", "Discussion", "Text.", "References", "1. Smith J. Widgets."].join("\n"));
    const { outline } = structure(text);
    expect(methodsLikeSpans(text, outline)).toEqual([]);
  });

  it("covers the STAR Methods groups and availability statements as one span", () => {
    const text = normalizeText(
      ["Summary", "Widgets.", "Results", "Text.", "STAR Methods", "KEY RESOURCES TABLE", "Reagent | Source | Identifier", "RESOURCE AVAILABILITY", "Data and code availability", "RNA-seq data have been deposited.", "METHOD DETAILS", "Sequencing", "Libraries were prepared.", "References", "1. Smith J. Widgets."].join("\n")
    );
    const { outline } = structure(text);
    const spans = methodsLikeSpans(text, outline);
    expect(spans).toHaveLength(1);
    const covered = text.slice(spans[0].start, spans[0].end);
    expect(covered).toContain("Libraries were prepared.");
    expect(covered).not.toContain("References");
  });
});

// ============================================================
// Summary
// ============================================================
describe("parseSummary", () => {
  it("counts the words of the summary paragraph", () => {
    const text = normalizeText(
      [
        "Summary",
        "Widgets improve reactor cooling by a measurable margin in every trial we ran.",
        "Introduction",
        "Longer text that must not be counted at all.",
      ].join("\n")
    );
    const { outline } = structure(text);
    const summary = parseSummary(text, outline);
    expect(summary?.headingText).toBe("Summary");
    expect(summary?.wordCount).toBe(13);
    expect(summary?.paragraphCount).toBe(1);
    expect(summary?.containsCitations).toBe(false);
  });

  it("reports an Abstract heading as given and flags citations", () => {
    const text = normalizeText(
      ["Abstract", "Widgets matter (Smith et al., 2020) in reactors.", "Introduction", "Text."].join("\n")
    );
    const { outline } = structure(text);
    const summary = parseSummary(text, outline);
    expect(summary?.headingText).toBe("Abstract");
    expect(summary?.containsCitations).toBe(true);
  });
});

// ============================================================
// Front matter and statements
// ============================================================
describe("parseFrontMatter", () => {
  const titlePage = normalizeText(
    [
      "Widget biogenesis improves reactor cooling",
      "Jane Smith1 , John Roe2 and Ada Doe1,3,*",
      "1 Department of Widgets, Example University, City 10001, Country.",
      "2 Institute of Cooling, Second University, Other City 20002, Country.",
      "*Correspondence: jane@example.edu (J.S.)",
      "3 Lead contact",
      "Summary",
      "Widgets matter.",
    ].join("\n")
  );

  it("extracts the title, authors, affiliations and emails", () => {
    const { outline } = structure(titlePage);
    const front = parseFrontMatter(titlePage, indexLines(titlePage), outline);
    expect(front.title).toBe("Widget biogenesis improves reactor cooling");
    expect(front.authorsLine).toContain("Jane Smith1");
    expect(front.affiliations).toHaveLength(2);
    expect(front.correspondingEmails).toEqual(["jane@example.edu"]);
    expect(front.hasLeadContactFootnote).toBe(true);
  });

  it("does not count a Lead Contact statement in the body as the footnote", () => {
    const text = normalizeText(
      [
        "Widget biogenesis improves reactor cooling",
        "Jane Smith1 and John Roe2",
        "1 Department of Widgets, Example University, City 10001, Country.",
        "Summary",
        "Widgets matter.",
        "STAR Methods",
        "Resource availability",
        "Lead contact",
        "Requests go to the lead contact, Jane Smith (jane@example.edu).",
      ].join("\n")
    );
    const { outline } = structure(text);
    const front = parseFrontMatter(text, indexLines(text), outline);
    expect(front.hasLeadContactFootnote).toBe(false);
  });
});

describe("parseStatements", () => {
  it("finds statements by their headings", () => {
    const text = normalizeText(
      [
        "Summary",
        "Widgets matter.",
        "Limitations of the study",
        "Only two reactors were tested.",
        "Acknowledgments",
        "We thank the workshop.",
        "Author contributions",
        "J.S. designed the study.",
        "Declaration of interests",
        "The authors declare no competing interests.",
        "Inclusion and diversity",
        "We support inclusive, diverse and equitable research.",
        "STAR Methods",
        "Key resources table",
        "Reagent | Source | Identifier",
        "Resource availability",
        "Lead contact",
        "Requests go to Jane Smith (jane@example.edu).",
        "Materials availability",
        "This study did not generate new unique reagents.",
        "Data and code availability",
        "Data are deposited at GEO under accession GSE123456.",
        "Additional resources",
        "The trial is registered as NCT01234567.",
      ].join("\n")
    );
    const { outline, sections } = structure(text);
    const statements = parseStatements(text, outline, sections);

    expect(statements.limitations?.headingText).toBe("Limitations of the study");
    expect(statements.acknowledgments?.headingText).toBe("Acknowledgments");
    expect(statements.authorContributions?.headingText).toBe("Author contributions");
    expect(statements.declarationOfInterests?.headingText).toBe("Declaration of interests");
    expect(statements.inclusionAndDiversity?.headingText).toBe("Inclusion and diversity");
    expect(statements.resourceAvailability?.headingText).toBe("Resource availability");
    expect(statements.leadContact?.headingText).toBe("Lead contact");
    expect(statements.materialsAvailability?.headingText).toBe("Materials availability");
    expect(statements.dataAndCodeAvailability?.headingText).toBe("Data and code availability");
    expect(statements.keyResourcesTable?.headingText).toBe("Key resources table");
    expect(statements.additionalResources?.headingText).toBe("Additional resources");
    expect(statements.aiDeclaration).toBeUndefined();
  });

  it("finds statements by their wording when the heading is missing", () => {
    const text = normalizeText(
      [
        "Summary",
        "Widgets matter.",
        "Materials and Methods",
        "Ethics statement",
        "All animal work was approved by the Institutional Animal Care and Use Committee of",
        "Example University and followed institutional guidelines for welfare.",
        "Written informed consent was obtained from all participants, and the protocol was",
        "approved by the Ethics Committee of Example Hospital.",
        "Reagents",
        "This study did not generate new unique reagents beyond those listed above.",
        "The authors declare no competing interests of any kind.",
      ].join("\n")
    );
    const { outline, sections } = structure(text);
    const statements = parseStatements(text, outline, sections);

    expect(statements.ethicsAnimal?.headingText).toBe("(animal ethics wording)");
    expect(statements.ethicsAnimal?.text).toContain("Institutional Animal Care");
    expect(statements.ethicsHuman?.headingText).toBe("(human ethics wording)");
    expect(statements.informedConsent?.text).toContain("informed consent");
    expect(statements.materialsAvailability?.headingText).toBe("(materials availability wording)");
    expect(statements.declarationOfInterests?.headingText).toBe(
      "(declaration of interests wording)"
    );
    // Nothing invented: there is no limitations section here.
    expect(statements.limitations).toBeUndefined();
    expect(statements.resourceAvailability).toBeUndefined();
    expect(statements.keyResourcesTable).toBeUndefined();
  });

  it("parses highlight bullets", () => {
    const text = normalizeText(
      [
        "Highlights",
        "• Widgets improve cooling by a third",
        "• Density scales with load",
        "• Reactors stay stable for a week",
        "Summary",
        "Widgets matter.",
      ].join("\n")
    );
    const { outline, sections } = structure(text);
    const statements = parseStatements(text, outline, sections);
    expect(statements.highlights?.bullets).toHaveLength(3);
    expect(statements.highlights?.bullets[0]).toBe("Widgets improve cooling by a third");
  });
});

describe("parseStarMethods", () => {
  it("recognises a STAR Methods section", () => {
    const text = normalizeText(
      [
        "STAR Methods",
        "KEY RESOURCES TABLE",
        "Reagent | Source | Identifier",
        "RESOURCE AVAILABILITY",
        "Lead contact",
        "Requests go to Jane Smith (jane@example.edu).",
        "METHOD DETAILS",
        "Reactors were assembled by hand.",
        "QUANTIFICATION AND STATISTICAL ANALYSIS",
        "Data are mean ± SEM.",
      ].join("\n")
    );
    const { outline, sections } = structure(text);
    const statements = parseStatements(text, outline, sections);
    const star = parseStarMethods(text, outline, [], [], statements);
    expect(star.present).toBe(true);
    expect(star.headingText).toBe("STAR Methods");
    expect(star.hasKeyResourcesTable).toBe(true);
    expect(star.headings).toContain("METHOD DETAILS");
  });

  it("reports a plain Materials and Methods section as not STAR-structured", () => {
    const text = normalizeText(
      [
        "Materials and Methods",
        "Mice and tumor models",
        "Animals were housed in pairs.",
        "Cell lines",
        "Cells came from the repository.",
        "Quantification and statistical analysis",
        "Data are mean ± SEM.",
      ].join("\n")
    );
    const { outline, sections } = structure(text);
    const statements = parseStatements(text, outline, sections);
    const star = parseStarMethods(text, outline, [], [], statements);
    expect(star.present).toBe(false);
    expect(star.headingText).toBe("Materials and Methods");
    expect(star.hasKeyResourcesTable).toBe(false);
    expect(star.headings).toContain("Mice and tumor models");
    expect(star.numberedSubheadings).toBe(false);
    expect(star.subheadingDepth).toBe(1);
  });

  it("counts numbered subheadings", () => {
    const text = normalizeText(
      [
        "Methods",
        "2.1 Reactor assembly",
        "Parts were assembled by hand.",
        "2.2 Widget counting",
        "Widgets were counted twice.",
      ].join("\n")
    );
    const { outline, sections } = structure(text);
    const star = parseStarMethods(text, outline, [], [], parseStatements(text, outline, sections));
    expect(star.numberedSubheadings).toBe(true);
  });
});

describe("findHeading", () => {
  it("matches on the normalised heading name", () => {
    const text = normalizeText(["Summary", "Widgets matter.", "References", "1. Smith."].join("\n"));
    const { outline } = structure(text);
    expect(findHeading(outline, /^summary$/)?.text).toBe("Summary");
  });
});
