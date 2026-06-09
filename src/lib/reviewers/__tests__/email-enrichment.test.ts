import { describe, it, expect } from "vitest";
import {
  extractEmailsFromHtml,
  pickBestEmail,
  parseInstitutionDomainFromSearchUrl,
} from "../email-enrichment";

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

  it("parses institution domain from Google site search URL", () => {
    const domain = parseInstitutionDomainFromSearchUrl(
      'https://www.google.com/search?q=site:stanford.edu+"Jane+Doe"'
    );
    expect(domain).toBe("stanford.edu");
  });
});
