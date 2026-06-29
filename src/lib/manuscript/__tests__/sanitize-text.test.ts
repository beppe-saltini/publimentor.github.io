import { describe, it, expect } from "vitest";
import {
  sanitizeOptionalTextForPostgres,
  sanitizeTextArrayForPostgres,
  sanitizeTextForPostgres,
} from "../sanitize-text";

describe("sanitizeTextForPostgres", () => {
  it("removes NUL bytes that Postgres rejects", () => {
    const input = "hello\u0000world\u0000";
    expect(sanitizeTextForPostgres(input)).toBe("helloworld");
  });

  it("preserves tab, newline, and carriage return", () => {
    const input = "line1\nline2\tcol\r\n";
    expect(sanitizeTextForPostgres(input)).toBe(input);
  });

  it("strips other C0 control characters", () => {
    const input = "a\u0001b\u0008c\u000Ed\u007F";
    expect(sanitizeTextForPostgres(input)).toBe("abcd");
  });

  it("returns empty string for nullish input", () => {
    expect(sanitizeTextForPostgres(null)).toBe("");
    expect(sanitizeTextForPostgres(undefined)).toBe("");
    expect(sanitizeTextForPostgres("")).toBe("");
  });
});

describe("sanitizeOptionalTextForPostgres", () => {
  it("preserves null and undefined", () => {
    expect(sanitizeOptionalTextForPostgres(null)).toBeNull();
    expect(sanitizeOptionalTextForPostgres(undefined)).toBeUndefined();
  });

  it("sanitizes string values", () => {
    expect(sanitizeOptionalTextForPostgres("a\u0000b")).toBe("ab");
  });
});

describe("sanitizeTextArrayForPostgres", () => {
  it("sanitizes each array element", () => {
    expect(sanitizeTextArrayForPostgres(["ok", "a\u0000b"])).toEqual(["ok", "ab"]);
  });

  it("returns empty array for nullish or empty input", () => {
    expect(sanitizeTextArrayForPostgres(null)).toEqual([]);
    expect(sanitizeTextArrayForPostgres(undefined)).toEqual([]);
    expect(sanitizeTextArrayForPostgres([])).toEqual([]);
  });
});
