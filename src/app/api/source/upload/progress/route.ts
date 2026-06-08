import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  getUploadProgress,
  initUploadProgress,
  setUploadProgressPhase,
} from '@/service/sourceUploadProgress';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await getSessionUsrId())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get('id')?.trim() ?? '';
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  const progress = getUploadProgress(id);
  if (!progress) {
    return NextResponse.json({ error: 'not found', progressId: id }, { status: 404 });
  }
  return NextResponse.json(progress);
}

/** UI에서 heavy job 시작 전 progressId 선등록 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUsrId())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const progressId = typeof body.progressId === 'string' ? body.progressId.trim() : '';
  if (!progressId) {
    return NextResponse.json({ error: 'progressId required' }, { status: 400 });
  }
  initUploadProgress(progressId);
  setUploadProgressPhase(progressId, 'scan', '업로드 작업 대기 중...', { progressPct: 4 });
  return NextResponse.json({ ok: true, progressId });
}
