/**
 * "Possibly deceased" screen for reviewer candidates, in three layers:
 *   1. PubMed — obituary / biography / historical-article records whose title names the person;
 *   2. Wikidata — a human entry with a date of death in the last 15 years that looks academic
 *      (or carries the reviewer's ORCID);
 *   3. a web search judged by Claude (web search tool), for names the free sources don't settle.
 * Each layer is conservative: the reviewer's full name must appear with a death cue. Flagged
 * reviewers sort to the bottom and the card shows the search behind the flag, so the editor decides.
 */

import { z } from "zod";
import { ANTHROPIC_HAIKU_MODEL, responseText } from "@/lib/anthropic-models";
import { googleSearchUrl, webSearch, type WebSearchHit, type WebSearchProvider } from "./web-search";
import { isHighConfidencePersonMatch } from "./reputation-check";

const DECEASED_DISCLAIMER =
  "Automated check only. A match can be a namesake or a relative; verify before acting on it.";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BATCH_CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 9000;
const PUBMED_GAP_MS = 350; // E-utilities allow 3 requests/s without an API key
const USER_AGENT = "PubliMentor/1.0 (reviewer screening; https://www.publimentor.com)";
const MAX_YEARS_SINCE_DEATH = 15;

const DEATH_TERMS =
  /\b(obituary|obituaries|passed away|has died|had died|died (on|peacefully|suddenly|aged|unexpectedly|at (home|the age))|death of|in memoriam|in memory of|remembering|rest in peace|the late|late professor|late dr\.?|tribute to|funeral|condolences)\b/i;
/** "(1927–2019)" style life spans in PubMed titles */
const LIFE_SPAN = /\(\s*(1[89]|20)\d{2}\s*[-–]\s*(19|20)\d{2}\s*\)/;
const ACADEMIC_DESCRIPTION =
  /\b(scientist|researcher|research|professor|academic|scholar|biolog|chemist|chemistry|physicist|physician|medical|surgeon|patholog|pharmacolog|geneticist|neuroscientist|immunolog|microbiolog|virolog|engineer|mathematician|statistician|psycholog|economist|ecolog|epidemiolog|oncolog|cardiolog|biochemist|geolog|astronom|computer scientist|clinician|lecturer|nobel)/i;

export type DeceasedProvider = "pubmed" | "wikidata" | "claude" | WebSearchProvider;

export interface DeceasedEvidence {
  title: string;
  url: string;
  snippet: string;
}

export interface DeceasedCheck {
  possiblyDeceased: boolean;
  /** Which layer produced the flag (or the last one consulted when nothing was found). */
  provider: DeceasedProvider | null;
  query: string;
  /** The search or record behind the flag, for the editor to open. */
  searchUrl: string;
  searchLabel: string;
  evidence: DeceasedEvidence[];
  checkedAt: string;
  disclaimer: string;
}

export interface DeceasedCheckInput {
  name: string;
  firstName?: string;
  lastName?: string;
  affiliation?: string;
  orcid?: string | null;
}

type Person = { name: string; firstName?: string; lastName?: string };

// ---------------------------------------------------------------------------
// Layer 1: PubMed
// ---------------------------------------------------------------------------

export function buildPubMedQuery(name: string): string {
  return `"${name.trim()}"[Title] AND (obituary[pt] OR biography[pt] OR "historical article"[pt])`;
}

export function pubMedSearchUrl(query: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
}

/** A PubMed record counts when its title names the person and carries a life span or a death term. */
export function evaluatePubMedTitles(
  records: Array<{ pmid: string; title: string; pubdate?: string }>,
  person: Person
): DeceasedEvidence[] {
  return records
    .filter((r) => isHighConfidencePersonMatch(r.title, person) && (LIFE_SPAN.test(r.title) || DEATH_TERMS.test(r.title)))
    .map((r) => ({
      title: r.title,
      url: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`,
      snippet: `PubMed record${r.pubdate ? `, ${r.pubdate}` : ""}`,
    }));
}

let pubmedChain: Promise<unknown> = Promise.resolve();
/** Serialises PubMed calls across the concurrent workers with a small gap between them. */
function pacedPubMed<T>(run: () => Promise<T>): Promise<T> {
  const next = pubmedChain.then(() => new Promise((r) => setTimeout(r, PUBMED_GAP_MS))).then(run);
  pubmedChain = next.catch(() => undefined);
  return next;
}

async function checkPubMed(person: Person): Promise<DeceasedEvidence[]> {
  return pacedPubMed(() => checkPubMedNow(person));
}

async function checkPubMedNow(person: Person): Promise<DeceasedEvidence[]> {
  const query = buildPubMedQuery(person.name);
  const email = process.env.PUBMED_EMAIL || process.env.OPENALEX_EMAIL || "";
  const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  const search = new URLSearchParams({ db: "pubmed", term: query, retmax: "10", retmode: "json", ...(email && { email }) });
  const res = await fetch(`${base}/esearch.fcgi?${search}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return [];
  const ids: string[] = (await res.json()).esearchresult?.idlist || [];
  if (ids.length === 0) return [];
  const summary = new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "json", ...(email && { email }) });
  const sres = await fetch(`${base}/esummary.fcgi?${summary}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!sres.ok) return [];
  const result = (await sres.json()).result || {};
  const records = ids
    .map((pmid) => result[pmid])
    .filter((r) => r && typeof r.title === "string")
    .map((r) => ({ pmid: String(r.uid), title: String(r.title), pubdate: r.pubdate ? String(r.pubdate) : undefined }));
  return evaluatePubMedTitles(records, person);
}

// ---------------------------------------------------------------------------
// Layer 2: Wikidata
// ---------------------------------------------------------------------------

export interface WikidataEntity {
  id: string;
  label: string;
  description: string;
  isHuman: boolean;
  dateOfDeath?: string; // YYYY-MM-DD or YYYY
  orcid?: string;
}

/** Entities that are a recently deceased human, named like the reviewer, and academic by description or ORCID. */
export function evaluateWikidataEntities(
  entities: WikidataEntity[],
  person: Person & { orcid?: string | null },
  now = new Date()
): DeceasedEvidence[] {
  const minYear = now.getFullYear() - MAX_YEARS_SINCE_DEATH;
  const orcid = person.orcid?.replace(/^https?:\/\/orcid\.org\//i, "").trim();
  return entities
    .filter((e) => {
      if (!e.isHuman || !e.dateOfDeath) return false;
      const year = parseInt(e.dateOfDeath.slice(0, 4), 10);
      if (!Number.isFinite(year) || year < minYear || year > now.getFullYear()) return false;
      if (!isHighConfidencePersonMatch(e.label, person)) return false;
      if (orcid && e.orcid && e.orcid === orcid) return true;
      return ACADEMIC_DESCRIPTION.test(e.description);
    })
    .map((e) => ({
      title: `${e.label} — ${e.description}`,
      url: `https://www.wikidata.org/wiki/${e.id}`,
      snippet: `Wikidata: date of death ${e.dateOfDeath}${e.orcid ? ` · ORCID ${e.orcid}` : ""}`,
    }));
}

function wikidataTime(claims: Record<string, unknown[]> | undefined, prop: string): string | undefined {
  const c = (claims?.[prop]?.[0] as { mainsnak?: { datavalue?: { value?: { time?: string } } } } | undefined)?.mainsnak?.datavalue?.value?.time;
  return c ? c.replace(/^\+/, "").slice(0, 10).replace(/-00/g, "") : undefined;
}

async function checkWikidata(person: Person & { orcid?: string | null }): Promise<DeceasedEvidence[]> {
  const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };
  const api = "https://www.wikidata.org/w/api.php";
  const s = new URLSearchParams({ action: "wbsearchentities", format: "json", language: "en", type: "item", limit: "7", search: person.name });
  const sres = await fetch(`${api}?${s}`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!sres.ok) return [];
  const ids: string[] = ((await sres.json()).search || []).map((e: { id: string }) => e.id).filter(Boolean);
  if (ids.length === 0) return [];
  const g = new URLSearchParams({ action: "wbgetentities", format: "json", props: "claims|descriptions|labels", languages: "en", ids: ids.join("|") });
  const gres = await fetch(`${api}?${g}`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!gres.ok) return [];
  const entities = (await gres.json()).entities || {};
  const parsed: WikidataEntity[] = Object.keys(entities).map((id) => {
    const e = entities[id];
    const claims = e.claims as Record<string, unknown[]> | undefined;
    const isHuman = ((claims?.P31 || []) as Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>).some(
      (c) => c.mainsnak?.datavalue?.value?.id === "Q5"
    );
    const orcid = (claims?.P496?.[0] as { mainsnak?: { datavalue?: { value?: string } } } | undefined)?.mainsnak?.datavalue?.value;
    return {
      id,
      label: e.labels?.en?.value || "",
      description: e.descriptions?.en?.value || "",
      isHuman,
      dateOfDeath: wikidataTime(claims, "P570"),
      orcid: typeof orcid === "string" ? orcid : undefined,
    };
  });
  return evaluateWikidataEntities(parsed, person);
}

// ---------------------------------------------------------------------------
// Layer 3: web search (keyed providers) and Claude with its web search tool
// ---------------------------------------------------------------------------

export function buildDeceasedQuery(name: string): string {
  return `"${name.trim()}" (obituary OR "passed away" OR "in memoriam" OR died)`;
}

/**
 * Keep hits that mention this person and a death term together. A hit whose
 * title carries both is strong; one hit like that, or two weaker ones, flags the reviewer.
 */
export function evaluateDeceasedEvidence(
  hits: WebSearchHit[],
  person: Person
): { possiblyDeceased: boolean; evidence: DeceasedEvidence[] } {
  let strong = 0;
  const evidence: DeceasedEvidence[] = [];
  for (const hit of hits) {
    const text = `${hit.title} ${hit.snippet}`;
    if (!isHighConfidencePersonMatch(text, person) || !DEATH_TERMS.test(text)) continue;
    if (isHighConfidencePersonMatch(hit.title, person) && DEATH_TERMS.test(hit.title)) strong++;
    evidence.push({ title: hit.title, url: hit.url, snippet: hit.snippet });
  }
  return { possiblyDeceased: strong >= 1 || evidence.length >= 2, evidence };
}

const claudeVerdictSchema = z.object({
  deceased: z.union([z.boolean(), z.literal("unknown")]),
  confidence: z.enum(["high", "medium", "low"]).default("low"),
  evidence: z
    .array(z.object({ title: z.string().max(300).default(""), url: z.string().max(2000), snippet: z.string().max(600).default("") }))
    .max(5)
    .default([]),
});

export function parseClaudeVerdict(text: string): { possiblyDeceased: boolean; evidence: DeceasedEvidence[] } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = claudeVerdictSchema.safeParse(JSON.parse(match[0]));
    if (!parsed.success) return null;
    const v = parsed.data;
    return {
      possiblyDeceased: v.deceased === true && v.confidence !== "low",
      evidence: v.evidence.filter((e) => /^https?:\/\//.test(e.url)),
    };
  } catch {
    return null;
  }
}

export function isClaudeSearchEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && (process.env.DECEASED_CLAUDE_SEARCH || "on").toLowerCase() !== "off";
}

export function claudeSearchBudget(): number {
  const n = parseInt(process.env.DECEASED_CLAUDE_MAX_PER_SEARCH || "15", 10);
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

async function checkWithClaude(input: DeceasedCheckInput): Promise<{ possiblyDeceased: boolean; evidence: DeceasedEvidence[] } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const who = `${input.name.trim()}${input.affiliation ? ` (${input.affiliation.slice(0, 120)})` : ""}`;
  const prompt = `Is the academic researcher ${who} deceased? Search the web for an obituary, "in memoriam" notice or death announcement about this specific person (not a namesake or relative). Use at most two searches.
Respond with ONLY a JSON object: {"deceased": true | false | "unknown", "confidence": "high" | "medium" | "low", "evidence": [{"title": "...", "url": "...", "snippet": "..."}]}. Include evidence only for pages that clearly concern this researcher. Say "unknown" if nothing reliable is found.`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: ANTHROPIC_HAIKU_MODEL,
        max_tokens: 1500,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.error(`[Deceased] Claude search failed for ${input.name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return parseClaudeVerdict(responseText(await res.json()));
  } catch (err) {
    console.error(`[Deceased] Claude search error for ${input.name}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; result: DeceasedCheck }>();

function finish(partial: Omit<DeceasedCheck, "checkedAt" | "disclaimer">): DeceasedCheck {
  return { ...partial, checkedAt: new Date().toISOString(), disclaimer: DECEASED_DISCLAIMER };
}

export async function checkReviewerDeceased(
  input: DeceasedCheckInput,
  options: { allowClaude?: boolean | (() => boolean) } = {}
): Promise<DeceasedCheck> {
  const key = input.name.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const webQuery = buildDeceasedQuery(input.name);
  const pubmedQuery = buildPubMedQuery(input.name);
  let result: DeceasedCheck | null = null;

  try {
    const evidence = await checkPubMed(input);
    if (evidence.length > 0) {
      result = finish({ possiblyDeceased: true, provider: "pubmed", query: pubmedQuery, searchUrl: pubMedSearchUrl(pubmedQuery), searchLabel: "See the PubMed search behind this flag", evidence });
    }
  } catch (err) {
    console.error(`[Deceased] PubMed check failed for ${input.name}:`, err);
  }

  if (!result) {
    try {
      const evidence = await checkWikidata(input);
      if (evidence.length > 0) {
        result = finish({ possiblyDeceased: true, provider: "wikidata", query: input.name, searchUrl: evidence[0].url, searchLabel: "See the Wikidata entry behind this flag", evidence });
      }
    } catch (err) {
      console.error(`[Deceased] Wikidata check failed for ${input.name}:`, err);
    }
  }

  if (!result) {
    const { provider, hits } = await webSearch(webQuery, 8);
    if (provider !== null) {
      const verdict = evaluateDeceasedEvidence(hits, input);
      if (verdict.possiblyDeceased) {
        result = finish({ ...verdict, provider, query: webQuery, searchUrl: googleSearchUrl(webQuery), searchLabel: "See the Google search behind this flag" });
      }
    }
  }

  const claudeAllowed = typeof options.allowClaude === "function" ? options.allowClaude : () => options.allowClaude === true;
  if (!result && isClaudeSearchEnabled() && claudeAllowed()) {
    const verdict = await checkWithClaude(input);
    if (verdict) {
      result = finish({ ...verdict, provider: "claude", query: webQuery, searchUrl: googleSearchUrl(webQuery), searchLabel: "See the Google search behind this flag" });
    }
  }

  if (!result) {
    result = finish({ possiblyDeceased: false, provider: null, query: webQuery, searchUrl: googleSearchUrl(webQuery), searchLabel: "Search the web for this name", evidence: [] });
  }
  cache.set(key, { at: Date.now(), result });
  return result;
}

interface WithReputation {
  reputationSummary?: {
    hasConcerns: boolean;
    entries: unknown[];
    checkedAt: string;
    disclaimer: string;
    deceased?: DeceasedCheck;
  };
}

/**
 * Runs the check for each reviewer and stores it on reputationSummary.deceased.
 * Claude's web search (6–8 s and about 1.5 cents per reviewer) is used only for the first
 * DECEASED_CLAUDE_MAX_PER_SEARCH reviewers the free layers don't settle (default 15), to bound
 * the cost and duration of one search.
 */
export async function enrichReviewerDeceasedBatch<T extends DeceasedCheckInput & WithReputation>(
  reviewers: T[]
): Promise<number> {
  let flagged = 0;
  let claudeBudget = isClaudeSearchEnabled() ? claudeSearchBudget() : 0;
  // Charged only when the free layers leave a name unsettled and Claude actually runs
  const claimClaude = () => (claudeBudget > 0 ? (claudeBudget--, true) : false);
  const queue = [...reviewers];
  async function worker() {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        const check = await checkReviewerDeceased(r, { allowClaude: claimClaude });
        r.reputationSummary = {
          hasConcerns: false,
          entries: [],
          checkedAt: check.checkedAt,
          disclaimer: "",
          ...r.reputationSummary,
          deceased: check,
        };
        if (check.possiblyDeceased) flagged++;
      } catch (err) {
        console.error(`[Deceased] Check failed for ${r.name}:`, err);
      }
    }
  }
  await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, worker));
  return flagged;
}

export function isPossiblyDeceased(r: WithReputation): boolean {
  return r.reputationSummary?.deceased?.possiblyDeceased === true;
}
