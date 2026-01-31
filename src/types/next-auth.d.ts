import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      orcid?: string | null;
    };
  }

  interface User {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    orcid?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    orcid?: string;
  }
}
