/**
 * Vitest global test setup
 */

// Set test environment variables
// NODE_ENV is readonly in newer @types/node; cast to bypass for test setup
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/publimentor_test";
process.env.NEXTAUTH_SECRET = "test-secret-at-least-16-chars-long";
process.env.NEXTAUTH_URL = "http://localhost:3000";
