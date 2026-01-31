import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "./prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
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

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.password) {
          return null;
        }

        const isPasswordValid = await compare(password, user.password);

        if (!isPasswordValid) {
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
          // ORCID returns user info in the token response
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
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
      }
      if (account?.provider === "orcid") {
        // Store ORCID in the token
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
  },
});
