import type { NextConfig } from "next";
import { execSync } from "child_process";

function git(cmd: string): string | null {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

// Resolve git SHA: explicit env → local git → Vercel env → fallback
const GIT_SHA =
  process.env.NEXT_PUBLIC_BUILD_VERSION ||
  git("rev-parse --short HEAD") ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  "dev";

// Resolve commit date: explicit env → local git → build time
const GIT_DATE =
  process.env.NEXT_PUBLIC_BUILD_TIME ||
  git("log -1 --format=%cI") ||
  new Date().toISOString();

const nextConfig: NextConfig = {
  // Inject git commit hash and last-commit timestamp at build time
  env: {
    NEXT_PUBLIC_BUILD_VERSION: GIT_SHA,
    NEXT_PUBLIC_BUILD_TIME: GIT_DATE,
  },

  // Enable standalone output for Docker; skip on Vercel (uses its own builder)
  output: process.env.VERCEL ? undefined : "standalone",
  
  // Mark pdf-parse as external to avoid bundling issues
  serverExternalPackages: ["pdf-parse"],
  
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
  
  // Ignore canvas warnings from pdf-parse
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ignore optional dependencies that aren't needed
      config.externals.push({
        canvas: "commonjs canvas",
        "@napi-rs/canvas": "commonjs @napi-rs/canvas",
      });
    }
    return config;
  },
};

export default nextConfig;
