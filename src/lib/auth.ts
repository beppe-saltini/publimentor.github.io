import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "./prisma";
import { checkRateLimit, AUTH_RATE_LIMIT, auditLog } from "./security";
import { authConfig } from "./auth.config";

/**
 * Full NextAuth configuration (Node.js runtime only).
 *
 * This file extends the Edge-compatible authConfig with providers
 * and adapter that require Node.js APIs (Prisma, bcryptjs, etc.).
 * 
 * Middleware must NOT import this file — use auth.config.ts instead.
 */

/**
 * Pre-computed bcrypt hash used when a user is not found.
 * Comparing against this dummy hash ensures constant-time behavior
 * so attackers cannot enumerate valid emails via response timing.
 */
const DUMMY_PASSWORD_HASH = "$2a$12$000000000000000000000uGH.Tml5jNYC0pCAZGIBx3BPP/U0Fxm";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = (credentials.email as string).toLowerCase().trim();
        const password = credentials.password as string;

        // SECURITY: Rate limit login attempts per email to prevent brute-force
        const rateLimitKey = `login:${email}`;
        const rateLimit = checkRateLimit(rateLimitKey, AUTH_RATE_LIMIT);
        if (!rateLimit.allowed) {
          auditLog({
            userId: null,
            action: "LOGIN_RATE_LIMIT_EXCEEDED",
            resource: "auth",
            resourceId: email,
            ip: "unknown",
            userAgent: "unknown",
            severity: "warning",
          });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        // SECURITY: Always run bcrypt compare to prevent timing-based
        // user enumeration. If the user doesn't exist, compare against
        // a dummy hash so the response time is indistinguishable.
        const hashToCompare = user?.password || DUMMY_PASSWORD_HASH;
        const isPasswordValid = await compare(password, hashToCompare);

        if (!user || !user.password || !isPasswordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    // ORCID OAuth provider
    {
      id: "orcid",
      name: "ORCID",
      type: "oauth",
      authorization: {
        url: "https://orcid.org/oauth/authorize",
        params: { scope: "/authenticate" },
      },
      token: "https://orcid.org/oauth/token",
      userinfo: {
        url: "https://orcid.org/oauth/userinfo",
        async request({ tokens, provider }: { tokens: { access_token?: string }; provider: { userinfo?: { url: string } } }) {
          const response = await fetch(provider.userinfo?.url as string, {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              Accept: "application/json",
            },
          });
          return await response.json();
        },
      },
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name || profile.given_name,
          email: profile.email,
          orcid: profile.sub,
        };
      },
      clientId: process.env.ORCID_CLIENT_ID,
      clientSecret: process.env.ORCID_CLIENT_SECRET,
    },
  ],
});

export { isSuperuser } from "./superuser";
