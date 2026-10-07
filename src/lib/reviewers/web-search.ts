/**
 * Web search with titles and snippets, for screening checks that need to read
 * the results, not just collect URLs. Providers are tried in order and the first
 * one that answers wins: Google Custom Search (GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID),
 * Serper (SERPER_API_KEY, Google results), Brave (BRAVE_SEARCH_API_KEY), then a
 * keyless DuckDuckGo HTML search.
 */

const FETCH_TIMEOUT_MS = 9000;

export type WebSearchProvider = "google-cse" | "serper" | "brave" | "duckduckgo";

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  provider: WebSearchProvider | null;
  hits: WebSearchHit[];
}

export function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function cleanHit(hit: { title?: unknown; url?: unknown; snippet?: unknown }): WebSearchHit | null {
  const url = typeof hit.url === "string" ? hit.url : "";
  if (!url.startsWith("http")) return null;
  return {
    title: typeof hit.title === "string" ? hit.title.trim() : "",
    url,
    snippet: typeof hit.snippet === "string" ? hit.snippet.trim() : "",
  };
}

async function searchGoogleCse(query: string, limit: number): Promise<WebSearchHit[] | null> {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return null;
  try {
    const params = new URLSearchParams({ key, cx, q: query, num: String(Math.min(limit, 10)) });
    const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return ((data.items || []) as Array<{ title?: string; link?: string; snippet?: string }>)
      .map((i) => cleanHit({ title: i.title, url: i.link, snippet: i.snippet }))
      .filter((h): h is WebSearchHit => h !== null);
  } catch {
    return null;
  }
}

async function searchSerper(query: string, limit: number): Promise<WebSearchHit[] | null> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ q: query, num: limit }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return ((data.organic || []) as Array<{ title?: string; link?: string; snippet?: string }>)
      .map((r) => cleanHit({ title: r.title, url: r.link, snippet: r.snippet }))
      .filter((h): h is WebSearchHit => h !== null);
  } catch {
    return null;
  }
}

async function searchBrave(query: string, limit: number): Promise<WebSearchHit[] | null> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
      {
        headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return ((data.web?.results || []) as Array<{ title?: string; url?: string; description?: string }>)
      .map((r) => cleanHit({ title: stripTags(r.title || ""), url: r.url, snippet: stripTags(r.description || "") }))
      .filter((h): h is WebSearchHit => h !== null);
  } catch {
    return null;
  }
}

export function parseDuckDuckGoHtml(html: string, limit: number): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const blockRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null && hits.length < limit) {
    const href = decodeHtmlEntities(m[1]);
    const uddg = /uddg=([^&]+)/.exec(href);
    let url = href;
    if (uddg) {
      try {
        url = decodeURIComponent(uddg[1]);
      } catch {
        continue;
      }
    }
    if (!url.startsWith("http")) continue;
    hits.push({ title: stripTags(m[2]), url, snippet: stripTags(m[3]) });
  }
  return hits;
}

// DuckDuckGo answers automated traffic with a bot-check page (HTTP 202, no results); back off when seen.
const DDG_BLOCK_COOLDOWN_MS = 10 * 60 * 1000;
let ddgBlockedUntil = 0;

async function searchDuckDuckGo(query: string, limit: number): Promise<WebSearchHit[] | null> {
  if (Date.now() < ddgBlockedUntil) return null;
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status !== 200) {
      ddgBlockedUntil = Date.now() + DDG_BLOCK_COOLDOWN_MS;
      return null;
    }
    const html = await res.text();
    const hits = parseDuckDuckGoHtml(html, limit);
    if (hits.length === 0 && /anomaly|challenge|bots?\b/i.test(html)) {
      ddgBlockedUntil = Date.now() + DDG_BLOCK_COOLDOWN_MS;
      return null;
    }
    return hits;
  } catch {
    return null;
  }
}

const PROVIDERS: Array<[WebSearchProvider, (q: string, n: number) => Promise<WebSearchHit[] | null>]> = [
  ["google-cse", searchGoogleCse],
  ["serper", searchSerper],
  ["brave", searchBrave],
  ["duckduckgo", searchDuckDuckGo],
];

/** First provider that answers (even with zero hits) wins; `provider` is null when none did. */
export async function webSearch(query: string, limit = 8): Promise<WebSearchResult> {
  for (const [provider, run] of PROVIDERS) {
    const hits = await run(query, limit);
    if (hits !== null) return { provider, hits: hits.slice(0, limit) };
  }
  return { provider: null, hits: [] };
}
