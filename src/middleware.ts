import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig, PROTECTED_ROUTES } from "@/lib/auth.config";
import { addSecurityHeaders } from "@/lib/security-headers";

/**
 * Edge-compatible middleware.
 *
 * Uses authConfig (not auth.ts) to avoid pulling Node.js-only
 * dependencies (Prisma, bcryptjs, crypto) into the Edge Runtime.
 * The NextAuth `authorized` callback in authConfig handles the
 * actual auth gate; this wrapper adds security headers and CORS.
 */

const { auth } = NextAuth(authConfig);

/**
 * Allowed CORS origins — only explicit, validated URLs are accepted.
 */
function buildCorsOrigins(): Set<string> {
  const origins: string[] = [];

  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000");
  }

  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (nextAuthUrl) {
    try {
      const parsed = new URL(nextAuthUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        origins.push(parsed.origin);
      }
    } catch {
      // ignore invalid URL
    }
  }

  return new Set(origins);
}

const CORS_ORIGINS = buildCorsOrigins();

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // --- CORS preflight ---
  if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
    const origin = req.headers.get("origin") || "";
    const response = new NextResponse(null, { status: 204 });

    if (CORS_ORIGINS.has(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-request-id");
      response.headers.set("Access-Control-Max-Age", "86400");
    }
    return response;
  }

  // Build response with security headers
  const response = NextResponse.next();
  addSecurityHeaders(response);

  // --- CORS headers for API responses ---
  if (pathname.startsWith("/api/")) {
    const origin = req.headers.get("origin") || "";
    if (CORS_ORIGINS.has(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Credentials", "true");
    }
  }

  // Auth gating is handled by the `authorized` callback in authConfig.
  // If the user is not logged in on a protected route, NextAuth returns
  // a redirect to the signIn page automatically.

  return response;
});

export const config = {
  matcher: [
    // Match all routes except static files, Next.js internals, auth routes,
    // and the manuscript upload endpoint (which has its own auth and needs to
    // bypass Edge Runtime body-size limitations for large file uploads).
    "/((?!_next/static|_next/image|favicon.ico|logo.png|api/auth|api/manuscripts/upload|api/manuscripts/[^/]+/process).*)",
  ],
};
