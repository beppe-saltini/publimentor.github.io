/**
 * Edge-compatible security headers module.
 * 
 * Separated from security.ts because that module imports Node.js `crypto`
 * which is not available in Edge Runtime (used by middleware).
 */
import { NextResponse } from "next/server";

/**
 * Security headers applied to all responses via middleware.
 *
 * CSP policy allows 'unsafe-inline' for scripts because Next.js
 * hydration requires it. 'unsafe-eval' is only allowed in development
 * for Turbopack hot-reload — it is stripped automatically
 * in production builds.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co https://api.anthropic.com https://api.openalex.org https://api.semanticscholar.org https://eutils.ncbi.nlm.nih.gov https://pub.orcid.org",
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
