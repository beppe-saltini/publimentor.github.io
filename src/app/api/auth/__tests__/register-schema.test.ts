/**
 * Tests for the Registration API Schema Validation
 *
 * Covers the new profile fields added to registration:
 * - role (AUTHOR, EDITOR, PUBLISHER)
 * - gender (MALE, FEMALE, NON_BINARY, PREFER_NOT_TO_SAY)
 * - primaryExpertise / secondaryExpertise
 * - orcid
 * - betaCode requirement
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirror the exact schema from the register route
const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Invalid email address").max(254),
  password: z.string().min(10, "Password must be at least 10 characters").max(128),
  institution: z.string().max(200).optional(),
  orcid: z.string().max(50).optional(),
  role: z.enum(["AUTHOR", "EDITOR", "PUBLISHER"]).optional(),
  gender: z.enum(["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_TO_SAY"]).optional(),
  primaryExpertise: z.string().max(200).optional(),
  secondaryExpertise: z.string().max(200).optional(),
  betaCode: z.string().min(1, "Beta access code is required"),
});

const validBase = {
  name: "Dr. Jane Smith",
  email: "jane@university.edu",
  password: "Str0ng!Pass#2026",
  betaCode: "BETA-ABC-123",
};

// ============================================================
// Core fields
// ============================================================

describe("Registration Schema - Core Fields", () => {
  it("RS-001: accepts valid registration with all required fields", () => {
    const result = registerSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("RS-002: rejects name shorter than 2 characters", () => {
    const result = registerSchema.safeParse({ ...validBase, name: "J" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("2 characters");
    }
  });

  it("RS-003: rejects invalid email", () => {
    const result = registerSchema.safeParse({ ...validBase, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("RS-004: rejects password shorter than 10 characters", () => {
    const result = registerSchema.safeParse({ ...validBase, password: "Short1!" });
    expect(result.success).toBe(false);
  });

  it("RS-005: rejects missing betaCode", () => {
    const { betaCode, ...withoutBeta } = validBase;
    const result = registerSchema.safeParse(withoutBeta);
    expect(result.success).toBe(false);
  });

  it("RS-006: rejects empty betaCode string", () => {
    const result = registerSchema.safeParse({ ...validBase, betaCode: "" });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// Role field
// ============================================================

describe("Registration Schema - Role Selection", () => {
  it("RS-010: accepts AUTHOR role", () => {
    const result = registerSchema.safeParse({ ...validBase, role: "AUTHOR" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.role).toBe("AUTHOR");
  });

  it("RS-011: accepts EDITOR role", () => {
    const result = registerSchema.safeParse({ ...validBase, role: "EDITOR" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.role).toBe("EDITOR");
  });

  it("RS-012: accepts PUBLISHER role", () => {
    const result = registerSchema.safeParse({ ...validBase, role: "PUBLISHER" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.role).toBe("PUBLISHER");
  });

  it("RS-013: rejects invalid role value", () => {
    const result = registerSchema.safeParse({ ...validBase, role: "REVIEWER" });
    expect(result.success).toBe(false);
  });

  it("RS-014: allows omitting role (optional)", () => {
    const result = registerSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.role).toBeUndefined();
  });
});

// ============================================================
// Gender field
// ============================================================

describe("Registration Schema - Gender", () => {
  it("RS-020: accepts MALE gender", () => {
    const result = registerSchema.safeParse({ ...validBase, gender: "MALE" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.gender).toBe("MALE");
  });

  it("RS-021: accepts FEMALE gender", () => {
    const result = registerSchema.safeParse({ ...validBase, gender: "FEMALE" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.gender).toBe("FEMALE");
  });

  it("RS-022: accepts NON_BINARY gender", () => {
    const result = registerSchema.safeParse({ ...validBase, gender: "NON_BINARY" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.gender).toBe("NON_BINARY");
  });

  it("RS-023: accepts PREFER_NOT_TO_SAY gender", () => {
    const result = registerSchema.safeParse({ ...validBase, gender: "PREFER_NOT_TO_SAY" });
    expect(result.success).toBe(true);
  });

  it("RS-024: rejects invalid gender value", () => {
    const result = registerSchema.safeParse({ ...validBase, gender: "OTHER" });
    expect(result.success).toBe(false);
  });

  it("RS-025: allows omitting gender (optional)", () => {
    const result = registerSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.gender).toBeUndefined();
  });
});

// ============================================================
// Expertise fields
// ============================================================

describe("Registration Schema - Expertise", () => {
  it("RS-030: accepts primary expertise", () => {
    const result = registerSchema.safeParse({
      ...validBase,
      primaryExpertise: "Infectious Disease Epidemiology",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.primaryExpertise).toBe("Infectious Disease Epidemiology");
  });

  it("RS-031: accepts secondary expertise", () => {
    const result = registerSchema.safeParse({
      ...validBase,
      secondaryExpertise: "Mathematical Modelling",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.secondaryExpertise).toBe("Mathematical Modelling");
  });

  it("RS-032: accepts both expertise fields together", () => {
    const result = registerSchema.safeParse({
      ...validBase,
      primaryExpertise: "Molecular Biology",
      secondaryExpertise: "CRISPR Gene Editing",
    });
    expect(result.success).toBe(true);
  });

  it("RS-033: rejects expertise longer than 200 chars", () => {
    const result = registerSchema.safeParse({
      ...validBase,
      primaryExpertise: "A".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("RS-034: allows omitting expertise fields (optional)", () => {
    const result = registerSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryExpertise).toBeUndefined();
      expect(result.data.secondaryExpertise).toBeUndefined();
    }
  });
});

// ============================================================
// ORCID field
// ============================================================

describe("Registration Schema - ORCID", () => {
  it("RS-040: accepts valid ORCID", () => {
    const result = registerSchema.safeParse({
      ...validBase,
      orcid: "0000-0002-1234-5678",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.orcid).toBe("0000-0002-1234-5678");
  });

  it("RS-041: rejects ORCID longer than 50 chars", () => {
    const result = registerSchema.safeParse({
      ...validBase,
      orcid: "0".repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it("RS-042: allows omitting ORCID (optional)", () => {
    const result = registerSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.orcid).toBeUndefined();
  });
});

// ============================================================
// Full registration with all profile fields
// ============================================================

describe("Registration Schema - Full Profile", () => {
  it("RS-050: accepts full registration with all fields", () => {
    const result = registerSchema.safeParse({
      ...validBase,
      institution: "University of Oxford",
      role: "EDITOR",
      gender: "FEMALE",
      primaryExpertise: "Public Health",
      secondaryExpertise: "Statistical Analysis",
      orcid: "0000-0003-9876-5432",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("EDITOR");
      expect(result.data.gender).toBe("FEMALE");
      expect(result.data.primaryExpertise).toBe("Public Health");
      expect(result.data.secondaryExpertise).toBe("Statistical Analysis");
      expect(result.data.orcid).toBe("0000-0003-9876-5432");
      expect(result.data.institution).toBe("University of Oxford");
    }
  });
});
