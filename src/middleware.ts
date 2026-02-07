import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { SECURITY_HEADERS, addSecurityHeaders } from "@/lib/security";

// Routes that require authentication
const PROTECTED_ROUTES = [
  "/dashboard",
  "/api/manuscripts",
  "/api/publishers",
  "/api/journals",
  "/api/reviewers",
  "/api/coi",
  "/api/integrity",
  "/api/files",
];

/**
 * Allowed CORS origins — only explicit, validated URLs are accepted.
 * SECURITY: We validate that NEXTAUTH_URL is a proper origin (scheme + host)
 * and reject wildcards or overly broad values.
 */
function buildCorsOrigins(): Set<string> {
  const origins: string[] = [];

  // Always allow localhost in development
  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000");
  }

  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (nextAuthUrl) {
    try {
      const parsed = new URL(nextAuthUrl);
      // Only allow http(s) origins; strip trailing path
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        origins.push(parsed.origin);
      } else {
        console.warn("[CORS] NEXTAUTH_URL has unsupported protocol, ignoring:", parsed.protocol);
      }
    } catch {
      console.warn("[CORS] NEXTAUTH_URL is not a valid URL, ignoring");
    }
  }

  return new Set(origins);
}

const CORS_ORIGINS = buildCorsOrigins();

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // --- CORS preflight ---
  if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin") || "";
    const response = new NextResponse(null, { status: 204 });
    
    if (CORS_ORIGINS.has(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-request-id");
      response.headers.set("Access-Control-Max-Age", "86400");
    }
    return response;
  }

  // Add security headers to all responses (single source of truth)
  const response = NextResponse.next();
  addSecurityHeaders(response);

  // --- CORS headers for API responses ---
  if (pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin") || "";
    if (CORS_ORIGINS.has(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Credentials", "true");
    }
  }
  
  // Check authentication for protected routes
  const isProtectedRoute = PROTECTED_ROUTES.some((route) => 
    pathname.startsWith(route)
  );
  
  if (isProtectedRoute) {
    const session = await auth();
    
    if (!session?.user) {
      // For API routes, return 401
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401, headers: response.headers }
        );
      }
      
      // For pages, redirect to login
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }
  
  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files, Next.js internals, and auth routes
    "/((?!_next/static|_next/image|favicon.ico|logo.png|api/auth).*)",
  ],
};
