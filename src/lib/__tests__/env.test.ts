import { describe, it, expect } from "vitest";
import { validateEnvValues } from "../env";

const base = {
  DATABASE_URL: "postgresql://u:p@db.example.com:5432/app",
  AUTH_SECRET: "a-long-random-value-0123456789",
};

describe("validateEnvValues", () => {
  it("accepts a minimal production configuration", () => {
    const result = validateEnvValues({ ...base, NODE_ENV: "production" });
    expect(result.errors).toEqual([]);
    expect(result.env?.DATABASE_URL).toBe(base.DATABASE_URL);
    expect(result.warnings.join(" ")).toContain("Upstash");
  });

  it("fails without a database URL or an auth secret", () => {
    const result = validateEnvValues({});
    expect(result.env).toBeNull();
    expect(result.errors.some((e) => e.startsWith("DATABASE_URL"))).toBe(true);
    expect(result.errors.some((e) => e.startsWith("AUTH_SECRET or NEXTAUTH_SECRET"))).toBe(true);
  });

  it("rejects weak secrets", () => {
    const result = validateEnvValues({ ...base, AUTH_SECRET: "super-secret-key-change-in-production" });
    expect(result.errors.some((e) => e.includes("AUTH_SECRET or NEXTAUTH_SECRET"))).toBe(true);
  });

  it("drops an invalid optional value with a warning instead of failing", () => {
    const result = validateEnvValues({ ...base, OPENALEX_EMAIL: "not-an-email", DECEASED_CLAUDE_SEARCH: "maybe" });
    expect(result.errors).toEqual([]);
    expect(result.env?.OPENALEX_EMAIL).toBeUndefined();
    expect(result.warnings.some((w) => w.startsWith("OPENALEX_EMAIL"))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("DECEASED_CLAUDE_SEARCH"))).toBe(true);
  });

  it("trims stray whitespace and newlines in values", () => {
    const result = validateEnvValues({ ...base, AUTH_TRUST_HOST: "true\n", STORAGE_PROVIDER: "supabase\n" });
    expect(result.warnings.some((w) => w.startsWith("AUTH_TRUST_HOST") || w.startsWith("STORAGE_PROVIDER"))).toBe(false);
    expect(result.env?.STORAGE_PROVIDER).toBe("supabase");
  });

  it("accepts the docker-compose development defaults", () => {
    const result = validateEnvValues({
      DATABASE_URL: "postgresql://postgres:postgres@db:5432/publimentor?schema=public",
      NEXTAUTH_SECRET: "local-dev-only-0123456789abcdef",
      NEXTAUTH_URL: "http://localhost:3000",
      AUTH_TRUST_HOST: "true",
      OPENALEX_EMAIL: "",
    });
    expect(result.errors).toEqual([]);
  });
});
