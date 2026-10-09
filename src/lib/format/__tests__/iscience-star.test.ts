/**
 * iScience STAR Methods, Resource Availability, data deposition and KRT rule
 * detectors (spreadsheet rows 44-72), on synthetic models.
 */

import { describe, it, expect } from "vitest";
import type { ManuscriptModel } from "../manuscript-model";
import { iscienceProfile } from "../profiles/iscience";
import { compliantIscienceModel, heading, makeModel, section, statement } from "./profile-fixtures";

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
    for (const id of ["star.references_in_lieu", "star.method_details", "references.datasets_code_cited"]) {
      const c = check(id);
      expect(c.detector.kind).toBe("llm");
      if (c.detector.kind !== "llm") continue;
      expect(applies(id, makeModel())).toBe(false);
      const withMethods = makeModel({ sections: [section("Methods", 0, "We did things.")] });
      expect(applies(id, withMethods)).toBe(true);
      expect(c.detector.prompt(withMethods)?.excerpt).toBe("We did things.");
    }
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
