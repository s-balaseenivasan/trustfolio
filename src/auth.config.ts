import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/generated/prisma/enums";

/**
 * Provider-free config consumed by `auth.ts`. It supplies `pages`, `session` and the jwt/session
 * callbacks.
 *
 * `proxy.ts` does NOT import this file — it performs its own session-cookie presence check to
 * provide a fast redirect, and authorization is enforced server-side in every admin page and
 * action regardless. There is deliberately no `authorized` callback here: nothing wires this
 * config into middleware, so one would be dead code implying protection that does not exist.
 */
export const authConfig = {
  pages: {
    signIn: "/admin/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8, // 8 hours
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.user.role = (token.role as Role | undefined) ?? "EDITOR";
      return session;
    },
  },
} satisfies NextAuthConfig;
