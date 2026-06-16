/**
 * Screen suggested reviewers against PubPeer and For Better Science.
 * PubPeer: DOI match on the reviewer's own papers only (high confidence).
 * FBS: full-name match required — surname alone never flags a reviewer.
 */

const FETCH_TIMEOUT_MS = 8000;
const PUBPEER_API = "https://pubpeer.com/v3/publications?devkey=Zotero";
const FBS_RSS_BASE = "https://forbetterscience.com/search";
const REPUTATION_DISCLAIMER =
  "Automated screening only. Mentions on these sites are not proof of misconduct; verify before editorial decisions.";

export interface ReputationEntry {
  source: "pubpeer" | "forbetterscience";
  label: string;
  url: string;
  detail?: string;
}

export interface ReputationSummary {
  hasConcerns: boolean;
  entries: ReputationEntry[];
  checkedAt: string;
  disclaimer: string;
}

export interface ReputationCheckInput {
  name: string;
  firstName?: string;
  lastName?: string;
  recentArticles?: Array<{ pmid?: string; doi?: string; title?: string }>;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractLastName(name: string, lastName?: string): string {
  if (lastName?.trim()) return lastName.trim();
  const parts = name.trim().split(/\s+/);
  return parts.length > 0 ? parts[parts.length - 1] : name;
}

export function extractFirstName(name: string, firstName?: string): string {
  if (firstName?.trim()) return firstName.trim();
  const parts = name.trim().split(/\s+/);
  return parts.length > 0 ? parts[0] : "";
}

/**
 * Conservative person match: requires first name (full or unambiguous initial)
 * AND surname together. Surname-only never matches.
 */
export function isHighConfidencePersonMatch(
  text: string,
  options: { name: string; firstName?: string; lastName?: string }
): boolean {
  const lastName = extractLastName(options.name, options.lastName);
  const firstName = extractFirstName(options.name, options.firstName);

  if (!lastName || lastName.length < 2) return false;
  if (!firstName || firstName.length < 2) return false;

  const ln = escapeRegex(lastName);
  const fn = escapeRegex(firstName);
  const initial = escapeRegex(firstName[0]);

  const patterns = [
    // "Paolo Macchiarini", "paolo macchiarini"
    new RegExp(`\\b${fn}\\s+${ln}\\b`, "i"),
    // "Macchiarini, Paolo" / "Macchiarini Paolo"
    new RegExp(`\\b${ln}\\s*,\\s*${fn}\\b`, "i"),
    new RegExp(`\\b${ln}\\s+${fn}\\b`, "i"),
    // "P. Macchiarini" / "P Macchiarini"
    new RegExp(`\\b${initial}\\.\\s*${ln}\\b`, "i"),
    new RegExp(`\\b${initial}\\s+${ln}\\b`, "i"),
    // "Macchiarini P." (rare citation form)
    new RegExp(`\\b${ln}\\s+${initial}\\.\\b`, "i"),
    // Hyphenated / compound surnames with first name
    new RegExp(`\\b${fn}[\\s-]+[\\w-]*${ln}\\b`, "i"),
  ];

  return patterns.some((p) => p.test(text));
}

/** @deprecated Use isHighConfidencePersonMatch */
export function nameAppearsInText(
  text: string,
  lastName: string,
  firstName?: string
): boolean {
  return isHighConfidencePersonMatch(text, {
    name: `${firstName || ""} ${lastName}`.trim(),
    firstName,
    lastName,
  });
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "PubliMentor/1.0 (academic integrity screening)",
        Accept: "application/rss+xml, application/xml, text/xml, text/html, */*",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Resolve PMIDs to DOIs via PubMed esummary */
export async function resolvePmidsToDois(pmids: string[]): Promise<string[]> {
  const ids = [...new Set(pmids.filter(Boolean))].slice(0, 15);
  if (ids.length === 0) return [];

  try {
    const params = new URLSearchParams({
      db: "pubmed",
      id: ids.join(","),
      retmode: "json",
    });
    const res = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const dois: string[] = [];
    for (const pmid of ids) {
      const article = data.result?.[pmid];
      const idsList = article?.articleids as Array<{ idtype?: string; value?: string }> | undefined;
      const doiEntry = idsList?.find((a) => a.idtype === "doi");
      if (doiEntry?.value) dois.push(doiEntry.value);
    }
    return [...new Set(dois)];
  } catch {
    return [];
  }
}

interface PubPeerFeedback {
  id: string;
  title?: string;
  total_comments?: number;
  url?: string;
}

/**
 * PubPeer flags only when a known DOI from this reviewer's articles has comments.
 * DOI linkage is treated as ~99% confidence it is their paper.
 */
async function checkPubPeerByDois(dois: string[]): Promise<ReputationEntry[]> {
  if (dois.length === 0) return [];

  try {
    const res = await fetch(PUBPEER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ dois: dois.slice(0, 20) }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      feedbacks?: PubPeerFeedback[];
    };
    const entries: ReputationEntry[] = [];
    for (const fb of data.feedbacks || []) {
      if ((fb.total_comments || 0) > 0 && fb.url) {
        entries.push({
          source: "pubpeer",
          label: `PubPeer: ${fb.total_comments} comment(s) on their paper`,
          url: fb.url,
          detail: fb.title?.slice(0, 120),
        });
      }
    }
    return entries.slice(0, 5);
  } catch {
    return [];
  }
}

interface FbsRssItem {
  title: string;
  link: string;
  categories: string[];
}

export function parseFbsRssItems(xml: string): FbsRssItem[] {
  const items: FbsRssItem[] = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];

  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = block.match(/<link>([^<]+)<\/link>/i);
    const categories: string[] = [];
    const catRe = /<category>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/category>/gi;
    let cat: RegExpExecArray | null;
    while ((cat = catRe.exec(block)) !== null) {
      categories.push(cat[1].trim());
    }
    if (titleMatch && linkMatch) {
      items.push({
        title: titleMatch[1].replace(/<[^>]+>/g, "").trim(),
        link: linkMatch[1].trim(),
        categories,
      });
    }
  }
  return items;
}

function fbsItemMatchesReviewer(
  item: FbsRssItem,
  name: string,
  firstName: string,
  lastName: string
): boolean {
  const personOpts = { name, firstName, lastName };

  if (isHighConfidencePersonMatch(item.title, personOpts)) return true;

  for (const cat of item.categories) {
    if (isHighConfidencePersonMatch(cat, personOpts)) return true;
  }

  return false;
}

async function fetchFbsSearchResults(
  searchTerm: string
): Promise<FbsRssItem[]> {
  const rssUrl = `${FBS_RSS_BASE}/${encodeURIComponent(searchTerm)}/feed/rss2/`;
  const xml = await fetchText(rssUrl);
  if (!xml) return [];
  return parseFbsRssItems(xml);
}

/**
 * FBS: search by full name only; flag only with high-confidence name match.
 * No surname-only search or matching.
 */
async function checkForBetterScience(
  name: string,
  lastName: string,
  firstName: string
): Promise<ReputationEntry[]> {
  if (!firstName || firstName.length < 2) {
    return [];
  }

  const searchTerms = [
    `${firstName} ${lastName}`,
    `${lastName}, ${firstName}`,
  ];

  const allItems: FbsRssItem[] = [];
  const seenLinks = new Set<string>();

  for (const term of searchTerms) {
    const items = await fetchFbsSearchResults(term);
    for (const item of items) {
      if (!seenLinks.has(item.link)) {
        seenLinks.add(item.link);
        allItems.push(item);
      }
    }
    await delay(150);
  }

  const entries: ReputationEntry[] = [];
  const seen = new Set<string>();

  for (const item of allItems) {
    if (!fbsItemMatchesReviewer(item, name, firstName, lastName)) continue;
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    entries.push({
      source: "forbetterscience",
      label: "For Better Science",
      url: item.link,
      detail: item.title.slice(0, 140),
    });
    if (entries.length >= 5) break;
  }

  return entries;
}

export async function checkReviewerReputation(
  input: ReputationCheckInput
): Promise<ReputationSummary> {
  const lastName = extractLastName(input.name, input.lastName);
  const firstName = extractFirstName(input.name, input.firstName);
  const entries: ReputationEntry[] = [];

  const doisFromArticles = (input.recentArticles || [])
    .map((a) => a.doi)
    .filter((d): d is string => !!d?.trim());
  const pmids = (input.recentArticles || [])
    .map((a) => a.pmid)
    .filter((p): p is string => !!p?.trim());

  const resolvedDois = await resolvePmidsToDois(pmids);
  const allDois = [...new Set([...doisFromArticles, ...resolvedDois])];

  const [pubpeerEntries, fbsEntries] = await Promise.all([
    checkPubPeerByDois(allDois),
    checkForBetterScience(input.name, lastName, firstName),
  ]);

  entries.push(...pubpeerEntries, ...fbsEntries);

  const hasConcerns = pubpeerEntries.length > 0 || fbsEntries.length > 0;

  return {
    hasConcerns,
    entries,
    checkedAt: new Date().toISOString(),
    disclaimer: REPUTATION_DISCLAIMER,
  };
}

/**
 * Batch reputation screening (sequential to respect rate limits).
 */
export async function enrichReviewerReputationBatch<
  T extends ReputationCheckInput & { reputationSummary?: ReputationSummary },
>(reviewers: T[]): Promise<void> {
  for (const reviewer of reviewers) {
    try {
      reviewer.reputationSummary = await checkReviewerReputation(reviewer);
      if (reviewer.reputationSummary.hasConcerns) {
        console.log(
          `[Reputation] High-confidence concerns for ${reviewer.name}: ${reviewer.reputationSummary.entries
            .map((e) => e.source)
            .join(", ")}`
        );
      }
    } catch (err) {
      console.error(`[Reputation] Check failed for ${reviewer.name}:`, err);
      reviewer.reputationSummary = {
        hasConcerns: false,
        entries: [],
        checkedAt: new Date().toISOString(),
        disclaimer: REPUTATION_DISCLAIMER,
      };
    }
    await delay(300);
  }
}
