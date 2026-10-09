/**
 * iScience STAR Methods, Resource Availability, data deposition and KRT rule
 * detectors (spreadsheet rows 44-72), on synthetic models.
 */

import { describe, it, expect, vi } from "vitest";
import { buildManuscriptModel, type ManuscriptModel } from "../manuscript-model";
import { runFormatChecks } from "../evaluate";
import { iscienceProfile } from "../profiles/iscience";
import { methodsSection, methodsText } from "../profiles/shared-rules";
import { compliantIscienceModel, heading, makeModel, section, statement } from "./profile-fixtures";

const LLM_METHOD_CHECKS = ["star.references_in_lieu", "star.method_details", "references.datasets_code_cited"] as const;

/** A synthetic Vancouver-style manuscript: classic methods split into subsections. */
const CLASSIC_METHODS_MANUSCRIPT = [
  "Widget biogenesis improves reactor cooling",
  "Jane Smith1 and John Roe2",
  "1 Department of Widgets, Example University, City 10001, Country.",
  "",
  "Abstract",
  "We show that widgets cool reactors.",
  "",
  "Introduction",
  "Widgets have long been studied1,2.",
  "",
  "Results",
  "Widgets cooled reactors (Fig. 1a).",
  "",
  "Discussion",
  "Widgets matter.",
  "",
  "Materials and Methods",
  "Cell culture",
  "Widget cells (ATCC CRL-0001) were cultured in RPMI with 10% FBS at 37 °C.",
  "Reactor assays",
  "Cooling was measured with a WidgetMeter 3000 (Example Instruments) as described previously3.",
  "Statistical analysis",
  "Two-tailed t tests were run in GraphPad Prism v9; n = 4 reactors per group.",
  "",
  "References",
  "1. Smith J, Roe R. Widgets in reactors. J Widgets. 2019;12(3):100-110.",
  "2. Doe A. Cooling without widgets. Reactor Res. 2020;4:1-9.",
  "3. Poe E. Measuring cooling. Reactor Res. 2021;5:10-19.",
].join("\n");

/** A fetch stub answering with one Claude-shaped judgment. */
function claudeFetch(judgments: unknown[]) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify({ judgments }) }], stop_reason: "end_turn" }),
  })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const check = (id: string) => {
  const c = iscienceProfile.checks.find((x) => x.id === `iscience.${id}`);
  if (!c) throw new Error(`missing check ${id}`);
  return c;
};
const run = (id: string, model: ManuscriptModel) => {
  const c = check(id);
  if (c.detector.kind !== "rule") throw new Error(`${id} is not a rule`);
  return c.detector.evaluate(model);
};
const applies = (id: string, model: ManuscriptModel) => check(id).appliesWhen?.(model) ?? true;
const star = (overrides: Partial<ManuscriptModel["starMethods"]>): ManuscriptModel["starMethods"] => ({
  present: true, headingText: "STAR Methods", headings: [], hasKeyResourcesTable: false, numberedSubheadings: false, subheadingDepth: 1, tablesEmbedded: 0, figuresEmbedded: 0, ...overrides,
});

describe("STAR Methods structure", () => {
  it("star.present distinguishes classic methods from STAR Methods", () => {
    const classic = makeModel({ sections: [section("Materials and Methods", 0, "body")] });
    expect(run("star.present", classic)).toMatchObject({ status: "fail", summary: expect.stringContaining('"Materials and Methods"') });
    expect(run("star.present", makeModel()).status).toBe("fail");
    expect(run("star.present", makeModel({ starMethods: star({}) })).status).toBe("pass");
  });

  it("headings must be the standard ones in order; EXPERIMENTAL MODEL only for life-science models", () => {
    const m = (headings: string[], vertebrates = false) => makeModel({ starMethods: star({ headings }), features: { ...makeModel().features, vertebrates: { present: vertebrates, evidence: [] } } });
    expect(applies("star.headings_order", makeModel())).toBe(false);
    expect(run("star.headings_order", m(["RESOURCE AVAILABILITY", "METHOD DETAILS", "QUANTIFICATION AND STATISTICAL ANALYSIS"])).status).toBe("pass");
    expect(run("star.headings_order", m(["RESOURCE AVAILABILITY", "METHOD DETAILS", "QUANTIFICATION AND STATISTICAL ANALYSIS"], true)).summary).toContain("missing EXPERIMENTAL MODEL AND SUBJECT DETAILS");
    expect(run("star.headings_order", m(["METHOD DETAILS", "RESOURCE AVAILABILITY", "Cell culture", "QUANTIFICATION AND STATISTICAL ANALYSIS"])).summary).toContain("out of order: METHOD DETAILS");
    expect(run("star.headings_order", m(["Resource availability", "Experimental model and study participant details", "Method details", "Quantification and statistical analysis", "Additional resources"], true)).status).toBe("pass");
  });

  it("subheadings may not be numbered or deeper than two levels", () => {
    expect(run("star.subheadings", makeModel({ starMethods: star({ headings: ["1. Mice"], numberedSubheadings: true }) })).summary).toContain("numbered");
    expect(run("star.subheadings", makeModel({ starMethods: star({ headings: ["a"], subheadingDepth: 3 }) })).summary).toContain("3 levels");
    expect(run("star.subheadings", makeModel({ starMethods: star({ headings: [] }) })).status).toBe("fail");
    expect(run("star.subheadings", makeModel({ starMethods: star({ headings: ["Mice"], subheadingDepth: 2 }) })).status).toBe("pass");
  });

  it("embedded numbered tables and figures fail; complex tables are reviewed", () => {
    expect(run("star.numbered_tables", makeModel({ starMethods: star({ tablesEmbedded: 2 }) })).status).toBe("fail");
    expect(run("star.numbered_tables", makeModel({ starMethods: star({}) })).status).toBe("pass");
    expect(run("star.embedded_figures", makeModel({ starMethods: star({ figuresEmbedded: 1 }) })).status).toBe("fail");
    expect(applies("star.complex_tables", makeModel({ starMethods: star({}) }))).toBe(false);
    expect(run("star.complex_tables", makeModel({ starMethods: star({ tablesEmbedded: 1 }) })).status).toBe("review");
    expect(run("star.separate_reference_list", makeModel({ references: { style: "numbered", count: 1, entries: [], inTextStyle: "unknown", separateSupplementalList: true } })).status).toBe("fail");
  });

  it("LLM method checks only build prompts when a methods section exists", () => {
    for (const id of LLM_METHOD_CHECKS) {
      const c = check(id);
      expect(c.detector.kind).toBe("llm");
      if (c.detector.kind !== "llm") continue;
      expect(applies(id, makeModel())).toBe(false);
      const withMethods = makeModel({ sections: [section("Methods", 0, "We did things.")] });
      expect(applies(id, withMethods)).toBe(true);
      expect(c.detector.prompt(withMethods)?.excerpt).toBe("We did things.");
    }
  });

  it("LLM method checks read classic methods with subsections (empty parent body) and clip the excerpt", () => {
    // Nature/Vancouver style: every word of the methods sits under a subheading.
    const nested = makeModel({ sections: [section("Materials and Methods", 0, "", [section("Cell culture", 30, "Cells were grown.", [], 2), section("Statistics", 60, "x".repeat(12000), [], 2)])] });
    expect(methodsSection(nested)?.body).toBe("");
    expect(methodsText(nested)).toContain("Cell culture\n\nCells were grown.");
    for (const id of LLM_METHOD_CHECKS) {
      const c = check(id);
      if (c.detector.kind !== "llm") throw new Error(`${id} is not an llm check`);
      expect(applies(id, nested)).toBe(true);
      const excerpt = c.detector.prompt(nested)?.excerpt;
      expect(excerpt).toContain("Cells were grown.");
      // Clipped to the existing size limit (9000, or 7000 for the citation check) plus the marker.
      expect(excerpt!.length).toBeLessThanOrEqual(9000 + "\n[...]".length);
      expect(excerpt!.endsWith("[...]")).toBe(true);
    }
    expect(methodsText(makeModel())).toBeUndefined();
  });

  it("sends the methods prompts to Claude for a parsed 'Materials and Methods' manuscript", async () => {
    const model = await buildManuscriptModel({ text: CLASSIC_METHODS_MANUSCRIPT, fileName: "classic.txt" });
    expect(model.starMethods.present).toBe(false);
    expect(model.starMethods.headingText).toBe("Materials and Methods");
    // The parent section body is empty: this is exactly what used to yield "No manuscript excerpt available".
    expect(methodsSection(model)?.body).toBe("");

    const fetchImpl = claudeFetch([{ checkId: "iscience.star.method_details", status: "pass", summary: "Reagents, instruments and software are given.", evidence: ["WidgetMeter 3000"], confidence: "high" }]);
    const report = await runFormatChecks(model, iscienceProfile, { llmOptions: { apiKey: "test-key", fetchImpl } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    const prompt: string = body.messages[0].content;
    for (const id of LLM_METHOD_CHECKS) {
      const block = prompt.match(new RegExp(`<check id="iscience.${id}">[\\s\\S]*?</check>`))?.[0];
      expect(block, id).toBeDefined();
      expect(block).toContain("Materials and Methods");
      expect(block).toContain("Cell culture");
      expect(block).toContain("WidgetMeter 3000");
      expect(block).toContain("GraphPad Prism v9");
      expect(block).not.toContain("Widgets have long been studied"); // the introduction is not part of the methods excerpt
    }

    const byId = Object.fromEntries(report.results.map((r) => [r.checkId, r]));
    expect(byId["iscience.star.method_details"]).toMatchObject({ status: "pass", summary: "Reagents, instruments and software are given." });
    for (const id of LLM_METHOD_CHECKS) expect(byId[`iscience.${id}`].summary).not.toContain("No manuscript excerpt");
  });
});

describe("Resource Availability", () => {
  it("requires the section with its three subheadings", () => {
    const separate = makeModel({ statements: { dataAvailability: statement("Data availability", "Deposited.", 0), codeAvailability: statement("Code availability", "No code.", 20) } });
    const result = run("resource.section", separate);
    expect(result.status).toBe("fail");
    expect(result.summary).toContain('"Data availability", "Code availability"');
    const partial = makeModel({ outline: [heading("Resource Availability", 0)], statements: { leadContact: statement("Lead Contact", "Jane Doe (j@x.org)") } });
    expect(run("resource.section", partial).summary).toContain("missing subheadings: Materials Availability, Data and Code Availability");
    expect(run("resource.section", compliantIscienceModel()).status).toBe("pass");
  });

  it("lead contact statement needs a name and an e-mail", () => {
    expect(run("resource.lead_contact", makeModel()).status).toBe("fail");
    expect(run("resource.lead_contact", makeModel({ statements: { leadContact: statement("Lead Contact", "Requests go to the lead contact.") } })).summary).toContain("e-mail");
    expect(run("resource.lead_contact", makeModel({ statements: { leadContact: statement("Lead Contact", "Requests should be directed to Jane Doe (jane.doe@example.edu).") } })).status).toBe("pass");
    expect(run("resource.lead_contact", makeModel({ statements: { leadContact: statement("Lead Contact", "contact: jane.doe@example.edu") } })).status).toBe("review");
  });

  it("materials availability content and data/code bullets", () => {
    expect(run("resource.materials_availability", makeModel({ statements: { materialsAvailability: statement("Materials Availability", "Plasmids are available upon request.") } })).status).toBe("pass");
    expect(run("resource.materials_availability", makeModel({ statements: { materialsAvailability: statement("Materials Availability", "See above.") } })).status).toBe("review");
    expect(run("resource.data_code_availability", makeModel()).status).toBe("fail");
    const separate = makeModel({ statements: { dataAvailability: statement("Data availability", "x"), codeAvailability: statement("Code availability", "y") } });
    expect(run("resource.data_code_availability", separate).summary).toContain('Separate "Data availability" and "Code availability"');
    const noBullets = makeModel({ statements: { dataAndCodeAvailability: statement("Data and Code Availability", "Data are in GEO. Accession numbers are listed in the key resources table.") } });
    expect(run("resource.data_code_availability", noBullets).summary).toContain("0 bullet points");
    const good = makeModel({ statements: { dataAndCodeAvailability: statement("Data and Code Availability", "• Data deposited; accession numbers are in the key resources table.\n• No original code.\n• Other items on request.") } });
    expect(run("resource.data_code_availability", good).status).toBe("pass");
  });
});

describe("data deposition", () => {
  const withFeature = (key: keyof ManuscriptModel["features"], extra: Partial<ManuscriptModel> = {}) =>
    makeModel({ features: { ...makeModel().features, [key]: { present: true, evidence: ["evidence"] } }, ...extra });
  const accession = (id: string, repository: string) => ({ id, repository, span: { start: 0, end: id.length } });

  it("rnaseq / proteomics: accession codes must exist and be in the KRT", () => {
    expect(applies("data.rnaseq", makeModel())).toBe(false);
    expect(run("data.rnaseq", withFeature("rnaSeq")).summary).toContain("no matching accession code");
    const noKrt = withFeature("rnaSeq", { text: "CRA047096", accessions: [accession("CRA047096", "NGDC Genome Sequence Archive")] });
    expect(run("data.rnaseq", noKrt)).toMatchObject({ status: "fail", summary: expect.stringContaining("no Key Resources Table") });
    const krtWithout = { ...noKrt, statements: { keyResourcesTable: statement("KEY RESOURCES TABLE", "Deposited data\nnothing") }, starMethods: { ...noKrt.starMethods, hasKeyResourcesTable: true } };
    expect(run("data.rnaseq", krtWithout).summary).toContain("not listed in the Key Resources Table: CRA047096");
    const krtWith = { ...krtWithout, statements: { keyResourcesTable: statement("KEY RESOURCES TABLE", "Deposited data\nRNA-seq CRA047096") } };
    expect(run("data.rnaseq", krtWith).status).toBe("pass");
    const proteomics = withFeature("proteomics", { accessions: [accession("PXD012345", "PRIDE")], starMethods: star({ hasKeyResourcesTable: true }) });
    expect(run("data.proteomics", proteomics)).toMatchObject({ status: "pass", confidence: "medium" });
  });

  it("deposition checks apply only to data the paper generated", () => {
    const reused = makeModel({ features: { ...makeModel().features, microarray: { present: true, evidence: ["downloaded from GEO"], generated: false } } });
    expect(applies("data.microarray", reused)).toBe(false);
    expect(run("data.microarray", reused)).toMatchObject({ status: "not_applicable", summary: expect.stringContaining("reused public data") });
    const generated = makeModel({ features: { ...makeModel().features, microarray: { present: true, evidence: ["we performed"], generated: true } } });
    expect(applies("data.microarray", generated)).toBe(true);
    expect(run("data.microarray", generated).status).toBe("fail");
    // Hand-built models without the flag are treated as generated.
    expect(applies("data.proteomics", withFeature("proteomics"))).toBe(true);
    // The accession-request check ignores reused data types too.
    expect(applies("data.accession_request", reused)).toBe(false);
  });

  it("accession request, custom code, separate accession section, accessions in KRT", () => {
    const rna = withFeature("rnaSeq");
    expect(applies("data.accession_request", makeModel())).toBe(false);
    expect(run("data.accession_request", rna).summary).toContain("no accession codes");
    rna.accessions = [accession("GSE1", "GEO")];
    expect(run("data.accession_request", rna).summary).toContain("no data availability statement");
    rna.statements.dataAvailability = statement("Data availability", "Deposited.");
    expect(run("data.accession_request", rna).status).toBe("pass");

    const code = withFeature("customCode");
    expect(run("data.custom_code", code).status).toBe("fail");
    code.statements.codeAvailability = statement("Code availability", "Code is at https://github.com/x/y");
    expect(run("data.custom_code", code).status).toBe("pass");
    code.statements.codeAvailability = statement("Code availability", "This study did not generate original code.");
    expect(run("data.custom_code", code).status).toBe("review");
    expect(applies("data.supplementary_software", makeModel({ text: "see Supplementary Software 1" }))).toBe(true);

    expect(run("data.separate_accession_section", makeModel({ outline: [heading("Accession codes", 0)] })).status).toBe("fail");
    expect(run("data.separate_accession_section", makeModel()).status).toBe("pass");

    expect(applies("data.accessions_not_in_krt", makeModel())).toBe(false);
    const krt = makeModel({ accessions: [accession("GSE1", "GEO"), accession("PXD1", "PRIDE")], statements: { keyResourcesTable: statement("KRT", "Deposited data GSE1") } });
    expect(applies("data.accessions_not_in_krt", krt)).toBe(true);
    expect(run("data.accessions_not_in_krt", krt).summary).toContain("PXD1");
  });
});

describe("experimental model, statistics, trials, KRT", () => {
  it("experimental model section is required for animal/human work in STAR Methods", () => {
    const base = makeModel({ starMethods: star({ headings: ["METHOD DETAILS"] }), features: { ...makeModel().features, vertebrates: { present: true, evidence: [] } } });
    expect(applies("star.experimental_model", makeModel())).toBe(false);
    expect(run("star.experimental_model", base).status).toBe("fail");
    base.starMethods.headings = ["EXPERIMENTAL MODEL AND SUBJECT DETAILS"];
    expect(run("star.experimental_model", base).summary).toContain("missing animal ethics committee approval");
    base.statements.ethicsAnimal = statement("Mice", "Approved by the IACUC.");
    base.features.sexReported = { present: true, evidence: [] };
    base.features.ageReported = { present: true, evidence: [] };
    expect(run("star.experimental_model", base).status).toBe("pass");
  });

  it("quantification section must exist and be substantive", () => {
    expect(run("star.quantification", makeModel()).status).toBe("fail");
    const thin = makeModel({ sections: [section("Statistical analysis", 0, "We used statistics.")] });
    expect(run("star.quantification", thin).status).toBe("review");
    const rich = makeModel({ sections: [section("Quantification and statistical analysis", 0, "Two-sided t-tests; n = 3 mice per group; data are mean ± s.e.m.; GraphPad Prism.")] });
    expect(run("star.quantification", rich).status).toBe("pass");
    expect(run("star.quantification", makeModel({ starMethods: star({ headings: ["QUANTIFICATION AND STATISTICAL ANALYSIS"] }) })).status).toBe("review");
  });

  it("clinical trials need a registry number in Additional Resources", () => {
    const trial = makeModel({ text: "Registered as NCT01234567.", features: { ...makeModel().features, clinicalTrial: { present: true, evidence: [] } } });
    expect(run("star.clinical_trial", trial).status).toBe("review");
    trial.statements.additionalResources = statement("Additional resources", "NCT01234567");
    expect(run("star.clinical_trial", trial).status).toBe("pass");
    expect(run("star.clinical_trial", makeModel()).status).toBe("fail");
  });

  it("KRT must be present and use the standard headings", () => {
    expect(run("krt.present", makeModel()).status).toBe("fail");
    expect(run("krt.present", makeModel({ starMethods: star({ hasKeyResourcesTable: true }) })).status).toBe("pass");
    expect(applies("krt.customized", makeModel())).toBe(false);
    expect(run("krt.customized", makeModel({ starMethods: star({ hasKeyResourcesTable: true }) })).status).toBe("review");
    const standard = makeModel({ statements: { keyResourcesTable: statement("KRT", "REAGENT or RESOURCE\nAntibodies\nAnti-WDG1 Cat#123\nDeposited data\nSoftware and algorithms") } });
    expect(run("krt.customized", standard).status).toBe("pass");
    const custom = makeModel({ statements: { keyResourcesTable: statement("KRT", "Antibodies\nMouse strains\nHome-made plasmids") } });
    expect(run("krt.customized", custom).summary).toContain("Mouse strains");
  });
});
