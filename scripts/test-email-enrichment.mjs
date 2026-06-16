#!/usr/bin/env node
/**
 * Live probe for reviewer email enrichment.
 * Run: node scripts/test-email-enrichment.mjs
 */

const FETCH_TIMEOUT_MS = 12000;

async function fetchPubMedArticles(pmids) {
  const ids = pmids.join(",");
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids}&retmode=xml`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const xml = await res.text();
  const articles = [];
  const articleBlocks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  for (const block of articleBlocks) {
    const authors = [];
    const authorBlocks = block.match(/<Author[^>]*>[\s\S]*?<\/Author>/g) || [];
    for (const ab of authorBlocks) {
      const lastName = ab.match(/<LastName>([^<]+)<\/LastName>/)?.[1];
      const foreName = ab.match(/<ForeName>([^<]+)<\/ForeName>/)?.[1];
      const affiliations = [...ab.matchAll(/<Affiliation>([^<]+)<\/Affiliation>/g)].map(
        (m) => m[1]
      );
      const affiliation =
        affiliations.find((a) => a.includes("@")) || affiliations[0];
      if (lastName) authors.push({ lastName, foreName, affiliation });
    }
    articles.push({ authors });
  }
  return articles;
}

function extractEmailFromAffiliation(affiliation) {
  const m = affiliation.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/);
  return m ? m[1].toLowerCase() : null;
}

function extractEmailFromPubMed(articles, lastName, firstName) {
  const ln = lastName.toLowerCase();
  const fn = firstName?.toLowerCase();
  for (const article of articles) {
    for (const author of article.authors) {
      if (author.lastName.toLowerCase() !== ln) continue;
      if (fn && author.foreName && !author.foreName.toLowerCase().startsWith(fn[0])) continue;
      if (author.affiliation) {
        const email = extractEmailFromAffiliation(author.affiliation);
        if (email) return email;
      }
    }
  }
  return null;
}

async function fetchStanfordProfileEmail(name) {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const url = `https://profiles.stanford.edu/${slug}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "PublimentorEmailTest/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return { url, email: null, status: res.status };
  const html = await res.text();
  const emails = [...html.matchAll(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)].map(
    (m) => m[1].toLowerCase()
  );
  const filtered = emails.filter((e) => !e.includes("noreply") && !e.startsWith("info@"));
  return { url, email: filtered[0] || null, status: res.status };
}

async function fetchOrcidExpandedSearch(name, affiliation) {
  const escapedName = name.replace(/"/g, '\\"');
  const queries = [`given-and-family-names:"${escapedName}"`];
  if (affiliation) {
    const org = affiliation.split(",")[0].trim().slice(0, 80);
    queries.push(
      `given-and-family-names:"${escapedName}" AND affiliation-org-name:"${org.replace(/"/g, '\\"')}"`
    );
  }
  const lastName = name.split(/\s+/).pop().toLowerCase();
  for (const q of queries) {
    const res = await fetch(
      `https://pub.orcid.org/v3.0/expanded-search?q=${encodeURIComponent(q)}&rows=5`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!res.ok) continue;
    const data = await res.json();
    for (const row of data?.["expanded-result"] || []) {
      if ((row["family-names"] || "").toLowerCase() !== lastName) continue;
      return {
        orcid: (row["orcid-id"] || "").replace(/^https?:\/\/orcid\.org\//i, ""),
        email: row.email || null,
      };
    }
  }
  return null;
}

async function fetchDblpHomepage(name) {
  const res = await fetch(
    `https://dblp.org/search/author/api?q=${encodeURIComponent(name)}&format=json&h=3`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const hits = data?.result?.hits?.hit;
  const hitList = Array.isArray(hits) ? hits : hits ? [hits] : [];
  const lastName = name.toLowerCase().split(/\s+/).pop();
  for (const hit of hitList) {
    const authorName = (hit?.info?.author || "").toLowerCase();
    if (!authorName.includes(lastName)) continue;
    const pidUrl = hit?.["@id"];
    if (!pidUrl?.includes("/pid/")) continue;
    const xmlRes = await fetch(`${pidUrl}.xml`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!xmlRes.ok) continue;
    const xml = await xmlRes.text();
    const homeMatch = xml.match(
      /<www[^>]*>[\s\S]*?<title>Home Page<\/title>[\s\S]*?<url>([^<]+)<\/url>/i
    );
    if (homeMatch?.[1]?.startsWith("http")) return homeMatch[1];
    const anyUrl = xml.match(/<url>(https?:\/\/[^<]+)<\/url>/i);
    if (anyUrl?.[1] && !anyUrl[1].includes("dblp.org")) return anyUrl[1];
  }
  return null;
}

async function fetchOrcidEmail(orcid) {
  const res = await fetch(`https://pub.orcid.org/v3.0/${orcid}/person`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const emails = data?.emails?.email || [];
  return emails.find((e) => e.primary)?.email || emails[0]?.email || null;
}

async function searchDuckDuckGo(query) {
  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(12000),
    }
  );
  const html = await res.text();
  const urls = [];
  const linkRe = /uddg=([^&"']+)/g;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    urls.push(decodeURIComponent(m[1]));
  }
  return [...new Set(urls)].slice(0, 5);
}

const CASES = [
  {
    label: "DuckDuckGo institution search (no API key)",
    run: async () => {
      const urls = await searchDuckDuckGo("site:stanford.edu Fei-Fei Li email");
      const profile = urls.find((u) => u.includes("profiles.stanford.edu"));
      return { email: profile || urls[0] || null, source: "duckduckgo", url: profile };
    },
  },
  {
    label: "PubMed affiliation (Walther)",
    run: async () => {
      const articles = await fetchPubMedArticles(["35210614"]);
      const email = extractEmailFromPubMed(articles, "Walther", "Tobias");
      return { email, source: "pubmed" };
    },
  },
  {
    label: "Stanford profile (Fei-Fei Li)",
    run: async () => {
      const { url, email, status } = await fetchStanfordProfileEmail("Fei-Fei Li");
      return { email, source: "institution_profile", url, status };
    },
  },
  {
    label: "ORCID public email (often empty)",
    run: async () => {
      const email = await fetchOrcidEmail("0000-0002-9338-7575");
      return { email, source: "orcid" };
    },
  },
  {
    label: "ORCID expanded-search (Tobias Walther)",
    run: async () => {
      const hit = await fetchOrcidExpandedSearch(
        "Tobias Walther",
        "University of Bonn"
      );
      return {
        email: hit?.email || hit?.orcid || null,
        source: "orcid_expanded_search",
        url: hit?.orcid ? `https://orcid.org/${hit.orcid}` : undefined,
      };
    },
  },
  {
    label: "DBLP homepage (Donald E. Knuth)",
    run: async () => {
      const url = await fetchDblpHomepage("Donald E. Knuth");
      return { email: url, source: "dblp", url };
    },
  },
];

console.log("=== Live email enrichment probe ===\n");

let found = 0;
for (const c of CASES) {
  try {
    const result = await c.run();
    const ok = result.email ? "✓" : "✗";
    if (result.email) found++;
    console.log(`${ok} ${c.label}`);
    console.log(`   email: ${result.email || "(none)"}`);
    if (result.url) console.log(`   url: ${result.url}`);
    if (result.status) console.log(`   http: ${result.status}`);
    console.log();
  } catch (err) {
    console.log(`✗ ${c.label}`);
    console.log(`   error: ${err.message}\n`);
  }
}

console.log(`Found emails in ${found}/${CASES.length} probes`);
process.exit(found >= 1 ? 0 : 1);
