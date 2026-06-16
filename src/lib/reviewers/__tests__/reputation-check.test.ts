import { describe, it, expect } from "vitest";
import {
  isHighConfidencePersonMatch,
  extractLastName,
  parseFbsRssItems,
} from "../reputation-check";

describe("reputation-check", () => {
  const person = { name: "Paolo Macchiarini", firstName: "Paolo", lastName: "Macchiarini" };

  describe("isHighConfidencePersonMatch", () => {
    it("matches full first + last name in title", () => {
      expect(
        isHighConfidencePersonMatch(
          "Schneider Shorts: jail sentence for Paolo Macchiarini",
          person
        )
      ).toBe(true);
    });

    it("matches initial + surname", () => {
      expect(
        isHighConfidencePersonMatch("Investigation of P. Macchiarini continues", person)
      ).toBe(true);
    });

    it("matches Last, First format", () => {
      expect(
        isHighConfidencePersonMatch("Report on Macchiarini, Paolo and colleagues", person)
      ).toBe(true);
    });

    it("rejects surname-only match (not conservative enough)", () => {
      expect(
        isHighConfidencePersonMatch(
          "Schneider Shorts: jail sentence for Macchiarini",
          person
        )
      ).toBe(false);
    });

    it("rejects unrelated text", () => {
      expect(
        isHighConfidencePersonMatch("Climate change in the arctic", person)
      ).toBe(false);
    });

    it("rejects when first name is missing from input", () => {
      expect(
        isHighConfidencePersonMatch("Macchiarini guilty of misconduct", {
          name: "Macchiarini",
          lastName: "Macchiarini",
        })
      ).toBe(false);
    });

    it("matches person name in FBS category tag", () => {
      expect(
        isHighConfidencePersonMatch("Paolo Macchiarini", person)
      ).toBe(true);
    });
  });

  describe("extractLastName", () => {
    it("uses explicit lastName", () => {
      expect(extractLastName("John Smith", "Smith")).toBe("Smith");
    });

    it("parses from full name", () => {
      expect(extractLastName("Ashish Vaswani")).toBe("Vaswani");
    });
  });

  describe("parseFbsRssItems", () => {
    it("parses RSS item title and link", () => {
      const xml = `<?xml version="1.0"?>
        <rss><channel>
          <item>
            <title><![CDATA[Paolo Macchiarini guilty of misconduct]]></title>
            <link>https://forbetterscience.com/2023/06/23/example/</link>
            <category><![CDATA[Paolo Macchiarini]]></category>
          </item>
        </channel></rss>`;
      const items = parseFbsRssItems(xml);
      expect(items).toHaveLength(1);
      expect(items[0].title).toContain("Paolo Macchiarini");
      expect(items[0].categories).toContain("Paolo Macchiarini");
    });
  });
});
