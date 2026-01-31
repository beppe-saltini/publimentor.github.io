/**
 * Security Utilities
 * Centralized security functions for the application
 */

import { NextResponse } from "next/server";
import crypto from "crypto";

// ============================================================
// Rate Limiting (In-Memory - use Redis in production)
// ============================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number;  // Max requests per window
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

export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const key = `${identifier}`;
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetTime) {
    // First request or window expired
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return { allowed: true, remaining: config.maxRequests - 1, resetIn: config.windowMs };
  }

  if (entry.count >= config.maxRequests) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetIn: entry.resetTime - now 
    };
  }

  entry.count++;
  return { 
    allowed: true, 
    remaining: config.maxRequests - entry.count, 
    resetIn: entry.resetTime - now 
  };
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

export { DEFAULT_RATE_LIMIT, STRICT_RATE_LIMIT, AUTH_RATE_LIMIT };

// ============================================================
// Input Sanitization
// ============================================================

/**
 * Sanitize string input to prevent XSS
 * Removes HTML tags and dangerous characters
 */
export function sanitizeString(input: string): string {
  if (typeof input !== "string") return "";
  
  return input
    // Remove HTML tags
    .replace(/<[^>]*>/g, "")
    // Remove script-related patterns
    .replace(/javascript:/gi, "")
    .replace(/on\w+=/gi, "")
    // Encode potentially dangerous characters
    .replace(/[<>'"]/g, (char) => {
      const entities: Record<string, string> = {
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      };
      return entities[char] || char;
    })
    .trim();
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
  const path = require("path");
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

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Needed for Next.js
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://api.anthropic.com https://api.openalex.org https://api.semanticscholar.org https://eutils.ncbi.nlm.nih.gov",
    "frame-ancestors 'none'",
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
