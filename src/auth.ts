import "server-only";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { db } from "@/lib/db";
import { getClientIp, hashIdentifier, rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validations/auth";

// Compared against when the user does not exist, so response timing does not
// reveal which emails are registered.
const DUMMY_HASH = "$2b$12$yAqHVRbfGlhaz1gGNwfhguG.jKao.UEfyUzbifJ6KfHNevN7tx.oC";

export const LOGIN_RATE_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 } as const;

// Second, IP-independent counter on the account itself. The per-IP limiter above caps one source;
// without this an attacker rotating source addresses gets a fresh 5 attempts each against a known
// address, which is the realistic shape of a password-spraying attempt. Wider window, higher
// ceiling, so a single user on a changing network is not locked out by their own retries.
export const LOGIN_ACCOUNT_RATE_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 } as const;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const limiterKey = `login:${hashIdentifier(`${await getClientIp()}:${email}`)}`;
        const accountLimiterKey = `login:account:${hashIdentifier(email)}`;
        const [limit, accountLimit] = await Promise.all([
          rateLimit(limiterKey, LOGIN_RATE_LIMIT),
          rateLimit(accountLimiterKey, LOGIN_ACCOUNT_RATE_LIMIT),
        ]);
        if (!limit.success || !accountLimit.success) return null;

        const user = await db.user.findUnique({ where: { email } });
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) return null;

        // Both counters clear on success. rateLimit() increments on every attempt, including
        // successful ones, so leaving the account counter to accumulate would let a shared or
        // busy account lock itself out through legitimate logins with no in-app remedy. An
        // attacker who could trigger this reset already knows the password, at which point the
        // limiter is moot — so the trade costs nothing real and removes a denial-of-service.
        await Promise.all([resetRateLimit(limiterKey), resetRateLimit(accountLimiterKey)]);
        await db.$transaction([
          db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
          db.activityLog.create({
            data: { userId: user.id, action: "LOGIN", entity: "User", entityId: user.id, summary: "Signed in" },
          }),
        ]);

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
});
