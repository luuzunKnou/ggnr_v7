import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getLatestAppliedVersion } from '@/service/mngVersionHistoryService';

export const dynamic = 'force-dynamic';

/** 이 서버에 마지막으로 성공 적용된 버전 */
export async function GET() {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await getLatestAppliedVersion();
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? '조회 실패' }, { status: 500 });
    }
    return NextResponse.json({ version: result.version });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'applied version query failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
