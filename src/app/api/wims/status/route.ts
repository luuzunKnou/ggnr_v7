import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { checkWimsStatus } from '@/lib/wimsOracle';

export const dynamic = 'force-dynamic';

export async function GET() {
  const usrId = await getSessionUsrId();
  if (!usrId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  try {
    const status = await checkWimsStatus();
    return NextResponse.json({
      /** WIMS_INFO 설정 여부 — 없으면 Oracle 시도 없음 */
      enabled: status.configured,
      connected: status.connected,
    });
  } catch (err) {
    // 상태 확인 실패도 서버를 죽이지 않고 연결 불가로 응답
    console.error('[wims/status]', err instanceof Error ? err.message : err);
    return NextResponse.json({
      enabled: true,
      connected: false,
    });
  }
}
