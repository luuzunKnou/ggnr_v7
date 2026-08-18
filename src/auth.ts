import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { NextAuthConfig } from 'next-auth';

/** 가입 반려 계정 로그인 시도 — 클라이언트에서 code로 안내 문구 분기 */
class SignUpRejectedError extends CredentialsSignin {
  code = 'signup_rejected';
}

/** 가입 승인 대기 계정 로그인 시도 */
class SignUpPendingError extends CredentialsSignin {
  code = 'signup_pending';
}

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
    'ggnr-dev-auth-secret-change-me',
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

        // 가입 반려 — 전용 안내 (비밀번호는 맞은 경우)
        if (u.usrCancleTime) {
          throw new SignUpRejectedError();
        }
        // 가입신청 후 미승인 — 승인대기 안내 (관리자 직접 생성은 usrReqTime 없음 → 통과)
        if (u.usrReqTime && !u.usrOkTime) {
          throw new SignUpPendingError();
        }

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
  events: {
    async signIn({ user }) {
      const loginUser = String(user?.id ?? '').trim();
      if (!loginUser) return;
      try {
        // Edge(middleware→auth) 번들에 fs/os 안 타게: normalize는 순수 모듈, 로그는 동적 import
        const { headers } = await import('next/headers');
        const { normalizeClientIp } = await import('@/lib/normalizeClientIp');
        const h = await headers();
        const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
        const real = h.get('x-real-ip')?.trim();
        const loginIp = normalizeClientIp(forwarded || real) ?? null;
        const { recordLoginLog } = await import('@/service/loginLogRecord');
        await recordLoginLog({ loginUser, loginIp });
      } catch (e) {
        console.warn('[auth.signIn loginLog]', e instanceof Error ? e.message : e);
      }
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
