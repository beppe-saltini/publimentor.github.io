import type { NextConfig } from "next";

const nextConfig: NextConfig = {

  // Enable standalone output for Docker; skip on Vercel (uses its own builder)
  output: process.env.VERCEL ? undefined : "standalone",
  
  // Mark unpdf as external to avoid bundling issues in serverless
  serverExternalPackages: ["unpdf"],
  
  // Empty turbopack config to silence warning
  turbopack: {},
  
  // Security headers
  async headers() {
    return [
      {
        // Apply to all routes
        source: "/:path*",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
      {
        // API routes - prevent caching of sensitive data
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
          {
            key: "Expires",
            value: "0",
          },
        ],
      },
    ];
  },
  
  // Powered by header (hide Next.js version)
  poweredByHeader: false,
  
  // No custom webpack config needed — unpdf handles its own bundling
};

export default nextConfig;
