/**
 * Thin typed client for one Crossref work record.
 *
 * The shared retrieval module (src/lib/references/reference-retrieval.ts)
 * flattens Crossref results to a CandidateWork that lacks volume, pages and
 * structured author names. Reference rebuilding needs those, so once a DOI
 * is known we fetch the full record here. Results are cached per DOI for
 * the lifetime of the cache object passed in (one formatting run).
 */

const CROSSREF_WORKS = "https://api.crossref.org/works";
const USER_AGENT = "PubliMentor/1.0 (mailto:support@publimentor.com)";

export interface CrossrefWorkRecord {
  DOI: string;
  title: string;
  authors: Array<{ family: string; given?: string }>;
  year?: number;
  containerTitle?: string;
  shortContainerTitle?: string;
  volume?: string;
  issue?: string;
  page?: string;
  /** Article number for journals without pages (e.g. "e1013"). */
  articleNumber?: string;
  type?: string;
}

interface RawCrossrefWork {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  issued?: { "date-parts"?: number[][] };
  published?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  "short-container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  "article-number"?: string;
  type?: string;
}

/** Strip HTML/MathML tags Crossref sometimes keeps in titles. */
function cleanText(s: string | undefined): string {
  return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function normalizeCrossrefWork(raw: RawCrossrefWork): CrossrefWorkRecord {
  // Reference lists cite the issue year, so prefer the print date over the
  // (earlier) online-first date that Crossref reports as "issued".
  const year =
    raw["published-print"]?.["date-parts"]?.[0]?.[0] ||
    raw.issued?.["date-parts"]?.[0]?.[0] ||
    raw["published-online"]?.["date-parts"]?.[0]?.[0] ||
    raw.published?.["date-parts"]?.[0]?.[0];
  const authors = (raw.author || [])
    .map((a) => {
      if (a.family) return { family: cleanText(a.family), given: a.given ? cleanText(a.given) : undefined };
      if (a.name) return { family: cleanText(a.name) }; // consortium / group author
      return null;
    })
    .filter((a): a is { family: string; given?: string } => !!a && a.family.length > 0);
  return {
    DOI: raw.DOI || "",
    title: cleanText(raw.title?.[0]),
    authors,
    year: typeof year === "number" ? year : undefined,
    containerTitle: cleanText(raw["container-title"]?.[0]) || undefined,
    shortContainerTitle: cleanText(raw["short-container-title"]?.[0]) || undefined,
    volume: raw.volume,
    issue: raw.issue,
    page: raw.page,
    articleNumber: raw["article-number"],
    type: raw.type,
  };
}

export type WorkCache = Map<string, Promise<CrossrefWorkRecord | null>>;

/**
 * Fetch one work by DOI. Returns null on any failure (404, network error,
 * timeout) — callers treat null as "could not verify".
 */
export async function fetchCrossrefWork(doi: string, options: { cache?: WorkCache; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<CrossrefWorkRecord | null> {
  const key = doi.trim().toLowerCase();
  const cache = options.cache;
  const cached = cache?.get(key);
  if (cached) return cached;
  const run = (async () => {
    const f = options.fetchImpl || fetch;
    // Up to three tries: 429/5xx responses back off (honouring Retry-After when given).
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await f(`${CROSSREF_WORKS}/${encodeURIComponent(doi.trim())}`, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
        });
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get("retry-after")) || 0;
          await new Promise((r) => setTimeout(r, Math.min(5000, retryAfter * 1000 || 500 * 2 ** attempt)));
          continue;
        }
        if (!res.ok) return null;
        const data = (await res.json()) as { message?: RawCrossrefWork };
        if (!data.message) return null;
        return normalizeCrossrefWork(data.message);
      } catch {
        return null;
      }
    }
    return null;
  })();
  cache?.set(key, run);
  return run;
}

/**
 * Turn a short container title such as "Nat Rev Drug Discov" into the
 * dotted form Cell Press uses ("Nat. Rev. Drug Discov."). A word gets a
 * period when it is a strict prefix of the matching full-title word.
 */
export function dottedAbbreviation(short: string | undefined, full: string | undefined): string | undefined {
  if (!short) return full;
  if (/\./.test(short)) return short; // already dotted
  const fullWords = (full || "").split(/\s+/).filter(Boolean);
  let cursor = 0;
  return short
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const bare = word.replace(/[^\p{L}\p{N}]/gu, "");
      for (let i = cursor; i < fullWords.length; i++) {
        const fw = fullWords[i].replace(/[^\p{L}\p{N}]/gu, "");
        if (fw.toLowerCase().startsWith(bare.toLowerCase())) {
          cursor = i + 1;
          return fw.length > bare.length ? `${word}.` : word;
        }
      }
      // Not found in the full title: single-word abbreviations are usually truncated.
      return bare.length <= 4 && !/^(of|and|the|in|for|on|de|la|le|der|und)$/i.test(bare) && fullWords.length > 0 ? `${word}.` : word;
    })
    .join(" ");
}
