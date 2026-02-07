/**
 * Tests for Environment Variable Validation
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// Test the schema directly (not the singleton which runs on import)
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z
    .string()
    .min(16)
    .refine(
      (val) => !["super-secret", "change-me", "secret"].some((s) => val.includes(s)),
      "NEXTAUTH_SECRET must not contain default/weak values"
    ),
});

describe("Environment Schema", () => {
  it("accepts valid environment", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@host:5432/db",
      NEXTAUTH_SECRET: "a-truly-strong-production-key!",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing DATABASE_URL", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "production",
      NEXTAUTH_SECRET: "a-truly-strong-production-key!",
    });
    expect(result.success).toBe(false);
  });

  it("rejects weak NEXTAUTH_SECRET containing 'super-secret'", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@host:5432/db",
      NEXTAUTH_SECRET: "super-secret-key-change-in-production",
    });
    expect(result.success).toBe(false);
  });

  it("rejects weak NEXTAUTH_SECRET containing 'secret'", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@host:5432/db",
      NEXTAUTH_SECRET: "my-secret-value-for-production",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short NEXTAUTH_SECRET", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@host:5432/db",
      NEXTAUTH_SECRET: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid NODE_ENV", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "staging",
      DATABASE_URL: "postgresql://user:pass@host:5432/db",
      NEXTAUTH_SECRET: "a-truly-strong-production-key!",
    });
    expect(result.success).toBe(false);
  });
});
