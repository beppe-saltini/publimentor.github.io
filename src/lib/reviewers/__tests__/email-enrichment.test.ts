import { describe, it, expect, vi, afterEach } from "vitest";
import {
  extractEmailsFromHtml,
  pickBestEmail,
  parseInstitutionDomainFromSearchUrl,
  extractEmailFromAffiliation,
  extractEmailFromPubMedAuthorBlocks,
  nameToProfileSlug,
  buildInstitutionProfileCandidates,
  fetchOrcidExpandedSearch,
  fetchDblpHomepage,
  emailSourceLabel,
  computeEmailBatchMetrics,
} from "../email-enrichment";
import {
  emailCacheKey,
  getCachedEmail,
  setCachedEmail,
  clearEmailCache,
} from "../email-enrichment-cache";

describe("email-enrichment", () => {
  it("extracts mailto and plain emails from HTML", () => {
    const html = `
      <a href="mailto:jane.doe@stanford.edu">Email</a>
      Contact: john.smith@example.org for info.
    `;
    const emails = extractEmailsFromHtml(html);
    expect(emails).toContain("jane.doe@stanford.edu");
    expect(emails).toContain("john.smith@example.org");
  });

  it("prefers institutional email matching the reviewer name", () => {
    const best = pickBestEmail(
      [
        "info@mit.edu",
        "j.doe@stanford.edu",
        "jdoe@gmail.com",
      ],
      "Jane Doe",
      "Doe",
      "stanford.edu"
    );
    expect(best).toBe("j.doe@stanford.edu");
  });

  it("rejects generic inbox emails even on matching domain", () => {
    const best = pickBestEmail(
      ["info@stanford.edu", "contact@stanford.edu"],
      "Jane Doe",
      "Doe",
      "stanford.edu"
    );
    expect(best).toBeNull();
  });

  it("parses institution domain from Google site search URL", () => {
    const domain = parseInstitutionDomainFromSearchUrl(
      'https://www.google.com/search?q=site:stanford.edu+"Jane+Doe"'
    );
    expect(domain).toBe("stanford.edu");
  });

  it("extracts email from PubMed affiliation text", () => {
    const aff =
      "Department of Microbiology, University of Bonn, kaiser@microbiology-bonn.de";
    expect(extractEmailFromAffiliation(aff)).toBe("kaiser@microbiology-bonn.de");
  });

  it("matches author by surname in PubMed articles", () => {
    const email = extractEmailFromPubMedAuthorBlocks(
      [
        {
          authors: [
            {
              lastName: "Kaiser",
              foreName: "Oliver",
              affiliation: "Institute, kaiser@microbiology-bonn.de",
            },
            { lastName: "Smith", affiliation: "smith@other.edu" },
          ],
        },
      ],
      "Kaiser",
      "Oliver"
    );
    expect(email).toBe("kaiser@microbiology-bonn.de");
  });

  it("builds stanford profile slug and URL candidates", () => {
    expect(nameToProfileSlug("Fei-Fei Li")).toBe("fei-fei-li");
    const urls = buildInstitutionProfileCandidates("Fei-Fei Li", "stanford.edu");
    expect(urls).toContain("https://profiles.stanford.edu/fei-fei-li");
  });

  it("extracts email from affiliation text on reviewer record", () => {
    const email = extractEmailFromAffiliation(
      "Dept of Medicine, joel.goodman@UTSouthwestern.edu"
    );
    expect(email).toBe("joel.goodman@utsouthwestern.edu");
  });

  it("builds generic institution profile URL patterns", () => {
    const urls = buildInstitutionProfileCandidates("Jane Doe", "example.edu");
    expect(urls).toContain("https://profiles.example.edu/jane-doe");
    expect(urls).toContain("https://people.example.edu/jane-doe");
    expect(urls).toContain("https://www.example.edu/faculty/jane-doe");
  });

  it("returns human-readable email source labels", () => {
    expect(emailSourceLabel("pubmed")).toBe("PubMed");
    expect(emailSourceLabel("orcid")).toBe("ORCID");
    expect(emailSourceLabel("dblp")).toBe("DBLP homepage");
    expect(emailSourceLabel("web_search")).toBe("Web search");
    expect(emailSourceLabel(undefined)).toBe("");
  });

  it("computes batch email metrics by source", () => {
    const metrics = computeEmailBatchMetrics([
      { email: "a@stanford.edu", emailSource: "pubmed" },
      { email: "b@mit.edu", emailSource: "orcid" },
      { email: null },
    ]);
    expect(metrics.emailsFound).toBe(2);
    expect(metrics.emailsMissing).toBe(1);
    expect(metrics.bySource.pubmed).toBe(1);
    expect(metrics.bySource.orcid).toBe(1);
  });
});

describe("email-enrichment-cache", () => {
  afterEach(() => {
    clearEmailCache();
  });

  it("keys cache by ORCID when available", () => {
    expect(
      emailCacheKey({ orcid: "0000-0001-2345-6789", name: "Jane Doe" })
    ).toBe("orcid:0000-0001-2345-6789");
  });

  it("keys cache by name and institution domain otherwise", () => {
    expect(
      emailCacheKey({
        name: "Jane Doe",
        institutionDomain: "stanford.edu",
      })
    ).toBe("name:jane doe|stanford.edu");
  });

  it("stores and retrieves cached enrichment results", () => {
    const key = "name:jane doe|stanford.edu";
    const result = {
      email: "jane@stanford.edu",
      emailSource: "pubmed" as const,
      emailConfidence: "high" as const,
    };
    setCachedEmail(key, result);
    expect(getCachedEmail(key)?.email).toBe("jane@stanford.edu");
    expect(getCachedEmail("missing")).toBeNull();
  });
});

describe("fetchOrcidExpandedSearch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses expanded-search JSON and returns matching ORCID hit", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        "expanded-result": [
          {
            "orcid-id": "https://orcid.org/0000-0002-9338-7575",
            "given-names": "Tobias",
            "family-names": "Walther",
            email: "walther@example.edu",
          },
        ],
      }),
    } as Response);

    const hit = await fetchOrcidExpandedSearch(
      "Tobias Walther",
      "University of Bonn"
    );
    expect(hit?.orcid).toBe("0000-0002-9338-7575");
    expect(hit?.email).toBe("walther@example.edu");
  });

  it("returns null when surname does not match", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        "expanded-result": [
          {
            "orcid-id": "https://orcid.org/0000-0001-1111-2222",
            "family-names": "Smith",
            email: "smith@example.edu",
          },
        ],
      }),
    } as Response);

    const hit = await fetchOrcidExpandedSearch("Jane Doe");
    expect(hit).toBeNull();
  });
});

describe("fetchDblpHomepage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts homepage URL from DBLP author XML", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            hits: {
              hit: [
                {
                  info: { author: "Donald E. Knuth" },
                  "@id": "https://dblp.org/pid/k/DonaldEKnut.html",
                },
              ],
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          `<person><www><title>Home Page</title><url>https://www-cs-faculty.stanford.edu/~knuth/</url></www></person>`,
      } as Response);

    const homepage = await fetchDblpHomepage("Donald E. Knuth");
    expect(homepage).toBe("https://www-cs-faculty.stanford.edu/~knuth/");
  });
});
