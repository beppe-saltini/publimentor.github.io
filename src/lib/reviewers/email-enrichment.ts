/**
 * Resolve reviewer contact emails from public sources:
 * ORCID, institution profile pages, Semantic Scholar homepage, and site-limited web search.
 */

const FETCH_TIMEOUT_MS = 7000;
const MAX_PAGE_BYTES = 600_000;

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

export interface EmailEnrichmentInput {
  name: string;
  lastName?: string;
  affiliation?: string;
  orcid?: string | null;
  institutionDomain?: string | null;
  institutionProfileUrl?: string | null;
  profileUrls?: string[];
  semanticScholarHomepage?: string | null;
  existingEmail?: string | null;
}

export interface EmailEnrichmentResult {
  email: string | null;
  source?: "orcid" | "institution_profile" | "semantic_scholar" | "web_search";
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
      emails.find((e: { primary?: boolean; email?: string }) => e.primary)?.email ||
      emails[0]?.email;
    return typeof primary === "string" && primary.includes("@") ? primary : null;
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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();

  const mailtoRe = /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = mailtoRe.exec(html)) !== null) {
    found.add(m[1].toLowerCase());
  }

  const emailRe =
    /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
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

  let score = 0;
  const domainType = PERSONAL_DOMAINS.has(domain) ? "personal" : "other";

  if (institutionDomain && domain.endsWith(institutionDomain)) score += 80;
  else if (
    institutionDomain &&
    (domain.includes(institutionDomain.split(".")[0]) ||
      institutionDomain.includes(domain.split(".")[0]))
  ) {
    score += 40;
  } else if (domain.endsWith(".edu") || domain.includes(".ac.")) {
    score += 25;
  }

  if (domainType === "personal") score += 5;

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
    .filter((x) => x.score > 0)
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
          "Mozilla/5.0 (compatible; Publimentor/1.0; academic reviewer lookup)",
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

async function searchWebProfileUrls(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Publimentor/1.0; academic reviewer lookup)",
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
    return [...new Set(urls)].slice(0, 4);
  } catch {
    return [];
  }
}

async function searchInstitutionProfileUrls(
  institutionDomain: string,
  name: string
): Promise<string[]> {
  const q = `site:${institutionDomain} "${name}"`;
  try {
    const all = await searchWebProfileUrls(q);
    return all.filter((decoded) => {
      const host = extractDomainFromUrl(decoded);
      return (
        host &&
        (host === institutionDomain || host.endsWith(`.${institutionDomain}`))
      );
    });
  } catch {
    return [];
  }
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

/**
 * Resolve a reviewer email using public web sources (best-effort).
 */
export async function enrichReviewerEmail(
  input: EmailEnrichmentInput
): Promise<EmailEnrichmentResult> {
  if (input.existingEmail?.includes("@")) {
    return { email: input.existingEmail, source: "orcid" };
  }

  const lastName =
    input.lastName ||
    input.name.split(/\s+/).filter(Boolean).pop() ||
    "";
  const institutionDomain = input.institutionDomain || null;

  if (input.orcid) {
    const orcidEmail = await fetchOrcidEmail(input.orcid);
    if (orcidEmail) {
      return { email: orcidEmail, source: "orcid" };
    }
  }

  const profileUrls = [
    ...(input.profileUrls || []),
    ...(input.orcid ? await fetchOrcidProfileUrls(input.orcid) : []),
  ];

  const urlsToTry: string[] = [];
  if (input.institutionProfileUrl) {
    urlsToTry.push(input.institutionProfileUrl);
  }
  const instProfile = findInstitutionProfileUrl(profileUrls, institutionDomain);
  if (instProfile && !urlsToTry.includes(instProfile)) {
    urlsToTry.push(instProfile);
  }
  if (input.semanticScholarHomepage) {
    urlsToTry.push(input.semanticScholarHomepage);
  }
  for (const u of profileUrls) {
    if (!urlsToTry.includes(u)) urlsToTry.push(u);
  }

  if (institutionDomain) {
    const searchUrls = await searchInstitutionProfileUrls(
      institutionDomain,
      input.name
    );
    for (const u of searchUrls) {
      if (!urlsToTry.includes(u)) urlsToTry.push(u);
    }
  } else if (input.affiliation && input.affiliation.length > 5) {
    const affShort = input.affiliation.slice(0, 80);
    const searchUrls = await searchWebProfileUrls(
      `"${input.name}" "${affShort}" contact email`
    );
    for (const u of searchUrls) {
      if (!urlsToTry.includes(u)) urlsToTry.push(u);
    }
  }

  for (const url of urlsToTry.slice(0, 6)) {
    const email = await extractEmailFromPage(
      url,
      input.name,
      lastName,
      institutionDomain
    );
    if (email) {
      const source =
        url === input.semanticScholarHomepage
          ? "semantic_scholar"
          : institutionDomain &&
              extractDomainFromUrl(url)?.includes(institutionDomain)
            ? "institution_profile"
            : "web_search";
      return { email, source };
    }
  }

  return { email: null };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Enrich emails for a batch of reviewers (sequential with small delay to reduce load).
 */
export async function enrichReviewerEmailsBatch<
  T extends {
    name: string;
    lastName?: string;
    firstName?: string;
    email?: string | null;
    affiliation?: string;
    verificationUrls?: {
      institutionProfileUrl?: string;
      institutionSearchUrl?: string;
      semanticScholarUrl?: string;
      openAlexUrl?: string;
    };
  },
>(
  reviewers: T[],
  options?: { orcidByName?: Record<string, string> }
): Promise<void> {
  for (const reviewer of reviewers) {
    if (reviewer.email?.includes("@")) continue;

    const key = reviewer.name.trim().toLowerCase();
    const orcid =
      options?.orcidByName?.[key] ||
      extractOrcidFromOpenAlexUrl(reviewer.verificationUrls?.openAlexUrl);

    const institutionDomain = parseInstitutionDomainFromSearchUrl(
      reviewer.verificationUrls?.institutionSearchUrl
    );

    const result = await enrichReviewerEmail({
      name: reviewer.name,
      lastName: reviewer.lastName || reviewer.firstName,
      affiliation: reviewer.affiliation,
      orcid,
      institutionDomain,
      institutionProfileUrl: reviewer.verificationUrls?.institutionProfileUrl,
      semanticScholarHomepage: reviewer.verificationUrls?.semanticScholarUrl,
      existingEmail: reviewer.email,
    });

    if (result.email) {
      reviewer.email = result.email;
      console.log(
        `[Email] ${reviewer.name}: ${result.email} (${result.source || "unknown"})`
      );
    }

    await delay(250);
  }
}

function extractOrcidFromOpenAlexUrl(openAlexUrl?: string): string | null {
  if (!openAlexUrl) return null;
  if (openAlexUrl.includes("orcid.org")) {
    const m = openAlexUrl.match(/orcid\.org\/([0-9X-]+)/i);
    return m ? m[1] : null;
  }
  return null;
}
