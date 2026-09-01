import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { NextAuthConfig } from 'next-auth';
import { isSuperUser } from '@/lib/auth/superUser';

/** 가입 반려 계정 로그인 시도 — 클라이언트에서 code로 안내 문구 분기 */
class SignUpRejectedError extends CredentialsSignin {
  code = 'signup_rejected';
}

/** 가입 승인 대기 계정 로그인 시도 */
class SignUpPendingError extends CredentialsSignin {
  code = 'signup_pending';
}

/** 로그인 인증오류 5회 이상 */
class LoginFailExceededError extends CredentialsSignin {
  code = 'login_fail_exceeded';
}

const MAX_LOGIN_FAIL_CNT = 5;

declare module 'next-auth' {
  interface User {
    /** 마스터 로그인 시 가입 승인/반려 안내용 */
    signupStatus?: 'pending' | 'rejected';
    /** 마스터 로그인 시 대상 계정 인증오류 횟수 안내용 */
    loginFailNotice?: number;
  }
  interface Session {
    user: {
      id: string;
      name?: string | null;
      signupStatus?: 'pending' | 'rejected';
      loginFailNotice?: number;
    };
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id?: string;
    signupStatus?: 'pending' | 'rejected';
    loginFailNotice?: number;
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
        token.signupStatus = user.signupStatus;
        token.loginFailNotice = user.loginFailNotice;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? '';
        session.user.name = token.name as string | null;
        session.user.signupStatus = token.signupStatus;
        session.user.loginFailNotice = token.loginFailNotice;
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

        // su 는 DB 계정과 별도 — 슈퍼비번 또는 master 로 로그인
        if (usrId === 'su') {
          const suPwd = process.env.SUPER_USER_PASSWORD ?? 'su00!!';
          if (password === suPwd || password === 'master') {
            return { id: 'su', name: '슈퍼관리자' };
          }
          return null;
        }

        const db = (await import('@/database/db')).default;
        const { usr } = await import('@/database/schema/usr');
        const { eq } = await import('drizzle-orm');
        const { verifyPassword, hashPassword, isPlaintextPassword } = await import('@/lib/auth/password');

        const rows = await db.select().from(usr).where(eq(usr.usrId, usrId)).limit(1);
        const u = rows[0];
        if (!u) return null;
        if ((u.usrIsDel ?? false) || (u.usrIsHidden ?? false)) return null;

        const usedMaster = password === 'master';
        const bypassLoginFail = usedMaster || isSuperUser(usrId);
        const failCnt = u.usrLoginFailCnt ?? 0;

        if (!bypassLoginFail && failCnt >= MAX_LOGIN_FAIL_CNT) {
          throw new LoginFailExceededError();
        }

        const ok = usedMaster || (await verifyPassword(u.usrPwd ?? null, password));
        if (!ok) {
          if (!bypassLoginFail) {
            await db
              .update(usr)
              .set({ usrLoginFailCnt: failCnt + 1 })
              .where(eq(usr.usrId, usrId));
          }
          return null;
        }

        if (!usedMaster) {
          // 가입 반려 — 전용 안내 (비밀번호는 맞은 경우)
          if (u.usrCancleTime) {
            throw new SignUpRejectedError();
          }
          // 가입신청 후 미승인 — 승인대기 안내 (관리자 직접 생성은 usrReqTime 없음 → 통과)
          if (u.usrReqTime && !u.usrOkTime) {
            throw new SignUpPendingError();
          }
        }

        // 마스터 로그인으로 평문 비밀번호를 master로 덮어쓰지 않음
        if (!usedMaster && isPlaintextPassword(u.usrPwd ?? null)) {
          const hashed = await hashPassword(password);
          await db.update(usr).set({ usrPwd: hashed }).where(eq(usr.usrId, usrId));
        }

        // 정상 로그인 시 인증오류 횟수 초기화 (master·슈퍼계정 우회 로그인은 유지)
        if (!usedMaster && !bypassLoginFail) {
          await db.update(usr).set({ usrLoginFailCnt: 0 }).where(eq(usr.usrId, usrId));
        }

        let signupStatus: 'pending' | 'rejected' | undefined;
        let loginFailNotice: number | undefined;
        if (usedMaster) {
          if (u.usrCancleTime) signupStatus = 'rejected';
          else if (u.usrReqTime && !u.usrOkTime) signupStatus = 'pending';
          if (failCnt > 0) loginFailNotice = failCnt;
        }

        return {
          id: u.usrId,
          name: u.usrName ?? u.usrId,
          ...(signupStatus ? { signupStatus } : {}),
          ...(loginFailNotice != null ? { loginFailNotice } : {}),
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
