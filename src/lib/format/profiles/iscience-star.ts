/**
 * iScience checks for the STAR Methods block of the pre-accept checklist
 * (rows 44-72): STAR structure, RESOURCE AVAILABILITY, EXPERIMENTAL MODEL AND
 * SUBJECT DETAILS, METHOD DETAILS, QUANTIFICATION AND STATISTICAL ANALYSIS,
 * ADDITIONAL RESOURCES and the KEY RESOURCES TABLE. The ALL-CAPS header rows of
 * the spreadsheet are the categories below, not checks.
 */

import type { ManuscriptModel } from "../manuscript-model";
import type { FormatCheck } from "../profile";
import { clipText, def, hasMethods, rule } from "./iscience-def";
import { depositionCheck, methodsText } from "./shared-rules";
import {
  dataCodeAvailabilityCheck,
  leadContactStatementCheck,
  materialsAvailabilityCheck,
  resourceAvailabilitySectionCheck,
} from "./iscience-rules";
import {
  accessionRequestCheck,
  accessionsInKrtApply,
  accessionsInKrtCheck,
  clinicalTrialCheck,
  customCodeCheck,
  dataGenerated,
  depositsApply,
  experimentalModelCheck,
  krtCustomizedCheck,
  krtPresent,
  krtPresentCheck,
  quantificationCheck,
  separateAccessionSectionCheck,
  separateReferenceListCheck,
  starComplexTablesCheck,
  starEmbeddedFiguresCheck,
  starEmbeddedTablesCheck,
  starHeadingsOrderCheck,
  starPresentCheck,
  starSubheadingsCheck,
  supplementarySoftwareApplies,
} from "./iscience-star-rules";

const star = (m: ManuscriptModel) => m.starMethods.present;
/**
 * Methods text for the semantic checks, STAR or classic ("Materials and
 * Methods" with subsections), clipped so one manuscript stays one prompt.
 */
const methodsExcerpt = (m: ManuscriptModel, n = 9000) => {
  const text = methodsText(m);
  return text ? clipText(text, n) : null;
};

export const starChecks: FormatCheck[] = [
  def("star.present", {
    category: "star_methods", severity: "required",
    guideline: "The STAR Methods section should be in the main document after the figure legends, with the standard headings.",
    detector: rule(starPresentCheck),
  }),
  def("star.headings_order", {
    category: "star_methods", severity: "required",
    guideline: "STAR Methods headings in order: RESOURCE AVAILABILITY; EXPERIMENTAL MODEL AND SUBJECT DETAILS (life-science models only); METHOD DETAILS; QUANTIFICATION AND STATISTICAL ANALYSIS; ADDITIONAL RESOURCES.",
    appliesWhen: star, detector: rule(starHeadingsOrderCheck),
  }),
  def("star.subheadings", {
    category: "star_methods", severity: "required",
    guideline: "Up to two levels of subheadings may be used in STAR Methods; numbering is not allowed.",
    appliesWhen: star, detector: rule(starSubheadingsCheck),
  }),
  def("star.references_in_lieu", {
    category: "star_methods", severity: "required",
    guideline: "References may be cited but cannot be used in lieu of reporting the details of methods or analyses.",
    appliesWhen: hasMethods,
    detector: {
      kind: "llm",
      prompt: (m) => {
        const excerpt = methodsExcerpt(m);
        return excerpt ? {
          instructions: "Identify procedures or analyses that are described only by a citation (e.g. 'performed as described in ref. 12', 'according to [23]') with no actual details given. Fail when key methods are replaced by citations, review when a few minor steps are, pass when the methods are described in their own words.",
          excerpt,
        } : null;
      },
    },
  }),
  def("star.separate_reference_list", {
    category: "star_methods", severity: "required",
    guideline: "References cited in STAR Methods must be in the single main reference list.",
    detector: rule(separateReferenceListCheck),
  }),
  def("star.complex_tables", {
    category: "star_methods", severity: "required",
    guideline: "Complex tables (split cells, shading, multiple levels) or tables longer than one page cannot be embedded in STAR Methods.",
    appliesWhen: (m) => m.starMethods.tablesEmbedded > 0, detector: rule(starComplexTablesCheck),
  }),
  def("star.numbered_tables", {
    category: "star_methods", severity: "required",
    guideline: "Tables embedded in the STAR Methods text cannot be numbered.",
    appliesWhen: star, detector: rule(starEmbeddedTablesCheck),
  }),
  def("star.embedded_figures", {
    category: "star_methods", severity: "required",
    guideline: "Figures cannot be embedded within STAR Methods.",
    appliesWhen: star, detector: rule(starEmbeddedFiguresCheck),
  }),

  // RESOURCE AVAILABILITY
  def("resource.section", {
    category: "statements", severity: "required",
    question: 'Is the "Resource Availability" section (Lead Contact / Materials Availability / Data and Code Availability) missing or incomplete?',
    guideline: 'The manuscript must include a section titled "Resource Availability" with the subheadings "Lead Contact", "Materials Availability" and "Data and Code Availability".',
    detector: rule(resourceAvailabilitySectionCheck), sourceRef: "FFC body",
  }),
  def("resource.lead_contact", {
    category: "statements", severity: "required",
    guideline: "The Lead Contact statement must give the full name and e-mail address of the author taking the lead contact role, matching the title page.",
    detector: rule(leadContactStatementCheck),
  }),
  def("resource.materials_availability", {
    category: "statements", severity: "required",
    guideline: "The Materials Availability statement must report where materials generated in the study are available, or state that none were generated / that restrictions apply.",
    detector: rule(materialsAvailabilityCheck),
  }),
  def("resource.data_code_availability", {
    category: "statements", severity: "required",
    guideline: "The Data and Code Availability statement is structured as three bullet points (data, code, other) and refers to the key resources table for accession numbers.",
    detector: rule(dataCodeAvailabilityCheck),
  }),
  def("data.accession_request", {
    category: "data_deposition", severity: "required",
    guideline: "Datasets that must be deposited in a community repository (sequences, structures, microarray, RNA-seq) need accession codes and an availability statement.",
    appliesWhen: depositsApply, detector: rule(accessionRequestCheck),
  }),
  def("data.custom_code", {
    category: "data_deposition", severity: "required",
    guideline: "Unpublished custom code central to the claims must be archived with a DOI or unique identifier reported in Data and Code Availability and the KRT.",
    appliesWhen: (m) => m.features.customCode.present, detector: rule(customCodeCheck),
  }),
  def("data.supplementary_software", {
    category: "data_deposition", severity: "required",
    guideline: "Supplementary software must be described in Data and Code Availability and listed in the KRT.",
    appliesWhen: supplementarySoftwareApplies, detector: rule(customCodeCheck),
  }),
  def("data.separate_accession_section", {
    category: "data_deposition", severity: "required",
    guideline: "Accession codes belong in Data and Code Availability and under Deposited Data in the KRT, not in a separate section.",
    detector: rule(separateAccessionSectionCheck),
  }),
  def("data.accessions_not_in_krt", {
    category: "data_deposition", severity: "required",
    guideline: "Accession codes must be reported in the Key Resources Table and referenced in Data and Code Availability.",
    appliesWhen: accessionsInKrtApply, detector: rule(accessionsInKrtCheck),
  }),
  def("data.structures", {
    category: "data_deposition", severity: "required",
    guideline: "Structures must be deposited (PDB/EMDB) with accession codes in the KRT and Data and Code Availability.",
    appliesWhen: (m) => dataGenerated(m, "proteinStructure"),
    detector: rule((m) => depositionCheck(m, "proteinStructure", /PDB|EMDB|EMD-|BMRB|\b[1-9][A-Z0-9]{3}\b/i, "protein structure")),
  }),
  def("data.gene_sequences", {
    category: "data_deposition", severity: "required",
    guideline: "Novel gene sequences must be deposited (GenBank/ENA/DDBJ) with accession codes in the KRT and Data and Code Availability.",
    appliesWhen: (m) => dataGenerated(m, "geneSequences"),
    detector: rule((m) => depositionCheck(m, "geneSequences", /GenBank|ENA|DDBJ|NCBI|RefSeq|GSA|CRA\d|PRJ[NED]|SRA|SRR|SRP|SAMN|\b[A-Z]{1,2}\d{5,8}(?:\.\d)?\b/i, "gene sequence")),
  }),
  def("data.proteomics", {
    category: "data_deposition", severity: "required",
    guideline: "Proteomics data must be deposited (PRIDE/ProteomeXchange/iProX/MassIVE/OMIX) with accession codes in the KRT and Data and Code Availability.",
    appliesWhen: (m) => dataGenerated(m, "proteomics"),
    detector: rule((m) => depositionCheck(m, "proteomics", /PRIDE|PXD\d|ProteomeXchange|iProX|IPX\d|MassIVE|MSV\d|OMIX\d|jPOST|PeptideAtlas/i, "proteomics")),
  }),
  def("data.microarray", {
    category: "data_deposition", severity: "required",
    guideline: "Microarray data must be deposited (GEO/ArrayExpress) with accession codes in the KRT and Data and Code Availability.",
    appliesWhen: (m) => dataGenerated(m, "microarray"),
    detector: rule((m) => depositionCheck(m, "microarray", /GEO|GSE\d|GDS\d|ArrayExpress|E-MTAB|E-GEOD|OMIX\d/i, "microarray")),
  }),
  def("data.rnaseq", {
    category: "data_deposition", severity: "required",
    guideline: "RNA-seq data must be deposited (GEO/SRA/ENA/GSA/ArrayExpress) with accession codes in the KRT and Data and Code Availability.",
    appliesWhen: (m) => dataGenerated(m, "rnaSeq"),
    detector: rule((m) => depositionCheck(m, "rnaSeq", /GEO|GSE\d|SRA|SRP\d|SRR\d|PRJ[NED][A-Z]\d|ENA|ERP\d|GSA|CRA\d|HRA\d|OMIX\d|ArrayExpress|E-MTAB|DDBJ|DRA\d/i, "RNA-seq")),
  }),

  // EXPERIMENTAL MODEL AND SUBJECT DETAILS
  def("star.experimental_model", {
    category: "ethics", severity: "required",
    guideline: "List every experimental model (animals, humans, plants, microbes, cell lines) with species, genotype, age/developmental stage, sex, maintenance and institutional approval.",
    appliesWhen: (m) => m.starMethods.present && (m.features.vertebrates.present || m.features.humans.present),
    detector: rule(experimentalModelCheck),
  }),

  // METHOD DETAILS
  def("star.method_details", {
    category: "star_methods", severity: "required",
    guideline: "Method Details are not length-limited and must describe how and why procedures were conducted in enough detail to be reproduced.",
    appliesWhen: hasMethods,
    detector: {
      kind: "llm",
      prompt: (m) => {
        const excerpt = methodsExcerpt(m);
        return excerpt ? {
          instructions: "Judge whether the methods give enough detail for a reader to reproduce the experiments and analyses without consulting other papers: reagents with sources, concentrations, times, instruments, software versions and parameters. Fail when the section is thin or mostly citations; review when one or two procedures need expansion (name them in the summary); pass otherwise.",
          excerpt,
        } : null;
      },
    },
  }),
  def("references.datasets_code_cited", {
    category: "references", severity: "required",
    guideline: "Datasets, program code and methods used must be cited in the text and listed in the references, as publications or persistent identifiers (DOI).",
    appliesWhen: hasMethods,
    detector: {
      kind: "llm",
      prompt: (m) => {
        const excerpt = methodsExcerpt(m, 7000);
        return excerpt ? {
          instructions: "List the software packages, public datasets and published methods used in these methods. For each, is it cited with a reference number or a persistent identifier (DOI, RRID, URL with version)? Pass when all are cited, review when a few tools lack a citation (name them), fail when most are uncited.",
          excerpt,
        } : null;
      },
    },
  }),

  // QUANTIFICATION AND STATISTICAL ANALYSIS
  def("star.quantification", {
    category: "star_methods", severity: "required",
    guideline: "Describe all statistical analyses and software: tests used, exact n and what it represents, definitions of center, dispersion and precision measures.",
    appliesWhen: hasMethods, detector: rule(quantificationCheck),
  }),

  // ADDITIONAL RESOURCES
  def("star.clinical_trial", {
    category: "star_methods", severity: "required",
    guideline: "Clinical trial registry numbers and links go in the Additional Resources section of the STAR Methods.",
    appliesWhen: (m) => m.features.clinicalTrial.present, detector: rule(clinicalTrialCheck),
  }),

  // KEY RESOURCES TABLE
  def("krt.present", {
    category: "star_methods", severity: "required",
    guideline: "A Key Resources Table built from the Cell Press template is required and uploaded as a separate Word document.",
    detector: rule(krtPresentCheck),
  }),
  def("krt.customized", {
    category: "star_methods", severity: "required",
    guideline: "The Key Resources Table must use the standard subheadings only; no merged cells or customised headings.",
    appliesWhen: krtPresent, detector: rule(krtCustomizedCheck),
  }),
];
