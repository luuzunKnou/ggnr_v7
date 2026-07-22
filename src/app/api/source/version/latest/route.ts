import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { readLatestSourceVersion, publicLatestResponse } from '@/service/sourceVersionRegistryService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const meta = await readLatestSourceVersion();
    if (!meta) {
      return NextResponse.json({ error: '최신 소스 없음 — 업로드를 먼저 하세요' }, { status: 404 });
    }
    return NextResponse.json(publicLatestResponse(meta));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'latest query failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
