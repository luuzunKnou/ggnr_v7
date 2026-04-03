import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { completeChunkedUpload } from '@/service/uploadService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
    }
    const o = body as Record<string, unknown>;
    const uploadId = typeof o.uploadId === 'string' ? o.uploadId.trim() : '';
    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId 가 필요합니다.' }, { status: 400 });
    }
    const result = await completeChunkedUpload({ uploadId });
    return NextResponse.json({ savedPath: result.savedPath, size: result.size });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Complete failed';
    const status = message === 'Forbidden' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
