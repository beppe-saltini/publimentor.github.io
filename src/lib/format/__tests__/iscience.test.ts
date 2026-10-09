/**
 * iScience profile: integrity of the check list and the main-document rule
 * detectors (title page, summary, sections, references, figures, supplemental).
 * All models are synthetic.
 */

import { describe, it, expect } from "vitest";
import type { ManuscriptModel } from "../manuscript-model";
import { iscienceProfile } from "../profiles/iscience";
import { SPREADSHEET_PHRASES, SPREADSHEET_QUESTIONS } from "../profiles/iscience-phrases";
import { compliantIscienceModel, heading, legend, makeModel, reference, section, statement, supplemental } from "./profile-fixtures";

const check = (id: string) => {
  const c = iscienceProfile.checks.find((x) => x.id === `iscience.${id}`);
  if (!c) throw new Error(`missing check ${id}`);
  return c;
};
/** Evaluate a rule detector directly (appliesWhen is the evaluator's job). */
const run = (id: string, model: ManuscriptModel) => {
  const c = check(id);
  if (c.detector.kind !== "rule") throw new Error(`${id} is not a rule`);
  return c.detector.evaluate(model);
};
const applies = (id: string, model: ManuscriptModel) => check(id).appliesWhen?.(model) ?? true;

describe("iScience profile integrity", () => {
  it("encodes every spreadsheet row as a check with its verbatim phrase", () => {
    const ids = new Set(iscienceProfile.checks.map((c) => c.id));
    for (const key of Object.keys(SPREADSHEET_QUESTIONS)) {
      expect(ids.has(`iscience.${key}`), key).toBe(true);
      const c = check(key);
      if (key !== "references.entries") expect(c.phrase).toBe(SPREADSHEET_PHRASES[key]);
      expect(c.question).toBe(SPREADSHEET_QUESTIONS[key].question);
      expect(c.sourceRef).toContain(`row ${SPREADSHEET_QUESTIONS[key].row}`);
    }
    expect(Object.keys(SPREADSHEET_QUESTIONS)).toHaveLength(63);
  });

  it("has unique ids, '* ' phrases and a guideline for every check", () => {
    const ids = iscienceProfile.checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of iscienceProfile.checks) {
      expect(c.phrase.startsWith("* "), c.id).toBe(true);
      expect(c.guideline.length, c.id).toBeGreaterThan(20);
      expect(c.question.length, c.id).toBeGreaterThan(5);
    }
    expect(iscienceProfile.letterPreamble).toMatch(/^Please pay particular attention/);
  });

  it("rewrites the references phrase to the FFC superscript/DOI wording", () => {
    const phrase = check("references.entries").phrase;
    expect(phrase).not.toContain("Harvard");
    expect(phrase).toContain("superscript numbers");
    expect(phrase).toContain("and DOI");
  });

  it("passes every rule check on a compliant model", () => {
    const model = compliantIscienceModel();
    const failures = iscienceProfile.checks
      .filter((c) => c.detector.kind === "rule" && (c.appliesWhen?.(model) ?? true))
      .map((c) => ({ id: c.id, ...(c.detector.kind === "rule" ? c.detector.evaluate(model) : { status: "unknown", summary: "" }) }))
      .filter((r) => r.status === "fail");
    expect(failures.map((f) => `${f.id}: ${f.summary}`)).toEqual([]);
  });
});

describe("file and title page", () => {
  it("requires a Word file", () => {
    expect(run("file.word", makeModel({ sourceType: "pdf", fileName: "paper.pdf" }))).toMatchObject({ status: "fail", summary: expect.stringContaining("paper.pdf") });
    expect(run("file.word", makeModel({ sourceType: "docx" })).status).toBe("pass");
    expect(run("file.word", makeModel({ sourceType: "text" })).status).toBe("review");
  });

  it("checks title length, word count and punctuation using the FFC numbers", () => {
    expect(run("title.length", makeModel({ title: "Augmenting widgetsome biogenesis potentiates cryotherapy efficacy" })).summary).toContain("65 characters, 6 words");
    expect(run("title.length", makeModel({ title: "A".repeat(146) })).status).toBe("fail");
    expect(run("title.length", makeModel({ title: "Does it work? Yes" }))).toMatchObject({ status: "fail", summary: expect.stringContaining('"?"') });
    expect(run("title.length", makeModel({ title: Array(16).fill("word").join(" ") })).summary).toContain("16 words");
    expect(run("title.length", makeModel()).status).toBe("unknown");
  });

  it("requires a Lead Contact footnote and a corresponding e-mail", () => {
    const noFootnote = run("title.lead_contact_footnote", makeModel({ text: "*Correspondence: a@b.org", hasLeadContactFootnote: false }));
    expect(noFootnote.status).toBe("fail");
    expect(noFootnote.summary).toContain("Correspondence");
    expect(run("title.lead_contact_footnote", makeModel({ hasLeadContactFootnote: true })).status).toBe("pass");
    expect(run("title.corresponding_email", makeModel()).status).toBe("fail");
    expect(run("title.corresponding_email", makeModel({ correspondingEmails: ["a@b.org"] })).status).toBe("pass");
  });
});

describe("summary", () => {
  const summary = (text: string, headingText = "Summary", extra: Partial<NonNullable<ManuscriptModel["summary"]>> = {}) =>
    makeModel({ summary: { headingText, text, wordCount: text.split(/\s+/).length, paragraphCount: 1, containsCitations: false, ...extra } });

  it("requires the heading to be Summary", () => {
    expect(run("summary.heading", summary("x", "Abstract"))).toMatchObject({ status: "fail", summary: expect.stringContaining('"Abstract"') });
    expect(run("summary.heading", summary("x", "Summary")).status).toBe("pass");
    expect(run("summary.heading", makeModel()).status).toBe("fail");
  });

  it("enforces 150 words, one paragraph, no citations", () => {
    expect(run("summary.length", summary(Array(141).fill("w").join(" "))).status).toBe("pass");
    expect(run("summary.length", summary(Array(151).fill("w").join(" "))).summary).toContain("151 words");
    expect(run("summary.length", summary("w", "Summary", { paragraphCount: 2 })).summary).toContain("2 paragraphs");
    expect(run("summary.length", summary("w", "Summary", { containsCitations: true })).summary).toContain("citations");
  });

  it("flags 'remains unclear' framing and novelty claims", () => {
    const bad = run("summary.framing", summary("How this is converted into signals remains unclear. We report a novel mechanism."));
    expect(bad.status).toBe("fail");
    expect(bad.summary).toContain("remains unclear");
    expect(bad.summary).toContain("novel");
    expect(run("summary.framing", summary("Here we show that X drives Y. These findings establish X as a target.")).status).toBe("pass");
    expect(run("summary.framing", summary("The mechanism is poorly understood.")).status).toBe("fail");
    expect(run("summary.framing", makeModel()).status).toBe("unknown");
  });

  it("the semantic summary check builds a prompt only when a summary exists", () => {
    const c = check("summary.content");
    expect(c.detector.kind).toBe("llm");
    if (c.detector.kind !== "llm") return;
    expect(c.detector.prompt(makeModel())).toBeNull();
    expect(c.detector.prompt(summary("Some text"))?.excerpt).toBe("Some text");
  });
});

describe("sections and body", () => {
  it("detects missing sections and wrong order in the FFC sequence", () => {
    const model = makeModel({ outline: [heading("Abstract", 0), heading("Introduction", 10), heading("Results", 20), heading("Discussion", 30), heading("Materials and Methods", 40), heading("Acknowledgements", 50), heading("Author contributions", 60), heading("Competing interests", 70), heading("References", 80)] });
    const result = run("sections.order", model);
    expect(result.status).toBe("fail");
    expect(result.summary).toContain("Resource Availability");
    expect(result.summary).toContain("Limitations of the Study");
    expect(result.summary).toContain("Figure legends");
  });

  it("accepts the compliant order where Abstract fills the Summary slot", () => {
    const model = compliantIscienceModel();
    model.outline[0] = heading("Abstract", model.outline[0].span.start);
    expect(run("sections.order", model).status).toBe("pass");
  });

  it("requires a Limitations paragraph and flags novelty / results subdivision / personal communication", () => {
    expect(run("sections.limitations", makeModel()).status).toBe("fail");
    expect(run("sections.limitations", makeModel({ statements: { limitations: statement("Limitations of the study", "Caveats.") } })).status).toBe("pass");
    const hit = { text: "novel", context: "a novel thing", span: { start: 0, end: 5 } };
    expect(run("body.novelty", makeModel()).status).toBe("pass");
    expect(run("body.novelty", makeModel({ phraseHits: { novelty: [hit], asDescribedPreviously: [], personalCommunication: [] } })).status).toBe("review");
    expect(run("body.novelty", makeModel({ phraseHits: { novelty: [hit, hit, hit], asDescribedPreviously: [], personalCommunication: [] } })).status).toBe("fail");
    expect(run("body.results_subheadings", makeModel({ sections: [section("Results", 0, "", [])] })).status).toBe("fail");
    expect(run("body.results_subheadings", makeModel({ sections: [section("Results", 0, "", [section("A", 1, "", [], 2), section("B", 2, "", [], 2)])] })).status).toBe("pass");
    expect(run("body.personal_communication", makeModel({ phraseHits: { novelty: [], asDescribedPreviously: [], personalCommunication: [hit] } })).status).toBe("review");
    expect(run("star.as_described_previously", makeModel({ phraseHits: { novelty: [], asDescribedPreviously: [hit], personalCommunication: [] } })).status).toBe("fail");
  });

  it("applies the AI declaration only when generative AI is mentioned", () => {
    expect(applies("statements.ai_declaration", makeModel({ text: "no tools" }))).toBe(false);
    const model = makeModel({ text: "We used ChatGPT to polish the text." });
    expect(applies("statements.ai_declaration", model)).toBe(true);
    expect(run("statements.ai_declaration", model).status).toBe("fail");
  });

  it("checks equations only in Word files", () => {
    const base = { features: { ...makeModel().features, equations: { present: true, evidence: ["Eq. 1"] } } };
    expect(applies("body.equations", makeModel())).toBe(false);
    expect(run("body.equations", makeModel({ ...base, sourceType: "pdf" })).status).toBe("review");
    expect(run("body.equations", makeModel({ ...base, docx: { wordTables: 0, imagesInBody: 0, ommlEquations: 0, mathTypeObjects: 0, trackedChanges: false, usesHeadingStyles: true } })).status).toBe("fail");
    expect(run("body.equations", makeModel({ ...base, docx: { wordTables: 0, imagesInBody: 0, ommlEquations: 2, mathTypeObjects: 0, trackedChanges: false, usesHeadingStyles: true } })).status).toBe("pass");
  });
});

describe("references", () => {
  it("requires superscript numeric citations", () => {
    const refs = (inTextStyle: ManuscriptModel["references"]["inTextStyle"]) => makeModel({ references: { style: "numbered", count: 1, entries: [], inTextStyle, separateSupplementalList: false } });
    expect(run("references.in_text", refs("superscript-numeric")).status).toBe("pass");
    expect(run("references.in_text", refs("author-year")).status).toBe("fail");
    expect(run("references.in_text", refs("unknown")).status).toBe("review");
  });

  it("fails entries when fewer than 80% have a DOI and reports the count", () => {
    const entries = Array.from({ length: 10 }, (_, i) => reference(i + 1, { hasDoi: i < 7 }));
    const result = run("references.entries", makeModel({ references: { style: "numbered", count: 10, entries, inTextStyle: "superscript-numeric", separateSupplementalList: false } }));
    expect(result.status).toBe("fail");
    expect(result.summary).toContain("only 7 of 10 entries include a DOI");
    const ok = entries.map((e) => ({ ...e, hasDoi: true }));
    expect(run("references.entries", makeModel({ references: { style: "numbered", count: 10, entries: ok, inTextStyle: "superscript-numeric", separateSupplementalList: false } })).status).toBe("pass");
  });

  it("flags systematic missing fields and in-press items", () => {
    const entries = Array.from({ length: 5 }, (_, i) => reference(i + 1, { hasPages: false }));
    expect(run("references.entries", makeModel({ references: { style: "numbered", count: 5, entries, inTextStyle: "superscript-numeric", separateSupplementalList: false } })).summary).toContain("lack a page range");
    expect(run("references.in_press", makeModel({ references: { style: "numbered", count: 1, entries: [reference(1, { isInPressOrUnpublished: true })], inTextStyle: "superscript-numeric", separateSupplementalList: false } })).status).toBe("fail");
    expect(run("references.entries", makeModel()).status).toBe("fail");
  });
});

describe("statements", () => {
  it("acknowledgments need grant numbers, author contributions follow them", () => {
    expect(run("statements.acknowledgments", makeModel()).status).toBe("fail");
    expect(run("statements.acknowledgments", makeModel({ statements: { acknowledgments: statement("Acknowledgments", "We thank our colleagues.") } })).status).toBe("review");
    expect(run("statements.acknowledgments", makeModel({ statements: { acknowledgments: statement("Acknowledgments", "Supported by grant 12345.") } })).status).toBe("pass");
    const before = makeModel({ statements: { acknowledgments: statement("Acknowledgments", "x", 100), authorContributions: statement("Author Contributions", "y", 50) } });
    expect(run("statements.author_contributions", before).status).toBe("review");
    expect(run("statements.author_contributions", makeModel()).status).toBe("fail");
  });

  it("declaration of interests must be so named and precede the References", () => {
    const renamed = makeModel({ statements: { declarationOfInterests: statement("Competing interests", "None.", 10) } });
    expect(run("statements.declaration_of_interests", renamed)).toMatchObject({ status: "fail", summary: expect.stringContaining('"Competing interests"') });
    const after = makeModel({ outline: [heading("References", 0)], statements: { declarationOfInterests: statement("Declaration of Interests", "None.", 100) } });
    expect(run("statements.declaration_of_interests", after).summary).toContain("precede");
    const synthetic = makeModel({ statements: { declarationOfInterests: statement("(declaration of interests wording)", "None.", 100) } });
    expect(run("statements.declaration_of_interests", synthetic).status).toBe("review");
    expect(run("statements.declaration_of_interests", makeModel()).status).toBe("fail");
    expect(run("statements.inclusion_diversity", makeModel()).status).toBe("fail");
  });
});

describe("figures", () => {
  it("wants legends as one list with Figure N. titles", () => {
    const interspersed = makeModel({ figureLegends: [legend("1", { label: "Fig. 1 |" })], legendsInterspersed: true });
    const result = run("figures.legends_list", interspersed);
    expect(result.status).toBe("fail");
    expect(result.summary).toContain("interspersed");
    expect(result.summary).toContain('"Fig. 1 |"');
    expect(run("figures.legends_list", makeModel()).status).toBe("fail");
    expect(run("figures.legends_list", makeModel({ figureLegends: [legend("1")], legendsAfterMainText: true })).status).toBe("pass");
  });

  it("ignores supplemental legends mixed into the legend list", () => {
    const model = makeModel({
      figureLegends: [legend("1", { definesErrorBars: true }), legend("5", { label: "Supplementary Fig. 5" }), legend("S2", { label: "Figure S2." })],
      features: { ...makeModel().features, errorBars: { present: true, evidence: [] } },
    });
    expect(run("figures.error_bars", model).status).toBe("pass");
  });

  it("error bars / asterisks: none is a fail, some is a review, all is a pass", () => {
    const two = (a: boolean, b: boolean) => makeModel({ figureLegends: [legend("1", { definesErrorBars: a, definesAsterisks: a }), legend("2", { definesErrorBars: b, definesAsterisks: b })] });
    expect(run("figures.error_bars", two(false, false)).status).toBe("fail");
    expect(run("figures.error_bars", two(true, false))).toMatchObject({ status: "review", summary: expect.stringContaining("Figure 2") });
    expect(run("figures.error_bars", two(true, true)).status).toBe("pass");
    const withAsterisks = (a: boolean, b: boolean) => ({ ...two(a, b), features: { ...makeModel().features, asterisks: { present: true, evidence: ["*P < 0.05"] } } });
    expect(run("figures.asterisks", withAsterisks(false, false)).status).toBe("fail");
    expect(run("figures.asterisks", withAsterisks(true, false)).status).toBe("review");
    expect(run("figures.asterisks", withAsterisks(true, true)).status).toBe("pass");
    expect(run("figures.asterisks", makeModel()).status).toBe("unknown");
  });

  it("asterisks: statistical tests without asterisk definitions are a review, not not-applicable", () => {
    // No "*P < 0.05" in the extracted text, but the legends name a test: the figures may still carry asterisks.
    const tests = makeModel({ figureLegends: [legend("1", { namesStatisticalTest: true }), legend("2", { namesStatisticalTest: true })] });
    expect(applies("figures.asterisks", tests)).toBe(true);
    expect(run("figures.asterisks", tests)).toMatchObject({ status: "review", summary: expect.stringContaining("figures may show significance asterisks") });
    // A test named only in the running text counts too.
    expect(applies("figures.asterisks", makeModel({ text: "Differences were assessed by two-way ANOVA." }))).toBe(true);
    // Nothing statistical at all: not applicable.
    expect(applies("figures.asterisks", makeModel())).toBe(false);
    // One legend that defines them passes (medium confidence).
    expect(run("figures.asterisks", makeModel({ figureLegends: [legend("1", { namesStatisticalTest: true, definesAsterisks: true })] })).status).toBe("pass");
  });

  it("scale bars need at least one legend; blots need markers; see-also is advisory", () => {
    expect(run("figures.scale_bars", makeModel({ figureLegends: [legend("1", { mentionsScaleBar: true }), legend("2")] })).status).toBe("pass");
    expect(run("figures.scale_bars", makeModel({ figureLegends: [legend("1"), legend("2")] })).status).toBe("fail");
    const blots = makeModel({ features: { ...makeModel().features, blotsOrGels: { present: true, evidence: ["immunoblot"] } } });
    expect(run("figures.blot_markers", blots).status).toBe("fail");
    blots.features.molecularWeightMarkers = { present: true, evidence: ["kDa"] };
    expect(run("figures.blot_markers", blots).status).toBe("pass");
    expect(run("figures.see_also", makeModel()).status).toBe("not_applicable");
    expect(run("figures.see_also", makeModel({ supplementalMentions: ["Figure S1"], figureLegends: [legend("1")] })).status).toBe("review");
  });

  it("separate figure files can only be verified for Word documents", () => {
    expect(run("figures.separate_files", makeModel({ sourceType: "pdf" })).status).toBe("review");
    const docx = { wordTables: 0, imagesInBody: 3, ommlEquations: 0, mathTypeObjects: 0, trackedChanges: false, usesHeadingStyles: true };
    expect(run("figures.separate_files", makeModel({ docx })).status).toBe("fail");
    expect(run("figures.separate_files", makeModel({ docx: { ...docx, imagesInBody: 0 } })).status).toBe("pass");
  });
});

describe("tables and supplemental items", () => {
  it("tables: panels fail, PDFs are reviewed, Word tables pass", () => {
    const captions = [{ number: "1A", title: "t", span: { start: 0, end: 1 }, isSupplemental: false }];
    expect(applies("tables.format", makeModel())).toBe(false);
    expect(run("tables.format", makeModel({ tableCaptions: captions })).summary).toContain("panels");
    expect(run("tables.format", makeModel({ sourceType: "pdf", tableCaptions: [{ ...captions[0], number: "1" }] })).status).toBe("review");
    const docx = { wordTables: 1, imagesInBody: 0, ommlEquations: 0, mathTypeObjects: 0, trackedChanges: false, usesHeadingStyles: true };
    expect(run("tables.format", makeModel({ tableCaptions: [{ ...captions[0], number: "1" }], docx })).status).toBe("pass");
    expect(run("tables.format", makeModel({ tableCaptions: [{ ...captions[0], number: "1" }], docx: { ...docx, wordTables: 0 } })).status).toBe("fail");
  });

  it("supplemental titles need the S-form and Related to", () => {
    const text = "Supplementary Fig. 1. Sparse cells improve response.\nFigure S2. Good title, Related to Figure 2";
    const items = [
      supplemental("figure", "1", { span: { start: 0, end: 52 } }),
      supplemental("figure", "S2", { relatedTo: ["Figure 2"], span: { start: 53, end: text.length } }),
    ];
    const result = run("supplemental.related_to", makeModel({ text, supplementalItems: items }));
    expect(result.status).toBe("fail");
    expect(result.summary).toContain("1 of 2");
    expect(run("supplemental.related_to", makeModel({ text, supplementalItems: [items[1]] })).status).toBe("pass");
    expect(run("supplemental.related_to", makeModel({ supplementalMentions: ["Figure S1"] })).status).toBe("review");
  });

  it("counts supplemental figures and recognises Excel tables and videos", () => {
    const many = Array.from({ length: 21 }, (_, i) => supplemental("figure", `S${i + 1}`));
    expect(run("supplemental.figure_count", makeModel({ supplementalItems: many })).status).toBe("fail");
    expect(run("supplemental.figure_count", makeModel({ supplementalItems: many.slice(0, 7) })).status).toBe("pass");
    expect(run("supplemental.figure_count", makeModel()).status).toBe("not_applicable");
    const text = "Supplementary Table 2. Gene sets. The complete table is provided as a separate Excel file.";
    const excel = makeModel({ text, supplementalItems: [supplemental("table", "2", { span: { start: 0, end: text.length } })] });
    expect(run("supplemental.excel_tables", excel).status).toBe("pass");
    expect(run("supplemental.excel_tables", makeModel({ text: "see Supplementary Table 1", supplementalItems: [supplemental("table", "1", { span: { start: 0, end: 3 } })] })).status).toBe("review");
    expect(run("supplemental.videos", makeModel({ supplementalItems: [supplemental("video", "S1")] })).status).toBe("fail");
    expect(run("supplemental.videos", makeModel({ supplementalItems: [supplemental("video", "S1", { relatedTo: ["Figure 1"] })] })).status).toBe("pass");
  });

  it("highlights are unknown when absent and validated when present", () => {
    expect(run("associated.highlights", makeModel()).status).toBe("unknown");
    const ok = makeModel({ statements: { highlights: { bullets: ["a", "b", "c"], span: { start: 0, end: 1 } } } });
    expect(run("associated.highlights", ok).status).toBe("pass");
    const long = makeModel({ statements: { highlights: { bullets: ["a", "b", "x".repeat(90), "d", "e"], span: { start: 0, end: 1 } } } });
    expect(run("associated.highlights", long).summary).toMatch(/5 bullets.*longer than 85/);
  });
});

describe("ethics", () => {
  /** A model with a plain Methods section, so missing statements are a real failure. */
  const withMethods = (overrides: Partial<ManuscriptModel> = {}) =>
    makeModel({ starMethods: { ...makeModel().starMethods, headingText: "Methods" }, outline: [heading("Methods", 0)], ...overrides });

  it("animal and human work: approval, consent, sex and age", () => {
    const animal = withMethods({ features: { ...makeModel().features, vertebrates: { present: true, evidence: ["mice"] } } });
    expect(applies("ethics.vertebrates", makeModel())).toBe(false);
    expect(run("ethics.vertebrates", animal).status).toBe("fail");
    animal.statements.ethicsAnimal = statement("Ethics", "Approved by the IACUC.");
    animal.features.sexReported = { present: true, evidence: ["female"] };
    expect(run("ethics.vertebrates", animal)).toMatchObject({ status: "review", summary: expect.stringContaining("age") });
    animal.features.ageReported = { present: true, evidence: ["8 weeks"] };
    expect(run("ethics.vertebrates", animal).status).toBe("pass");

    const human = withMethods({ features: { ...makeModel().features, humans: { present: true, evidence: ["patients"] } }, statements: { ethicsHuman: statement("Ethics", "IRB approved.") } });
    expect(run("ethics.humans", human).summary).toContain("informed consent");
    human.statements.informedConsent = statement("Ethics", "Written informed consent was obtained.");
    expect(run("ethics.humans", human).status).toBe("review");
  });

  it("asks instead of failing when mice or patients are mentioned but there is no methods section (review article)", () => {
    // No starMethods.headingText, no Methods heading in the outline, no ethics statement.
    const review = makeModel({
      outline: [heading("Summary", 0), heading("Introduction", 20), heading("Discussion", 400), heading("References", 900)],
      features: { ...makeModel().features, vertebrates: { present: true, evidence: ["mouse models"] }, humans: { present: true, evidence: ["patients"] } },
    });
    const animal = run("ethics.vertebrates", review);
    expect(animal.status).toBe("review");
    expect(animal.summary).toMatch(/Animal work is mentioned but the manuscript has no methods section; if experimental work was done, add the approval, sex and age statements/);
    const human = run("ethics.humans", review);
    expect(human.status).toBe("review");
    expect(human.summary).toMatch(/Human work is mentioned but the manuscript has no methods section/);
    expect(human.summary).toContain("consent");

    // The same model with a methods section (any alias in the outline) fails as before.
    const withMaterials = makeModel({ ...review, outline: [...review.outline, heading("Materials and Methods", 500)] });
    expect(run("ethics.vertebrates", withMaterials).status).toBe("fail");
    const withStar = makeModel({ ...review, starMethods: { ...review.starMethods, headingText: "STAR Methods" } });
    expect(run("ethics.humans", withStar).status).toBe("fail");
    // A review article whose approval wording is present anyway is judged on it.
    const approved = makeModel({ ...review, statements: { ethicsAnimal: statement("Ethics", "Approved by the IACUC.") } });
    expect(run("ethics.vertebrates", approved).status).toBe("review");
    expect(run("ethics.vertebrates", approved).summary).toContain("approval present");
  });

  it("falls back to the wording in the text when the parser found no statement", () => {
    const model = makeModel({
      text: "All animal experiments were approved by the Institutional Animal Care and Use Committee of X University.",
      features: { ...makeModel().features, vertebrates: { present: true, evidence: ["mice"] }, sexReported: { present: true, evidence: [] }, ageReported: { present: true, evidence: [] } },
    });
    const result = run("ethics.vertebrates", model);
    expect(result.status).toBe("pass");
    expect(result.confidence).toBe("medium");
    expect(result.evidence[0].quote).toContain("Institutional Animal Care");
  });
});
