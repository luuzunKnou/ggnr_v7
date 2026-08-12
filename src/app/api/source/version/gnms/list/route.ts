import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { fetchGnmsVersionListFromServer } from '@/service/gnmsSourceFetchService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await fetchGnmsVersionListFromServer();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'GNMS 목록 조회 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
