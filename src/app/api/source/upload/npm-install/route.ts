import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { runPendingSourceBundleNpmInstall } from '@/service/sourceUploadBundleService';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

/** 병합/압축 해제 완료 후 원격 npm install (소스 업로드 2단계) */
export async function POST(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await req.json()) as Record<string, unknown>;
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : '';
    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId 가 필요합니다.' }, { status: 400 });
    }

    const npmInstall = await runPendingSourceBundleNpmInstall({ uploadId });
    return NextResponse.json({ ok: true, npmInstall });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'npm install failed';
    const status = message === 'Forbidden' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
