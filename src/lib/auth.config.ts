import type { NextAuthConfig } from "next-auth";

/**
 * Edge-compatible NextAuth configuration.
 *
 * This file is imported by middleware.ts which runs in Edge Runtime.
 * It MUST NOT import any Node.js-only modules (crypto, bcryptjs,
 * PrismaClient, ioredis, etc.).
 *
 * The full auth config (with Prisma adapter, Credentials provider,
 * rate-limiting) lives in auth.ts and extends this config.
 */

// Routes that require authentication — shared with middleware
export const PROTECTED_ROUTES = [
  "/dashboard",
  "/api/manuscripts",
  "/api/publishers",
  "/api/journals",
  "/api/reviewers",
  "/api/coi",
  "/api/integrity",
  "/api/files",
  "/api/user",
  "/api/editor",
];

export const authConfig: NextAuthConfig = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
      }
      if (account?.provider === "orcid") {
        token.orcid = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        if (token.orcid) {
          (session.user as { orcid?: string }).orcid = token.orcid as string;
        }
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isProtected = PROTECTED_ROUTES.some((route) =>
        nextUrl.pathname.startsWith(route)
      );

      if (isProtected && !isLoggedIn) {
        // For API routes return false (results in 401); for pages redirect to login
        return false;
      }

      return true;
    },
  },
  // Providers are set to [] here; the full list (Credentials, ORCID)
  // is added in auth.ts which can import Node.js-only libraries.
  providers: [],
};
