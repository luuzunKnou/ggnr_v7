import { db } from '@/database/db';
import { loginLog } from '@/database/schema/login_log';
import { normalizeClientIp } from '@/lib/normalizeClientIp';

/**
 * 로그인 성공 기록 전용.
 * auth/middleware(Edge)에서 동적 import 되므로 guard·configService·requestClientMeta(os)를 넣지 않는다.
 */
export async function recordLoginLog(params: {
  loginUser: string;
  loginIp?: string | null;
}): Promise<{ ok: boolean; llKey?: number }> {
  const loginUser = String(params.loginUser ?? '').trim();
  if (!loginUser) return { ok: false };
  try {
    const [row] = await db
      .insert(loginLog)
      .values({
        loginUser,
        loginIp: normalizeClientIp(params.loginIp) ?? null,
        loginTime: new Date().toISOString(),
      })
      .returning({ llKey: loginLog.llKey });
    return { ok: true, llKey: row?.llKey };
  } catch (e) {
    console.warn('[recordLoginLog]', e instanceof Error ? e.message : e);
    return { ok: false };
  }
}
