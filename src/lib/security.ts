/**
 * Security Utilities
 * Centralized security functions for the application
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import path from "path";

// ============================================================
// Rate Limiting (Upstash/Vercel KV when configured, in-memory otherwise)
// ============================================================

export interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number;  // Max requests per window
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 60,  // 60 requests per minute
};

const STRICT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 10,  // For sensitive endpoints
};

const AUTH_RATE_LIMIT: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 5,  // 5 attempts per 15 minutes
};

/** Per-email registration limit (beta-friendly; avoids shared-IP false blocks) */
const REGISTER_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 10,
};

/** Broad IP cap to catch scripted mass signups without blocking normal beta testers */
const REGISTER_IP_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 30,
};

/**
 * Rate limit store interface — implemented by the in-memory and Upstash stores.
 */
export interface RateLimitStore {
  check(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
}

/**
 * In-memory fixed-window store. Only meaningful on a single long-lived process:
 * on Vercel every lambda instance has its own map, so it is the fallback, not the
 * production limiter.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, { count: number; resetTime: number }>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    // Don't prevent process exit
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  async check(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetTime) {
      this.store.set(key, { count: 1, resetTime: now + config.windowMs });
      return { allowed: true, remaining: config.maxRequests - 1, resetIn: config.windowMs };
    }

    if (entry.count >= config.maxRequests) {
      return { allowed: false, remaining: 0, resetIn: entry.resetTime - now };
    }

    entry.count++;
    return { allowed: true, remaining: config.maxRequests - entry.count, resetIn: entry.resetTime - now };
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.resetTime) this.store.delete(key);
    }
  }
}

export interface UpstashRestConfig {
  url: string;
  token: string;
}

/**
 * Fixed-window counter on an Upstash Redis database, reached over its REST API so
 * no Redis client library or persistent connection is needed in a serverless
 * function. One pipeline call per check: INCR the key, set its expiry on first
 * use, read the remaining TTL. Shared by every lambda instance, so login and
 * registration limits hold across the whole deployment.
 *
 * If Upstash is unreachable the check falls back to the in-memory store (fail
 * closed for the current instance) rather than allowing everything through.
 */
export class UpstashRateLimitStore implements RateLimitStore {
  private fallback = new InMemoryRateLimitStore();
  private readonly endpoint: string;

  constructor(private readonly upstash: UpstashRestConfig, private readonly fetchImpl: typeof fetch = fetch) {
    this.endpoint = `${upstash.url.replace(/\/$/, "")}/pipeline`;
  }

  async check(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.upstash.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          ["INCR", redisKey],
          ["PEXPIRE", redisKey, String(config.windowMs), "NX"],
          ["PTTL", redisKey],
        ]),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        throw new Error(`Upstash responded ${response.status}`);
      }
      const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
      const failed = results.find((r) => r.error);
      if (failed) throw new Error(failed.error);

      const count = Number(results[0]?.result ?? 0);
      const ttl = Number(results[2]?.result ?? -1);
      const resetIn = ttl > 0 ? ttl : config.windowMs;
      return {
        allowed: count <= config.maxRequests,
        remaining: Math.max(0, config.maxRequests - count),
        resetIn,
      };
    } catch (error) {
      console.warn("[RateLimit] Upstash unavailable, using in-memory limiter for this instance:", error instanceof Error ? error.message : error);
      return this.fallback.check(key, config);
    }
  }
}

/**
 * Upstash credentials from the environment. The Vercel Marketplace integration
 * injects KV_REST_API_URL/KV_REST_API_TOKEN; a database created on upstash.com
 * directly gives UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN.
 */
export function upstashConfigFromEnv(env: Record<string, string | undefined> = process.env): UpstashRestConfig | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

let _rateLimitStore: RateLimitStore | null = null;

function getRateLimitStore(): RateLimitStore {
  if (!_rateLimitStore) {
    const upstash = upstashConfigFromEnv();
    if (upstash) {
      console.log("[RateLimit] Using Upstash-backed rate limiting");
      _rateLimitStore = new UpstashRateLimitStore(upstash);
    } else {
      if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
        console.warn("[RateLimit] No Upstash credentials: limits are per lambda instance only");
      }
      _rateLimitStore = new InMemoryRateLimitStore();
    }
  }
  return _rateLimitStore;
}

/**
 * Rate limit check — shared across instances when Upstash is configured.
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT
): Promise<RateLimitResult> {
  return getRateLimitStore().check(identifier, config);
}

export function getRateLimitResponse(resetIn: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { 
      status: 429,
      headers: {
        "Retry-After": Math.ceil(resetIn / 1000).toString(),
      },
    }
  );
}

export {
  DEFAULT_RATE_LIMIT,
  STRICT_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  REGISTER_RATE_LIMIT,
  REGISTER_IP_RATE_LIMIT,
};

// ============================================================
// Input Sanitization
// ============================================================

/**
 * Sanitize string input to prevent XSS.
 * Removes HTML tags, dangerous URI schemes, event handlers, and
 * encodes residual special characters. Handles URL-encoded and
 * entity-encoded bypass attempts.
 */
export function sanitizeString(input: string): string {
  if (typeof input !== "string") return "";
  
  let sanitized = input;

  // Decode common URL-encoded characters that could bypass later filters
  // e.g. java%73cript: → javascript:
  sanitized = sanitized.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex) => {
    const charCode = parseInt(hex, 16);
    // Only decode printable ASCII to avoid introducing control chars
    if (charCode >= 0x20 && charCode <= 0x7E) {
      return String.fromCharCode(charCode);
    }
    return "";
  });

  // Remove null bytes (bypass technique)
  sanitized = sanitized.replace(/\0/g, "");

  // Remove HTML tags (including malformed / unclosed tags)
  sanitized = sanitized.replace(/<[^>]*>?/g, "");

  // Remove dangerous URI schemes (case-insensitive, with optional whitespace)
  sanitized = sanitized.replace(/\b(javascript|vbscript|data)\s*:/gi, "");

  // Remove event handler attributes (onclick=, onerror=, etc.)
  sanitized = sanitized.replace(/on[a-z]+\s*=/gi, "");

  // Encode potentially dangerous characters
  sanitized = sanitized.replace(/[<>'"&]/g, (char) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
      "&": "&amp;",
    };
    return entities[char] || char;
  });

  return sanitized.trim();
}

/**
 * Sanitize object recursively
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      sanitized[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === "string" ? sanitizeString(item) : item
      );
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized as T;
}

// ============================================================
// Path Security
// ============================================================

/**
 * Validate that a path is within a base directory (prevent path traversal)
 */
export function isPathWithinBase(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(basePath, targetPath);
  
  // Ensure the resolved path starts with the base path
  // and doesn't escape via symlinks or traversal
  return resolvedTarget.startsWith(resolvedBase + path.sep) || 
         resolvedTarget === resolvedBase;
}

/**
 * Sanitize filename to prevent directory traversal
 */
export function sanitizeFileName(fileName: string): string {
  return fileName
    // Remove path separators
    .replace(/[\/\\]/g, "_")
    // Remove null bytes
    .replace(/\0/g, "")
    // Remove other dangerous characters
    .replace(/[<>:"|?*]/g, "_")
    // Limit length
    .slice(0, 255);
}

// ============================================================
// File Security
// ============================================================

// Magic bytes for file type validation
const FILE_SIGNATURES: Record<string, Buffer[]> = {
  "application/pdf": [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    Buffer.from([0x50, 0x4B, 0x03, 0x04]), // PK.. (ZIP-based)
  ],
  "image/jpeg": [Buffer.from([0xFF, 0xD8, 0xFF])],
  "image/png": [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
};

/**
 * Validate file content matches expected MIME type
 */
export function validateFileType(
  buffer: Buffer, 
  expectedMimeType: string
): boolean {
  const signatures = FILE_SIGNATURES[expectedMimeType];
  
  if (!signatures) {
    // Unknown type - can't validate, allow but log warning
    console.warn(`[Security] Unknown MIME type for validation: ${expectedMimeType}`);
    return true;
  }
  
  return signatures.some((sig) =>
    buffer.slice(0, sig.length).equals(sig)
  );
}

/**
 * Get actual MIME type from file content
 */
export function detectMimeType(buffer: Buffer): string | null {
  for (const [mimeType, signatures] of Object.entries(FILE_SIGNATURES)) {
    if (signatures.some((sig) => buffer.slice(0, sig.length).equals(sig))) {
      return mimeType;
    }
  }
  return null;
}

// ============================================================
// Password Security
// ============================================================

export interface PasswordValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = [];
  
  if (password.length < 10) {
    errors.push("Password must be at least 10 characters long");
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }
  
  // Check for common patterns
  const commonPatterns = [
    /^password/i,
    /^123456/,
    /^qwerty/i,
    /(.)\1{3,}/,  // Same character repeated 4+ times
  ];
  
  if (commonPatterns.some((p) => p.test(password))) {
    errors.push("Password is too common or contains repeating patterns");
  }
  
  return { valid: errors.length === 0, errors };
}

// ============================================================
// Security Headers
// ============================================================

/**
 * Single source of truth for security headers.
 *
 * NOTE: Next.js App Router requires 'unsafe-inline' for script-src
 * and style-src at runtime due to inline hydration scripts.
 * For stricter CSP, configure nonce-based CSP via next.config.ts headers
 * or use a custom server. See: https://nextjs.org/docs/app/guides/content-security-policy
 *
 * The 'unsafe-eval' has been removed — it is NOT required by Next.js
 * in production builds. If you see CSP errors during development with
 * Turbopack, those are dev-only.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    // Next.js production: 'unsafe-inline' needed for hydration; 'unsafe-eval' removed
    process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" // Dev only (Turbopack)
      : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co https://api.anthropic.com https://api.openalex.org https://api.semanticscholar.org https://eutils.ncbi.nlm.nih.gov https://pub.orcid.org https://www.googleapis.com https://google.serper.dev https://api.search.brave.com https://html.duckduckgo.com https://dblp.org https://www.ebi.ac.uk",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

export function addSecurityHeaders(response: NextResponse): NextResponse {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(header, value);
  }
  return response;
}

// ============================================================
// Token Generation
// ============================================================

/**
 * Generate a cryptographically secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Generate a secure API key
 */
export function generateApiKey(): string {
  const prefix = "pm_";
  const token = crypto.randomBytes(24).toString("base64url");
  return `${prefix}${token}`;
}

// ============================================================
// Audit Logging
// ============================================================

export interface AuditLogEntry {
  timestamp: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string;
  ip: string;
  userAgent: string;
  details?: Record<string, unknown>;
  severity: "info" | "warning" | "critical";
}

/**
 * Log security-relevant actions
 * In production, this should write to a secure audit log system
 */
export function auditLog(entry: Omit<AuditLogEntry, "timestamp">): void {
  const logEntry: AuditLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  
  // In production, send to secure logging service (e.g., CloudWatch, Datadog)
  console.log(`[AUDIT] ${JSON.stringify(logEntry)}`);
}

// ============================================================
// Request Size Limits
// ============================================================

// Maximum request body sizes by endpoint type
export const REQUEST_SIZE_LIMITS = {
  default: 1024 * 1024, // 1MB
  upload: 50 * 1024 * 1024, // 50MB for file uploads
  json: 512 * 1024, // 512KB for JSON bodies
};

/**
 * Check if content-length exceeds limit
 */
export function checkContentLength(
  request: Request,
  maxBytes: number = REQUEST_SIZE_LIMITS.json
): { valid: boolean; size: number } {
  const contentLength = request.headers.get("content-length");
  const size = contentLength ? parseInt(contentLength, 10) : 0;
  
  return {
    valid: size <= maxBytes,
    size,
  };
}

// ============================================================
// Request Helpers
// ============================================================

/**
 * Get client IP from request headers
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }
  
  return "unknown";
}

/**
 * Get user agent from request
 */
export function getUserAgent(request: Request): string {
  return request.headers.get("user-agent") || "unknown";
}
