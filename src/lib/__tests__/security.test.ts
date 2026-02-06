/**
 * Test Suite: Security Utilities
 * Tests rate limiting, input sanitization, path security,
 * file validation, password validation, and token generation.
 *
 * TC-IDs: SEC-001 through SEC-027
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  sanitizeString,
  sanitizeObject,
  isPathWithinBase,
  sanitizeFileName,
  validateFileType,
  detectMimeType,
  validatePassword,
  generateSecureToken,
  generateApiKey,
  getClientIp,
  getUserAgent,
  checkContentLength,
  type RateLimitConfig,
} from "../security";

// ============================================================
// Rate Limiting
// ============================================================
describe("checkRateLimit", () => {
  it("SEC-001: first request is allowed", () => {
    const id = `test-rate-${Date.now()}-${Math.random()}`;
    const result = checkRateLimit(id);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("SEC-002: exceeding max requests blocks", () => {
    const id = `test-exceed-${Date.now()}-${Math.random()}`;
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 3 };

    // Make maxRequests calls
    checkRateLimit(id, config); // 1
    checkRateLimit(id, config); // 2
    checkRateLimit(id, config); // 3

    // Next call should be blocked
    const result = checkRateLimit(id, config);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("remaining count decreases correctly", () => {
    const id = `test-remaining-${Date.now()}-${Math.random()}`;
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 5 };

    const r1 = checkRateLimit(id, config);
    expect(r1.remaining).toBe(4);

    const r2 = checkRateLimit(id, config);
    expect(r2.remaining).toBe(3);
  });
});

// ============================================================
// Input Sanitization
// ============================================================
describe("sanitizeString", () => {
  it("SEC-004: removes HTML tags", () => {
    const result = sanitizeString("<script>alert('xss')</script>");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("</script>");
  });

  it("SEC-005: removes javascript: protocol", () => {
    const result = sanitizeString("javascript:alert(1)");
    expect(result).not.toContain("javascript:");
  });

  it("SEC-006: removes event handlers", () => {
    const result = sanitizeString('onerror=alert(1)');
    expect(result).not.toContain("onerror=");
  });

  it("SEC-007: encodes angle brackets", () => {
    const result = sanitizeString("<div>test</div>");
    expect(result).not.toContain("<div>");
    // After tag removal, the remaining angle brackets get encoded
  });

  it("encodes quotes", () => {
    const result = sanitizeString('He said "hello" and \'bye\'');
    expect(result).toContain("&quot;");
    expect(result).toContain("&#39;");
  });

  it("trims whitespace", () => {
    const result = sanitizeString("  hello  ");
    expect(result).toBe("hello");
  });

  it("returns empty string for non-string input", () => {
    expect(sanitizeString(123 as unknown as string)).toBe("");
    expect(sanitizeString(null as unknown as string)).toBe("");
  });
});

describe("sanitizeObject", () => {
  it("SEC-008: sanitizes nested strings recursively", () => {
    const input = {
      name: "<script>alert('xss')</script>John",
      nested: {
        value: "javascript:evil()",
      },
      items: ["<b>bold</b>", "normal"],
      count: 42,
    };

    const result = sanitizeObject(input);
    expect(result.name).not.toContain("<script>");
    expect(result.nested.value).not.toContain("javascript:");
    expect(result.items[0]).not.toContain("<b>");
    expect(result.count).toBe(42); // non-string preserved
  });

  it("preserves non-string values", () => {
    const input = { num: 42, bool: true, nil: null };
    const result = sanitizeObject(input);
    expect(result.num).toBe(42);
    expect(result.bool).toBe(true);
    expect(result.nil).toBeNull();
  });
});

// ============================================================
// Path Security
// ============================================================
describe("isPathWithinBase", () => {
  it("SEC-009: detects path traversal attack", () => {
    expect(isPathWithinBase("/app/uploads", "../../../etc/passwd")).toBe(false);
  });

  it("SEC-010: allows valid path within base", () => {
    expect(isPathWithinBase("/app/uploads", "file.pdf")).toBe(true);
    expect(isPathWithinBase("/app/uploads", "subdir/file.pdf")).toBe(true);
  });

  it("allows base path itself", () => {
    expect(isPathWithinBase("/app/uploads", ".")).toBe(true);
  });

  it("blocks sneaky traversal", () => {
    expect(isPathWithinBase("/app/uploads", "valid/../../../etc/passwd")).toBe(false);
  });
});

describe("sanitizeFileName", () => {
  it("SEC-011: removes path separators", () => {
    const result = sanitizeFileName("../../file.pdf");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
  });

  it("SEC-012: removes null bytes", () => {
    const result = sanitizeFileName("file\x00.pdf");
    expect(result).not.toContain("\x00");
    expect(result).toBe("file.pdf");
  });

  it("removes dangerous characters", () => {
    const result = sanitizeFileName('file<>:"|?*.pdf');
    expect(result).not.toMatch(/[<>:"|?*]/);
  });

  it("limits filename length to 255", () => {
    const longName = "a".repeat(300) + ".pdf";
    const result = sanitizeFileName(longName);
    expect(result.length).toBeLessThanOrEqual(255);
  });
});

// ============================================================
// File Validation
// ============================================================
describe("validateFileType", () => {
  it("SEC-020: validates PDF magic bytes", () => {
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(validateFileType(pdfBuffer, "application/pdf")).toBe(true);
  });

  it("SEC-021: rejects invalid file type", () => {
    const fakeBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(validateFileType(fakeBuffer, "application/pdf")).toBe(false);
  });

  it("validates JPEG magic bytes", () => {
    const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    expect(validateFileType(jpegBuffer, "image/jpeg")).toBe(true);
  });

  it("validates PNG magic bytes", () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    expect(validateFileType(pngBuffer, "image/png")).toBe(true);
  });

  it("allows unknown MIME types (returns true)", () => {
    const buffer = Buffer.from([0x00]);
    expect(validateFileType(buffer, "application/unknown")).toBe(true);
  });
});

describe("detectMimeType", () => {
  it("SEC-022: detects PDF", () => {
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    expect(detectMimeType(pdfBuffer)).toBe("application/pdf");
  });

  it("SEC-023: returns null for unknown type", () => {
    const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(detectMimeType(unknownBuffer)).toBeNull();
  });

  it("detects JPEG", () => {
    const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF]);
    expect(detectMimeType(jpegBuffer)).toBe("image/jpeg");
  });

  it("detects PNG", () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    expect(detectMimeType(pngBuffer)).toBe("image/png");
  });
});

// ============================================================
// Password Validation
// ============================================================
describe("validatePassword", () => {
  it("SEC-013: rejects password too short", () => {
    const result = validatePassword("Aa1!shor");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("10 characters")
    );
  });

  it("SEC-014: rejects password without uppercase", () => {
    const result = validatePassword("abcdefgh1!xx");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("uppercase")
    );
  });

  it("SEC-015: rejects password without lowercase", () => {
    const result = validatePassword("ABCDEFGH1!XX");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("lowercase")
    );
  });

  it("SEC-016: rejects password without number", () => {
    const result = validatePassword("Abcdefghij!");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("number")
    );
  });

  it("SEC-017: rejects password without special character", () => {
    const result = validatePassword("Abcdefgh123");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("special character")
    );
  });

  it("SEC-018: rejects common patterns (password...)", () => {
    const result = validatePassword("Password123!");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("common")
    );
  });

  it("SEC-019: accepts strong password", () => {
    const result = validatePassword("MyS3cure!Pass");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects repeated character pattern", () => {
    const result = validatePassword("Aaaaaa1234!");
    expect(result.valid).toBe(false);
  });
});

// ============================================================
// Token Generation
// ============================================================
describe("generateSecureToken", () => {
  it("SEC-024: generates hex string of correct length", () => {
    const token = generateSecureToken(32);
    expect(token).toHaveLength(64); // 32 bytes = 64 hex chars
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("generates unique tokens", () => {
    const token1 = generateSecureToken();
    const token2 = generateSecureToken();
    expect(token1).not.toBe(token2);
  });
});

describe("generateApiKey", () => {
  it("SEC-025: starts with 'pm_' prefix", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^pm_/);
  });

  it("generates unique keys", () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1).not.toBe(key2);
  });
});

// ============================================================
// Request Helpers
// ============================================================
describe("getClientIp", () => {
  it("SEC-026: extracts IP from x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("extracts IP from x-real-ip", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "9.8.7.6" },
    });
    expect(getClientIp(req)).toBe("9.8.7.6");
  });

  it("SEC-027: returns 'unknown' when no headers", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("unknown");
  });
});

describe("getUserAgent", () => {
  it("returns user agent string", () => {
    const req = new Request("http://localhost", {
      headers: { "user-agent": "TestBot/1.0" },
    });
    expect(getUserAgent(req)).toBe("TestBot/1.0");
  });

  it("returns 'unknown' when no user-agent header", () => {
    const req = new Request("http://localhost");
    expect(getUserAgent(req)).toBe("unknown");
  });
});

describe("checkContentLength", () => {
  it("allows content within limit", () => {
    const req = new Request("http://localhost", {
      headers: { "content-length": "1024" },
    });
    const result = checkContentLength(req, 2048);
    expect(result.valid).toBe(true);
    expect(result.size).toBe(1024);
  });

  it("blocks content exceeding limit", () => {
    const req = new Request("http://localhost", {
      headers: { "content-length": "10000000" },
    });
    const result = checkContentLength(req, 1024);
    expect(result.valid).toBe(false);
  });

  it("handles missing content-length", () => {
    const req = new Request("http://localhost");
    const result = checkContentLength(req, 1024);
    expect(result.valid).toBe(true);
    expect(result.size).toBe(0);
  });
});
