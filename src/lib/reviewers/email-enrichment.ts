/**
 * Resolve reviewer contact emails from public sources (tiered waterfall):
 * affiliation → ORCID (person + expanded-search) → PubMed → Europe PMC →
 * profile pages (institution, DBLP, Semantic Scholar) → web search (Serper/Brave/DDG).
 */

import { fetchPubMedArticles, searchPubMed } from "@/lib/pubmed";
import {
  emailCacheKey,
  getCachedEmail,
  setCachedEmail,
} from "./email-enrichment-cache";

const FETCH_TIMEOUT_MS = 9000;
const MAX_PAGE_BYTES = 600_000;
const MAX_WEB_SEARCH_QUERIES = 2;
const MAX_PAGES_TO_SCRAPE = 12;

const GENERIC_LOCAL_PARTS = new Set([
  "info",
  "contact",
  "admin",
  "office",
  "secretary",
  "reception",
  "enquiries",
  "inquiries",
  "webmaster",
  "support",
  "help",
  "media",
  "press",
  "hr",
  "jobs",
  "careers",
  "admissions",
]);

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
]);

export type EmailSource =
  | "orcid"
  | "pubmed"
  | "affiliation"
  | "europe_pmc"
  | "institution_profile"
  | "semantic_scholar"
  | "dblp"
  | "web_search";

export type EmailConfidence = "high" | "medium" | "low";

/** Known university profile URL patterns (domain suffix → builder) */
const INSTITUTION_PROFILE_BUILDERS: Array<{
  domainSuffix: string;
  buildUrl: (slug: string) => string;
}> = [
  {
    domainSuffix: "stanford.edu",
    buildUrl: (slug) => `https://profiles.stanford.edu/${slug}`,
  },
  {
    domainSuffix: "harvard.edu",
    buildUrl: (slug) => `https://scholar.harvard.edu/${slug}`,
  },
  {
    domainSuffix: "mit.edu",
    buildUrl: (slug) => `https://www.mit.edu/~${slug.replace(/-/g, "")}`,
  },
  {
    domainSuffix: "ox.ac.uk",
    buildUrl: (slug) => `https://www.ox.ac.uk/research/${slug}`,
  },
  {
    domainSuffix: "yale.edu",
    buildUrl: (slug) => `https://medicine.yale.edu/profile/${slug}/`,
  },
  {
    domainSuffix: "columbia.edu",
    buildUrl: (slug) => `https://www.columbia.edu/~${slug.replace(/-/g, "")}`,
  },
  {
    domainSuffix: "ucl.ac.uk",
    buildUrl: (slug) => `https://profiles.ucl.ac.uk/${slug}`,
  },
  {
    domainSuffix: "cam.ac.uk",
    buildUrl: (slug) => `https://www.cam.ac.uk/research/people/${slug}`,
  },
  {
    domainSuffix: "ucsf.edu",
    buildUrl: (slug) => `https://profiles.ucsf.edu/${slug}`,
  },
  {
    domainSuffix: "washington.edu",
    buildUrl: (slug) =>
      `https://www.washington.edu/research/research-centers/?s=${slug}`,
  },
];

export interface EmailEnrichmentInput {
  name: string;
  lastName?: string;
  firstName?: string;
  affiliation?: string;
  orcid?: string | null;
  institutionDomain?: string | null;
  institutionProfileUrl?: string | null;
  profileUrls?: string[];
  semanticScholarHomepage?: string | null;
  openAlexAuthorUrl?: string | null;
  existingEmail?: string | null;
  recentArticles?: Array<{ pmid?: string; doi?: string }>;
  skipCache?: boolean;
}

export interface EmailEnrichmentResult {
  email: string | null;
  source?: EmailSource;
  confidence?: EmailConfidence;
}

export interface EmailBatchMetrics {
  emailsFound: number;
  emailsMissing: number;
  bySource: Partial<Record<EmailSource, number>>;
}

function confidenceForSource(source: EmailSource): EmailConfidence {
  switch (source) {
    case "orcid":
    case "pubmed":
    case "affiliation":
    case "europe_pmc":
      return "high";
    case "institution_profile":
    case "semantic_scholar":
    case "dblp":
      return "medium";
    case "web_search":
      return "low";
    default:
      return "medium";
  }
}

function makeResult(
  email: string,
  source: EmailSource
): EmailEnrichmentResult {
  return { email, source, confidence: confidenceForSource(source) };
}

export function extractDomainFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export function parseInstitutionDomainFromSearchUrl(
  institutionSearchUrl?: string
): string | null {
  if (!institutionSearchUrl) return null;
  const match = institutionSearchUrl.match(/site:([^+"&\s]+)/i);
  return match ? match[1].toLowerCase() : null;
}

export function nameToProfileSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeOrcid(orcid: string): string {
  return orcid.replace(/^https?:\/\/orcid\.org\//i, "").trim();
}

export async function fetchOrcidEmail(orcid: string): Promise<string | null> {
  const id = normalizeOrcid(orcid);
  if (!id) return null;
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${id}/person`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const emails = data?.emails?.email || [];
    const primary =
      emails.find((e: { primary?: boolean; email?: string }) => e.primary)
        ?.email || emails[0]?.email;
    return typeof primary === "string" && primary.includes("@")
      ? primary.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

export interface OrcidExpandedHit {
  orcid: string;
  email: string | null;
  givenNames?: string;
  familyNames?: string;
}

/** ORCID expanded-search: returns public email + ORCID when id unknown */
export async function fetchOrcidExpandedSearch(
  name: string,
  affiliation?: string
): Promise<OrcidExpandedHit | null> {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;

  const queries: string[] = [];
  const escapedName = name.replace(/"/g, '\\"');
  queries.push(`given-and-family-names:"${escapedName}"`);
  if (affiliation && affiliation.length > 3) {
    const org = affiliation.split(",")[0].trim().slice(0, 80);
    if (org.length > 2) {
      queries.push(
        `given-and-family-names:"${escapedName}" AND affiliation-org-name:"${org.replace(/"/g, '\\"')}"`
      );
    }
  }

  for (const q of queries) {
    try {
      const res = await fetch(
        `https://pub.orcid.org/v3.0/expanded-search?q=${encodeURIComponent(q)}&rows=5`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const results = data?.["expanded-result"] || [];
      const lastName = parts[parts.length - 1].toLowerCase();

      for (const row of results) {
        const family = (row["family-names"] || "").toLowerCase();
        if (family && family !== lastName) continue;
        const orcidId = row["orcid-id"];
        if (!orcidId) continue;
        const email =
          typeof row.email === "string" && row.email.includes("@")
            ? row.email.toLowerCase()
            : null;
        return {
          orcid: orcidId.replace(/^https?:\/\/orcid\.org\//i, ""),
          email,
          givenNames: row["given-names"],
          familyNames: row["family-names"],
        };
      }
    } catch {
      /* try next query */
    }
  }
  return null;
}

export async function fetchOrcidFromOpenAlexAuthor(
  openAlexAuthorUrl?: string | null
): Promise<string | null> {
  if (!openAlexAuthorUrl) return null;
  try {
    const apiUrl = openAlexAuthorUrl.startsWith("http")
      ? openAlexAuthorUrl
      : `https://api.openalex.org/authors/${openAlexAuthorUrl}`;
    const res = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const orcid = data?.orcid as string | undefined;
    if (!orcid) return null;
    return orcid.replace(/^https?:\/\/orcid\.org\//i, "");
  } catch {
    return null;
  }
}

export async function fetchOrcidProfileUrls(orcid: string): Promise<string[]> {
  const id = normalizeOrcid(orcid);
  if (!id) return [];
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${id}/person`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const urls: string[] = [];
    const researcherUrls = data?.["researcher-urls"]?.["researcher-url"] || [];
    for (const entry of researcherUrls) {
      const url = entry?.url?.value;
      if (url && typeof url === "string") urls.push(url);
    }
    return urls;
  } catch {
    return [];
  }
}

/** DBLP author search → personal homepage URL (CS researchers) */
export async function fetchDblpHomepage(name: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://dblp.org/search/author/api?q=${encodeURIComponent(name)}&format=json&h=5`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const hits = data?.result?.hits?.hit;
    if (!hits) return null;
    const hitList = Array.isArray(hits) ? hits : [hits];
    const nameLower = name.toLowerCase();
    const lastName = nameLower.split(/\s+/).pop() || "";

    for (const hit of hitList) {
      const authorName = (hit?.info?.author || "").toLowerCase();
      if (!authorName.includes(lastName)) continue;
      const pidUrl = hit?.["@id"] as string | undefined;
      if (!pidUrl?.includes("/pid/")) continue;

      const xmlRes = await fetch(`${pidUrl}.xml`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!xmlRes.ok) continue;
      const xml = await xmlRes.text();
      const homeUrlMatch = xml.match(
        /<www[^>]*>[\s\S]*?<title>Home Page<\/title>[\s\S]*?<url>([^<]+)<\/url>/i
      );
      if (homeUrlMatch?.[1]?.startsWith("http")) {
        return homeUrlMatch[1];
      }
      const anyUrl = xml.match(/<url>(https?:\/\/[^<]+)<\/url>/i);
      if (anyUrl?.[1] && !anyUrl[1].includes("dblp.org")) {
        return anyUrl[1];
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Europe PMC JATS email tags (supplement to PubMed MedlineCitation) */
export async function fetchEmailFromEuropePmc(
  pmids: string[],
  lastName: string
): Promise<string | null> {
  const ln = lastName.toLowerCase();
  for (const pmid of [...new Set(pmids)].slice(0, 4)) {
    try {
      const res = await fetch(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/MED/${pmid}/xml`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
      );
      if (!res.ok) continue;
      const xml = await res.text();
      const contribBlocks =
        xml.match(/<contrib[^>]*>[\s\S]*?<\/contrib>/gi) || [];
      for (const block of contribBlocks) {
        const surname = block.match(/<surname>([^<]+)<\/surname>/i)?.[1];
        if (surname?.toLowerCase() !== ln) continue;
        const emailTag = block.match(/<email[^>]*>([^<]+)<\/email>/i)?.[1];
        if (emailTag?.includes("@")) {
          return emailTag.toLowerCase().replace(/^mailto:/i, "");
        }
      }
      const anyEmail = xml.match(/<email[^>]*>([^<@]+@[^<]+)<\/email>/i)?.[1];
      if (anyEmail) return anyEmail.toLowerCase().replace(/^mailto:/i, "");
    } catch {
      /* next pmid */
    }
  }
  return null;
}

export function extractEmailFromAffiliation(affiliation: string): string | null {
  const emails = extractEmailsFromHtml(affiliation);
  return emails[0] || null;
}

export function extractEmailFromPubMedAuthorBlocks(
  articles: Array<{
    authors: Array<{
      lastName: string;
      foreName?: string;
      affiliation?: string;
    }>;
  }>,
  lastName: string,
  firstName?: string
): string | null {
  const ln = lastName.toLowerCase();
  const fn = firstName?.toLowerCase();

  for (const article of articles) {
    for (const author of article.authors) {
      if (author.lastName.toLowerCase() !== ln) continue;
      if (fn && fn.length > 1) {
        const fore = (author.foreName || "").toLowerCase();
        if (fore && !fore.startsWith(fn[0]) && !fore.includes(fn)) continue;
      }
      if (!author.affiliation) continue;
      const email = extractEmailFromAffiliation(author.affiliation);
      if (email) return email;
    }
  }
  return null;
}

export async function fetchEmailFromPubMedPmids(
  pmids: string[],
  lastName: string,
  firstName?: string
): Promise<string | null> {
  const ids = [...new Set(pmids.filter(Boolean))].slice(0, 12);
  if (ids.length === 0 || !lastName) return null;
  try {
    const articles = await fetchPubMedArticles(ids);
    return extractEmailFromPubMedAuthorBlocks(articles, lastName, firstName);
  } catch {
    return null;
  }
}

export async function fetchEmailFromPubMedAuthorSearch(
  authorName: string,
  lastName: string,
  firstName?: string
): Promise<string | null> {
  if (!authorName || !lastName) return null;
  try {
    const pmids = await searchPubMed(`${authorName}[Author]`, 25);
    return fetchEmailFromPubMedPmids(pmids, lastName, firstName);
  } catch {
    return null;
  }
}

export function resolveEmailFromPubMedArticles(
  articles: Array<{
    authors: Array<{
      lastName: string;
      foreName?: string;
      affiliation?: string;
    }>;
  }>,
  lastName: string,
  firstName?: string
): string | null {
  return extractEmailFromPubMedAuthorBlocks(articles, lastName, firstName);
}

/** Generic + curated institution profile URL candidates */
export function buildInstitutionProfileCandidates(
  name: string,
  institutionDomain: string | null
): string[] {
  if (!institutionDomain) return [];
  const slug = nameToProfileSlug(name);
  if (!slug) return [];

  const urls: string[] = [
    `https://profiles.${institutionDomain}/${slug}`,
    `https://people.${institutionDomain}/${slug}`,
    `https://www.${institutionDomain}/faculty/${slug}`,
    `https://www.${institutionDomain}/people/${slug}`,
    `https://${institutionDomain}/faculty/${slug}`,
  ];

  for (const { domainSuffix, buildUrl } of INSTITUTION_PROFILE_BUILDERS) {
    if (
      institutionDomain === domainSuffix ||
      institutionDomain.endsWith(`.${domainSuffix}`)
    ) {
      urls.push(buildUrl(slug));
    }
  }
  return [...new Set(urls)];
}

export function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();

  const mailtoRe = /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = mailtoRe.exec(html)) !== null) {
    found.add(m[1].toLowerCase());
  }

  const emailRe = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
  while ((m = emailRe.exec(html)) !== null) {
    found.add(m[1].toLowerCase());
  }

  return [...found];
}

function scoreEmail(
  email: string,
  name: string,
  lastName: string | undefined,
  institutionDomain: string | null
): number {
  const lower = email.toLowerCase();
  const [local, domain] = lower.split("@");
  if (!local || !domain) return -1000;

  if (GENERIC_LOCAL_PARTS.has(local)) return -50;

  let score = 10;

  if (institutionDomain && domain.endsWith(institutionDomain)) score += 80;
  else if (
    institutionDomain &&
    (domain.includes(institutionDomain.split(".")[0]) ||
      institutionDomain.includes(domain.split(".")[0]))
  ) {
    score += 40;
  } else if (domain.endsWith(".edu") || domain.includes(".ac.")) {
    score += 30;
  }

  if (PERSONAL_DOMAINS.has(domain)) score += 5;

  const nameParts = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const ln = (lastName || nameParts[nameParts.length - 1] || "").toLowerCase();
  if (ln.length > 2) {
    if (local.includes(ln)) score += 35;
    if (local.includes(ln.slice(0, 6))) score += 15;
  }
  for (const part of nameParts) {
    if (part.length > 2 && local.includes(part)) score += 10;
  }

  if (local.includes("noreply") || local.includes("no-reply")) score -= 100;

  return score;
}

export function pickBestEmail(
  emails: string[],
  name: string,
  lastName?: string,
  institutionDomain?: string | null
): string | null {
  if (emails.length === 0) return null;
  const ranked = emails
    .map((e) => ({
      email: e,
      score: scoreEmail(e, name, lastName, institutionDomain || null),
    }))
    .filter((x) => x.score >= 20)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.email ?? null;
}

async function fetchPageHtml(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;

    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;

    const reader = res.body?.getReader();
    if (!reader) return (await res.text()).slice(0, MAX_PAGE_BYTES);

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    const decoder = new TextDecoder("utf-8", { fatal: false });
    return chunks.map((c) => decoder.decode(c, { stream: true })).join("");
  } catch {
    return null;
  }
}

async function extractEmailFromPage(
  url: string,
  name: string,
  lastName: string | undefined,
  institutionDomain: string | null
): Promise<string | null> {
  const html = await fetchPageHtml(url);
  if (!html) return null;
  const emails = extractEmailsFromHtml(html);
  return pickBestEmail(emails, name, lastName, institutionDomain);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function searchDuckDuckGoWeb(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const urls: string[] = [];
    const linkRe = /uddg=([^&"']+)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
      try {
        const decoded = decodeHtmlEntities(decodeURIComponent(m[1]));
        if (decoded.startsWith("http")) urls.push(decoded);
      } catch {
        /* skip */
      }
    }
    return [...new Set(urls)].slice(0, 8);
  } catch {
    return [];
  }
}

async function searchSerperWeb(query: string): Promise<string[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({ q: query, num: 8 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.organic || [])
      .map((r: { link?: string }) => r.link)
      .filter((u: string | undefined): u is string => !!u?.startsWith("http"))
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function searchBraveWeb(query: string): Promise<string[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || [])
      .map((r: { url?: string }) => r.url)
      .filter((u: string | undefined): u is string => !!u?.startsWith("http"))
      .slice(0, 5);
  } catch {
    return [];
  }
}

async function searchWebOnce(query: string): Promise<string[]> {
  const serper = await searchSerperWeb(query);
  if (serper.length > 0) return serper;
  const brave = await searchBraveWeb(query);
  if (brave.length > 0) return brave;
  return searchDuckDuckGoWeb(query);
}

/** Credit-aware web search: max N queries per reviewer */
async function searchWebBudgeted(
  queries: string[],
  maxQueries: number = MAX_WEB_SEARCH_QUERIES
): Promise<string[]> {
  const urls: string[] = [];
  for (const q of queries.slice(0, maxQueries)) {
    const found = await searchWebOnce(q);
    for (const u of found) {
      if (!urls.includes(u)) urls.push(u);
    }
  }
  return urls;
}

function findInstitutionProfileUrl(
  profileUrls: string[],
  institutionDomain: string | null
): string | null {
  if (!institutionDomain) return null;
  const domainLower = institutionDomain.toLowerCase();
  for (const url of profileUrls) {
    const host = extractDomainFromUrl(url);
    if (host && (host === domainLower || host.endsWith(`.${domainLower}`))) {
      return url;
    }
  }
  return null;
}

function classifyPageSource(
  url: string,
  input: EmailEnrichmentInput,
  institutionDomain: string | null,
  dblpHomepage: string | null
): EmailSource {
  if (url === input.semanticScholarHomepage) return "semantic_scholar";
  if (dblpHomepage && url === dblpHomepage) return "dblp";
  const host = extractDomainFromUrl(url);
  if (
    institutionDomain &&
    host &&
    (host === institutionDomain || host.endsWith(`.${institutionDomain}`))
  ) {
    return "institution_profile";
  }
  return "web_search";
}

/**
 * Resolve a reviewer email using the tiered public-source waterfall.
 */
export async function enrichReviewerEmail(
  input: EmailEnrichmentInput
): Promise<EmailEnrichmentResult> {
  const cacheKey = emailCacheKey({
    orcid: input.orcid,
    name: input.name,
    institutionDomain: input.institutionDomain,
  });
  if (!input.skipCache) {
    const cached = getCachedEmail(cacheKey);
    if (cached?.email) return cached;
  }

  if (input.existingEmail?.includes("@")) {
    return makeResult(input.existingEmail.toLowerCase(), "orcid");
  }

  if (input.affiliation) {
    const affEmail = extractEmailFromAffiliation(input.affiliation);
    if (affEmail) return makeResult(affEmail, "affiliation");
  }

  const lastName =
    input.lastName || input.name.split(/\s+/).filter(Boolean).pop() || "";
  const firstName = input.firstName || input.name.split(/\s+/)[0] || "";
  const institutionDomain = input.institutionDomain || null;

  let orcid = input.orcid ? normalizeOrcid(input.orcid) : null;
  if (!orcid && input.openAlexAuthorUrl) {
    orcid = await fetchOrcidFromOpenAlexAuthor(input.openAlexAuthorUrl);
  }

  if (!orcid) {
    const expanded = await fetchOrcidExpandedSearch(
      input.name,
      input.affiliation
    );
    if (expanded) {
      orcid = expanded.orcid;
      if (expanded.email) {
        const result = makeResult(expanded.email, "orcid");
        setCachedEmail(cacheKey, result);
        return result;
      }
    }
  }

  if (orcid) {
    const orcidEmail = await fetchOrcidEmail(orcid);
    if (orcidEmail) {
      const result = makeResult(orcidEmail, "orcid");
      setCachedEmail(cacheKey, result);
      return result;
    }
  }

  const pmids = (input.recentArticles || [])
    .map((a) => a.pmid)
    .filter((p): p is string => !!p?.trim());

  if (pmids.length > 0 && lastName) {
    const pubmedEmail = await fetchEmailFromPubMedPmids(
      pmids,
      lastName,
      firstName
    );
    if (pubmedEmail) {
      const result = makeResult(pubmedEmail, "pubmed");
      setCachedEmail(cacheKey, result);
      return result;
    }

    const epmcEmail = await fetchEmailFromEuropePmc(pmids, lastName);
    if (epmcEmail) {
      const result = makeResult(epmcEmail, "europe_pmc");
      setCachedEmail(cacheKey, result);
      return result;
    }
  }

  if (lastName) {
    const pubmedSearchEmail = await fetchEmailFromPubMedAuthorSearch(
      input.name,
      lastName,
      firstName
    );
    if (pubmedSearchEmail) {
      const result = makeResult(pubmedSearchEmail, "pubmed");
      setCachedEmail(cacheKey, result);
      return result;
    }
  }

  const profileUrls = [
    ...(input.profileUrls || []),
    ...(orcid ? await fetchOrcidProfileUrls(orcid) : []),
  ];

  const dblpHomepage = await fetchDblpHomepage(input.name);

  const urlsToTry: string[] = [];

  if (input.institutionProfileUrl) urlsToTry.push(input.institutionProfileUrl);

  const instProfile = findInstitutionProfileUrl(profileUrls, institutionDomain);
  if (instProfile && !urlsToTry.includes(instProfile)) urlsToTry.push(instProfile);

  for (const u of buildInstitutionProfileCandidates(
    input.name,
    institutionDomain
  )) {
    if (!urlsToTry.includes(u)) urlsToTry.push(u);
  }

  if (input.semanticScholarHomepage) urlsToTry.push(input.semanticScholarHomepage);
  if (dblpHomepage && !urlsToTry.includes(dblpHomepage)) urlsToTry.push(dblpHomepage);

  for (const u of profileUrls) {
    if (!urlsToTry.includes(u)) urlsToTry.push(u);
  }

  const webQueries: string[] = [];
  if (institutionDomain) {
    webQueries.push(`site:${institutionDomain} ${input.name} email`);
    webQueries.push(`${input.name} ${institutionDomain} email contact`);
  } else if (input.affiliation && input.affiliation.length > 5) {
    webQueries.push(
      `${input.name} ${input.affiliation.slice(0, 80)} email contact`
    );
  } else {
    webQueries.push(`${input.name} university email contact`);
  }

  const searchUrls = await searchWebBudgeted(webQueries);
  for (const u of searchUrls) {
    if (!urlsToTry.includes(u)) urlsToTry.push(u);
  }

  for (const url of urlsToTry.slice(0, MAX_PAGES_TO_SCRAPE)) {
    const email = await extractEmailFromPage(
      url,
      input.name,
      lastName,
      institutionDomain
    );
    if (email) {
      const source = classifyPageSource(
        url,
        input,
        institutionDomain,
        dblpHomepage
      );
      const result = makeResult(email, source);
      setCachedEmail(cacheKey, result);
      return result;
    }
  }

  return { email: null };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function computeEmailBatchMetrics<
  T extends { email?: string | null; emailSource?: EmailSource },
>(reviewers: T[]): EmailBatchMetrics {
  const bySource: Partial<Record<EmailSource, number>> = {};
  let emailsFound = 0;
  for (const r of reviewers) {
    if (r.email?.includes("@")) {
      emailsFound++;
      if (r.emailSource) {
        bySource[r.emailSource] = (bySource[r.emailSource] || 0) + 1;
      }
    }
  }
  return {
    emailsFound,
    emailsMissing: reviewers.length - emailsFound,
    bySource,
  };
}

/**
 * Enrich emails for a batch of reviewers; sets email, emailSource, emailConfidence.
 */
export async function enrichReviewerEmailsBatch<
  T extends {
    name: string;
    lastName?: string;
    firstName?: string;
    email?: string | null;
    affiliation?: string;
    emailSource?: EmailSource;
    emailConfidence?: EmailConfidence;
    recentArticles?: Array<{ pmid?: string; doi?: string }>;
    verificationUrls?: {
      institutionProfileUrl?: string;
      institutionSearchUrl?: string;
      institutionDomain?: string;
      semanticScholarUrl?: string;
      semanticScholarHomepage?: string;
      openAlexUrl?: string;
      orcidProfileUrls?: string[];
      emailSource?: EmailSource;
      emailConfidence?: EmailConfidence;
    };
  },
>(
  reviewers: T[],
  options?: { orcidByName?: Record<string, string> }
): Promise<EmailBatchMetrics> {
  for (const reviewer of reviewers) {
    const key = reviewer.name.trim().toLowerCase();
    const orcid =
      options?.orcidByName?.[key] ||
      extractOrcidFromOpenAlexUrl(reviewer.verificationUrls?.openAlexUrl);

    const institutionDomain =
      reviewer.verificationUrls?.institutionDomain ||
      parseInstitutionDomainFromSearchUrl(
        reviewer.verificationUrls?.institutionSearchUrl
      );

    const lastName =
      reviewer.lastName ||
      reviewer.name.split(/\s+/).filter(Boolean).pop() ||
      "";

    if (reviewer.email?.includes("@") && !reviewer.emailSource) {
      reviewer.emailSource = "affiliation";
      reviewer.emailConfidence = "high";
      if (reviewer.verificationUrls) {
        reviewer.verificationUrls.emailSource = "affiliation";
        reviewer.verificationUrls.emailConfidence = "high";
      }
      continue;
    }

    if (reviewer.email?.includes("@")) continue;

    const result = await enrichReviewerEmail({
      name: reviewer.name,
      firstName: reviewer.firstName,
      lastName,
      affiliation: reviewer.affiliation,
      orcid,
      institutionDomain,
      institutionProfileUrl: reviewer.verificationUrls?.institutionProfileUrl,
      profileUrls: reviewer.verificationUrls?.orcidProfileUrls,
      semanticScholarHomepage:
        reviewer.verificationUrls?.semanticScholarHomepage ||
        reviewer.verificationUrls?.semanticScholarUrl,
      openAlexAuthorUrl: reviewer.verificationUrls?.openAlexUrl,
      recentArticles: reviewer.recentArticles,
      existingEmail: reviewer.email,
    });

    if (result.email) {
      reviewer.email = result.email;
      reviewer.emailSource = result.source;
      reviewer.emailConfidence = result.confidence;
      if (reviewer.verificationUrls) {
        reviewer.verificationUrls.emailSource = result.source;
        reviewer.verificationUrls.emailConfidence = result.confidence;
      }
      console.log(
        `[Email] ${reviewer.name}: ${result.email} (${result.source}, ${result.confidence})`
      );
    }

    await delay(200);
  }

  return computeEmailBatchMetrics(reviewers);
}

function extractOrcidFromOpenAlexUrl(openAlexUrl?: string): string | null {
  if (!openAlexUrl) return null;
  if (openAlexUrl.includes("orcid.org")) {
    const m = openAlexUrl.match(/orcid\.org\/([0-9X-]+)/i);
    return m ? m[1] : null;
  }
  return null;
}

/** Human-readable label for email source badges */
export function emailSourceLabel(source?: EmailSource): string {
  switch (source) {
    case "orcid":
      return "ORCID";
    case "pubmed":
      return "PubMed";
    case "affiliation":
      return "Affiliation";
    case "europe_pmc":
      return "Europe PMC";
    case "institution_profile":
      return "Institution page";
    case "semantic_scholar":
      return "Semantic Scholar";
    case "dblp":
      return "DBLP homepage";
    case "web_search":
      return "Web search";
    default:
      return "";
  }
}
