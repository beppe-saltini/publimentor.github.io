/**
 * Tests for Security Utilities
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeString,
  sanitizeFileName,
  validatePassword,
  isPathWithinBase,
  validateFileType,
  generateSecureToken,
  generateApiKey,
  checkRateLimit,
} from "./security";

describe("sanitizeString", () => {
  it("removes HTML tags", () => {
    expect(sanitizeString("<script>alert('xss')</script>")).not.toContain(
      "<script>"
    );
  });

  it("removes javascript: protocol", () => {
    expect(sanitizeString("javascript:alert(1)")).not.toContain("javascript:");
  });

  it("encodes special characters", () => {
    const result = sanitizeString('Hello <"world">');
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
  });

  it("handles non-string input", () => {
    expect(sanitizeString(null as unknown as string)).toBe("");
    expect(sanitizeString(123 as unknown as string)).toBe("");
  });

  it("trims whitespace", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
  });
});

describe("sanitizeFileName", () => {
  it("removes path separators", () => {
    expect(sanitizeFileName("../../../etc/passwd")).not.toContain("/");
    expect(sanitizeFileName("..\\..\\windows\\system32")).not.toContain("\\");
  });

  it("removes null bytes", () => {
    expect(sanitizeFileName("file\0.txt")).not.toContain("\0");
  });

  it("limits length to 255", () => {
    const longName = "a".repeat(300) + ".pdf";
    expect(sanitizeFileName(longName).length).toBeLessThanOrEqual(255);
  });

  it("preserves safe characters", () => {
    expect(sanitizeFileName("manuscript-v2.pdf")).toBe("manuscript-v2.pdf");
  });
});

describe("validatePassword", () => {
  it("rejects short passwords", () => {
    const result = validatePassword("Short1!");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Password must be at least 10 characters long"
    );
  });

  it("requires uppercase letters", () => {
    const result = validatePassword("alllowercase1!");
    expect(result.valid).toBe(false);
  });

  it("requires special characters", () => {
    const result = validatePassword("NoSpecial123A");
    expect(result.valid).toBe(false);
  });

  it("rejects common patterns", () => {
    const result = validatePassword("password123!A");
    expect(result.valid).toBe(false);
  });

  it("accepts strong passwords", () => {
    const result = validatePassword("Str0ng!P@ssw0rd#2025");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("isPathWithinBase", () => {
  it("allows paths within base", () => {
    expect(isPathWithinBase("/uploads", "file.pdf")).toBe(true);
    expect(isPathWithinBase("/uploads", "sub/file.pdf")).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(isPathWithinBase("/uploads", "../etc/passwd")).toBe(false);
    expect(isPathWithinBase("/uploads", "../../root/.ssh")).toBe(false);
  });
});

describe("validateFileType", () => {
  it("validates PDF magic bytes", () => {
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(validateFileType(pdfBuffer, "application/pdf")).toBe(true);
  });

  it("rejects mismatched magic bytes", () => {
    const notPdf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(validateFileType(notPdf, "application/pdf")).toBe(false);
  });

  it("allows unknown MIME types", () => {
    const buffer = Buffer.from([0x00]);
    expect(validateFileType(buffer, "application/unknown")).toBe(true);
  });
});

describe("generateSecureToken", () => {
  it("generates hex tokens of correct length", () => {
    const token = generateSecureToken(32);
    expect(token).toHaveLength(64); // 32 bytes = 64 hex chars
  });

  it("generates unique tokens", () => {
    const a = generateSecureToken();
    const b = generateSecureToken();
    expect(a).not.toBe(b);
  });
});

describe("generateApiKey", () => {
  it("starts with pm_ prefix", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^pm_/);
  });
});

describe("checkRateLimit", () => {
  it("allows initial requests", () => {
    const result = checkRateLimit("test-unique-key-1", {
      windowMs: 60000,
      maxRequests: 5,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("blocks after max requests", () => {
    const key = "test-unique-key-2";
    const config = { windowMs: 60000, maxRequests: 2 };

    checkRateLimit(key, config);
    checkRateLimit(key, config);
    const result = checkRateLimit(key, config);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
