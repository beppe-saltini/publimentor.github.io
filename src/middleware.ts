import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

// Security headers to add to all responses
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

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

// Routes that should be rate limited strictly
const RATE_LIMITED_ROUTES = [
  "/api/auth/register",
  "/api/auth/callback",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Add security headers to all responses
  const response = NextResponse.next();
  
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(header, value);
  }
  
  // Add CSP header (more permissive for development)
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://api.anthropic.com https://api.openalex.org https://api.semanticscholar.org https://eutils.ncbi.nlm.nih.gov https://pub.orcid.org",
    "frame-ancestors 'none'",
  ];
  response.headers.set("Content-Security-Policy", cspDirectives.join("; "));
  
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
