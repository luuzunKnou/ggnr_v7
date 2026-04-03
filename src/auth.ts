import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { NextAuthConfig } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: { id: string; name?: string | null };
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id?: string;
  }
}

export const authConfig = {
  trustHost: true,
  secret:
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV === 'development' ? 'ggnr-dev-auth-secret-change-me' : undefined),
  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },
  pages: { signIn: '/' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? '';
        session.user.name = token.name as string | null;
      }
      return session;
    },
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        usrId: { label: '아이디' },
        password: { label: '비밀번호', type: 'password' },
      },
      authorize: async (credentials) => {
        const usrId = typeof credentials?.usrId === 'string' ? credentials.usrId.trim() : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!usrId || !password) return null;

        if (
          usrId === 'su' &&
          password === (process.env.SUPER_USER_PASSWORD ?? 'su00!!')
        ) {
          return { id: 'su', name: '슈퍼관리자' };
        }

        const db = (await import('@/database/db')).default;
        const { usr } = await import('@/database/schema/usr');
        const { eq } = await import('drizzle-orm');
        const { verifyPassword, hashPassword, isPlaintextPassword } = await import('@/lib/auth/password');

        const rows = await db.select().from(usr).where(eq(usr.usrId, usrId)).limit(1);
        const u = rows[0];
        if (!u) return null;
        if ((u.usrIsDel ?? false) || (u.usrIsHidden ?? false)) return null;

        const ok = await verifyPassword(u.usrPwd ?? null, password);
        if (!ok) return null;

        if (isPlaintextPassword(u.usrPwd ?? null)) {
          const hashed = await hashPassword(password);
          await db.update(usr).set({ usrPwd: hashed }).where(eq(usr.usrId, usrId));
        }

        return {
          id: u.usrId,
          name: u.usrName ?? u.usrId,
        };
      },
    }),
  ],
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
