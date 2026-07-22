import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  getInstallZipProgress,
  initInstallZipProgress,
  setInstallZipPhase,
} from '@/service/sourceInstallZipProgress';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const progress = getInstallZipProgress(id);
    if (!progress) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(progress);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'progress failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** UI에서 ZIP build 시작 전 progressId 선등록 */
export async function POST(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const progressId = typeof body.progressId === 'string' ? body.progressId.trim() : '';
    if (!progressId) {
      return NextResponse.json({ error: 'progressId required' }, { status: 400 });
    }
    initInstallZipProgress(progressId);
    setInstallZipPhase(progressId, 'idle', 'ZIP 생성 대기 중...', { progressPct: 2 });
    return NextResponse.json({ ok: true, progressId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'progress register failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
