/**
 * Feature detection, data-deposition accessions and discouraged phrases.
 *
 * "Features" are the conditions journal rules hang off: a rule about blots
 * only applies when the paper has blots, a rule about animal sex only applies
 * when vertebrates were used. Each feature records short evidence snippets so
 * a check can quote why it fired.
 */

import type { AccessionRef, Feature, FeatureKey, Hit, PhraseHits } from "./model-types";
import { contextAround, matchAll } from "./text-utils";

/** Regexes are deliberately broad; the evidence snippets keep them auditable. */
const FEATURE_PATTERNS: Record<FeatureKey, RegExp> = {
  rnaSeq:
    /\bRNA[-\s]?seq(?:uencing)?\b|\bRNAseq\b|\bscRNA(?:-seq)?\b|single[-\s]cell RNA|\bbulk RNA\b|transcriptome sequencing|\b10x Genomics\b/gi,
  proteomics:
    /\bproteomics?\b|\bproteomic analysis\b|mass spectrometry|\bLC[-–]MS\b|\bMS\/MS\b|\bTMT\b labell?ing|label[-\s]free quantification/gi,
  microarray: /\bmicroarrays?\b|\bgene chip\b|Affymetrix|BeadChip/gi,
  proteinStructure:
    /\bcryo[-\s]?EM\b|crystal structure|crystallograph\w*|\bPDB\b|Protein Data Bank|NMR structure|\bEMDB\b|structure determination/gi,
  geneSequences:
    /\bGenBank\b|\bENA\b|newly (?:identified|cloned) (?:gene|sequence)|sequences? (?:have|has) been deposited|\bnucleotide sequences?\b/gi,
  novelCompounds:
    /\bnovel compound\b|\bnew compound\b|synthesi[sz]ed compounds?|compound characteri[sz]ation|\bHRMS\b|elemental analysis|\b1H NMR\b/gi,
  equations: /\bequations?\b|\bEqs?\.\s*\(?\d|\bformula\b/gi,
  videos:
    /\b(?:supplementary |supplemental )?(?:videos?|movies?)\s*S?\d|\.mp4\b|\.mov\b|\.avi\b|time[-\s]lapse (?:video|movie)|\bFigure360\b/gi,
  blotsOrGels:
    /\b(?:western|immuno)[\s-]?blot(?:ting|s)?\b|gel electrophoresis|SDS[-–]PAGE|\bagarose gel\b|\bCoomassie\b|\bnorthern blot\b|\bsouthern blot\b/gi,
  micrographs:
    /\bmicrographs?\b|\bconfocal\b|\bmicroscop(?:y|e)\b|\bscale bars?\b|\bimmunofluorescence\b|live[-\s]cell imaging|\bTEM\b|\bSEM\b/gi,
  errorBars:
    /\berror bars?\b|mean\s*±|±\s*(?:s\.?\s?e\.?\s?m\.?|s\.?\s?d\.?|sem|sd|standard\s+(?:error|deviation))/gi,
  asterisks: /\*{1,4}\s*[,:]?\s*[Pp]\s*[<>=≤≥]|\basterisks?\b/gi,
  vertebrates:
    /\bmice\b|\bmouse\b|\brats?\b|\bzebrafish\b|\bxenopus\b|\brabbits?\b|\bmonkeys?\b|\bmacaques?\b|\bpiglets?\b|\bchickens?\b|\bvertebrates?\b|\bC57BL\/6\b|\bBALB\/c\b/gi,
  humans:
    /\bpatients?\b|\bparticipants?\b|human (?:subjects?|donors?|samples?|tissues?|volunteers?|cells?|participants?)|healthy (?:donors?|volunteers?)|patient[-\s]derived|\bPDX\b/gi,
  clinicalTrial:
    /\bclinical trials?\b|\bNCT\d{6,}\b|\bISRCTN\d+\b|\bChiCTR[-\w]*\d+\b|pre[-\s]?registered|trial registry/gi,
  batteriesOrPV:
    /\bbatter(?:y|ies)\b|\bphotovoltaics?\b|\bsolar cells?\b|coulombic efficiency|\bperovskite\b|\bOPV\b/gi,
  // "sensor" alone is excluded: in biology a protein is routinely called a
  // DNA-damage sensor, which is not a device.
  devices:
    /\bdevices?\b|\bmicrofluidics?\b|\belectrodes?\b|\btransistors?\b|\bbiosensors?\b|\bwearables?\b/gi,
  customCode:
    /custom (?:code|scripts?|software|MATLAB|Python)|scripts? (?:are|is|were) available|\bGitHub\b|github\.com|\bZenodo\b|code (?:is|are|has been|have been) (?:available|deposited)/gi,
  sexReported:
    /\b(?:males?|females?)\b|\bboth sexes\b|\bsex (?:of|was|were|is|as a biological variable)\b/gi,
  ageReported:
    /\b\d{1,3}\s*[-–]?\s*(?:to|–|-)?\s*\d{0,3}\s*(?:weeks?|months?|days?|years?)[\s-]old\b|\baged\s+\d{1,3}\b|\bage[sd]?\s+(?:range|of)\s+\d|\bP\d{1,2}\s+(?:pups|mice|neonates)\b/gi,
  molecularWeightMarkers:
    /\b(?:molecular[-\s](?:weight|mass)|size)\s+(?:markers?|standards?|ladders?)\b|\bkDa\b|\bprotein ladder\b|\bmarker lanes?\b/gi,
};

/**
 * Data types a journal asks authors to deposit. For these, `generated`
 * distinguishes a paper that produced the data from one that only reanalysed
 * public datasets (the microarray cohorts of a survival analysis, say).
 */
export const DEPOSITABLE_FEATURES: readonly FeatureKey[] = ["rnaSeq", "proteomics", "microarray", "proteinStructure", "geneSequences"];

/** Wording that says the authors produced the data themselves. */
const GENERATED_RE =
  /\bwe\s+(?:performed|conducted|generated|sequenced|profiled|carried out|determined|solved|collected)\b|\b(?:was|were)\s+(?:performed|conducted|generated|carried out|collected|determined|solved|sequenced|profiled)\b|\bsubjected to\b|\bdeposited\b|\baccession\b|\bgenerated in this (?:study|paper|work)\b|\blibrar(?:y|ies)\s+(?:was|were)\s+(?:prepared|constructed|generated)\b|\blibrary preparation\b|\bsequenc(?:ed|ing)\s+(?:was\s+)?(?:performed|done)\s+on\b|\bsequenced on\b/i;

/** Wording that says the data came from somewhere else. */
const REUSED_RE =
  /\bpublicly available\b|\bpublic(?:ly)? (?:data(?:set)?s?|repositor(?:y|ies)|database)\b|\bdownloaded\b|\b(?:obtained|retrieved|acquired|extracted|accessed|collected)\s+from\s+(?:the\s+)?(?:GEO|TCGA|GTEx|ArrayExpress|SRA|PRIDE|PDB|a\s+public|the\s+public|publicly|\w+\s+database|\w+\s+repository)\b|\bTCGA\b|\bGTEx\b|\bcBioPortal\b|\bKaplan[-–\s]?Meier\s+Plotter\b|\bKM[-\s]?plotter\b|\bGEPIA\b|\bOncomine\b|\bpreviously (?:published|reported|described|deposited)\b|\bcohorts?\b|\bprobe\s+\d|\bmeta-?analysis\b|\bre-?analy[sz]ed\b/i;

/**
 * The sentence a match sits in: back to the previous sentence end (or blank
 * line) and forward to the next one, capped so a PDF line soup cannot grow
 * the window without bound.
 */
export function sentenceAround(text: string, start: number, end: number, cap = 300): string {
  let from = start;
  while (from > 0 && start - from < cap) {
    const ch = text[from - 1];
    if ((/[.!?]/.test(ch) && /\s/.test(text[from] ?? " ")) || (ch === "\n" && text[from - 2] === "\n")) break;
    from -= 1;
  }
  let to = end;
  while (to < text.length && to - end < cap) {
    const ch = text[to];
    if (/[.!?]/.test(ch) && /\s|$/.test(text[to + 1] ?? "")) {
      to += 1;
      break;
    }
    if (ch === "\n" && text[to + 1] === "\n") break;
    to += 1;
  }
  return text.slice(from, to).replace(/\s+/g, " ").trim();
}

/**
 * Did the paper generate this kind of data? Each mention is judged by its
 * sentence: reuse wording (public cohorts, downloaded datasets) wins over
 * generation wording within one sentence ("data were collected from GEO").
 * One sentence that clearly reports generation makes the feature generated;
 * otherwise any explicit reuse marks it reused; with neither we assume
 * generated, because a missed deposition is the costlier error.
 */
export function classifyGeneration(text: string, spans: Array<{ start: number; end: number }>): boolean {
  let reused = false;
  for (const span of spans) {
    const sentence = sentenceAround(text, span.start, span.end);
    if (REUSED_RE.test(sentence)) {
      reused = true;
      continue;
    }
    if (GENERATED_RE.test(sentence)) return true;
  }
  return !reused;
}

/** Builds the feature map with up to three evidence snippets each. */
export function detectFeatures(text: string): Record<FeatureKey, Feature> {
  const out = {} as Record<FeatureKey, Feature>;
  for (const key of Object.keys(FEATURE_PATTERNS) as FeatureKey[]) {
    const hits = matchAll(text, FEATURE_PATTERNS[key]);
    const evidence: string[] = [];
    const seen = new Set<string>();
    for (const hit of hits) {
      const snippet = contextAround(text, hit.span.start, hit.span.end, 50);
      const key2 = snippet.slice(0, 40).toLowerCase();
      if (seen.has(key2)) continue;
      seen.add(key2);
      evidence.push(snippet);
      if (evidence.length >= 3) break;
    }
    const present = hits.length > 0;
    const generated = present && (DEPOSITABLE_FEATURES.includes(key) ? classifyGeneration(text, hits.map((h) => h.span)) : true);
    out[key] = { present, evidence, generated };
  }
  return out;
}

interface AccessionPattern {
  re: RegExp;
  repository: string;
}

const ACCESSION_PATTERNS: AccessionPattern[] = [
  { re: /\bGSE\d{3,8}\b/g, repository: "GEO" },
  { re: /\bGSM\d{3,9}\b/g, repository: "GEO" },
  { re: /\b(?:SRP|SRR|SRX|SRS)\d{5,9}\b/g, repository: "SRA" },
  { re: /\bPRJNA\d{4,9}\b/g, repository: "BioProject" },
  { re: /\bPRJEB\d{3,9}\b/g, repository: "ENA" },
  { re: /\bPXD\d{5,7}\b/g, repository: "PRIDE" },
  { re: /\bMSV\d{6,9}\b/g, repository: "MassIVE" },
  { re: /\bE-(?:MTAB|GEOD|TABM)-\d{3,6}\b/g, repository: "ArrayExpress" },
  { re: /\bEMD-\d{3,6}\b/g, repository: "EMDB" },
  { re: /\bCRA\d{4,8}\b/g, repository: "NGDC Genome Sequence Archive" },
  { re: /\bOMIX\d{3,8}\b/g, repository: "NGDC OMIX" },
  { re: /\bHRA\d{4,8}\b/g, repository: "NGDC GSA-Human" },
  { re: /\b10\.5281\/zenodo\.\d+\b/gi, repository: "Zenodo" },
  { re: /\b10\.17632\/[\w.]+\b/gi, repository: "Mendeley Data" },
  { re: /\b10\.5061\/dryad\.[\w.]+\b/gi, repository: "Dryad" },
  // PDB ids are only recognised next to an explicit PDB mention, since a bare
  // 4-character code is far too common to match on its own.
  {
    re: /\b(?:PDB|Protein Data Bank)(?:\s+(?:ID|accession|entry|code))?\s*:?\s*(\d[A-Za-z0-9]{3})\b/g,
    repository: "PDB",
  },
  {
    re: /\b(?:GenBank|accession(?:\s+(?:number|no\.?|code))?)\s*:?\s*([A-Z]{1,2}\d{5,6}(?:\.\d+)?)\b/g,
    repository: "GenBank",
  },
];

export function detectAccessions(text: string): AccessionRef[] {
  const out: AccessionRef[] = [];
  const seen = new Set<string>();
  for (const pattern of ACCESSION_PATTERNS) {
    for (const { match, span } of matchAll(text, pattern.re)) {
      const id = (match[1] ?? match[0]).trim();
      const dedupeKey = `${pattern.repository}:${id}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({ id, repository: pattern.repository, span });
    }
  }
  return out.sort((a, b) => a.span.start - b.span.start);
}

const NOVELTY =
  /\bnovel(?:ty)?\b|\bfor the first time\b|\bunprecedented\b|\bnew (?:approach|method|mechanism|compound|class|paradigm|concept|strategy|insight|family)\b/gi;
const AS_DESCRIBED_PREVIOUSLY =
  /\bas\s+(?:described|reported|shown|performed)\s+(?:previously|before|elsewhere)\b|\bas\s+previously\s+(?:described|reported|shown|performed)\b|\b(?:described|performed)\s+previously\s+(?:in|by)\b/gi;
const PERSONAL_COMMUNICATION =
  /\bpersonal communications?\b|\bunpublished (?:data|results|observations|work)\b|\bdata not shown\b|\bmanuscript (?:in preparation|submitted)\b|\bsubmitted for publication\b|\bin preparation\b/gi;

function toHits(text: string, pattern: RegExp): Hit[] {
  return matchAll(text, pattern).map(({ match, span }) => ({
    text: match[0],
    context: contextAround(text, span.start, span.end, 70),
    span,
  }));
}

export function detectPhraseHits(text: string): PhraseHits {
  return {
    novelty: toHits(text, NOVELTY),
    asDescribedPreviously: toHits(text, AS_DESCRIBED_PREVIOUSLY),
    personalCommunication: toHits(text, PERSONAL_COMMUNICATION),
  };
}
