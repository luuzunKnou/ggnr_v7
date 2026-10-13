import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getPreparedSourceZip } from '@/service/sourceUploadPreparedZip';

export const dynamic = 'force-dynamic';

/** 브라우저 → GNMS 청크용: 로컬 준비 ZIP 바이트 구간 */
export async function GET(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const progressId = req.nextUrl.searchParams.get('progressId')?.trim() ?? '';
    const offset = Number(req.nextUrl.searchParams.get('offset') ?? '0');
    const length = Number(req.nextUrl.searchParams.get('length') ?? '0');
    if (!progressId) {
      return NextResponse.json({ error: 'progressId required' }, { status: 400 });
    }
    const meta = getPreparedSourceZip(progressId);
    if (!meta) {
      return NextResponse.json({ error: '준비된 ZIP이 없습니다' }, { status: 404 });
    }
    if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(length) || length <= 0) {
      return NextResponse.json({ error: 'offset/length invalid' }, { status: 400 });
    }
    const want = Math.min(length, Math.max(0, meta.zipSize - offset));
    if (want <= 0) {
      return new NextResponse(new Uint8Array(0), {
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '0' },
      });
    }
    const fh = await fs.open(meta.zipPath, 'r');
    try {
      const buf = Buffer.alloc(want);
      const { bytesRead } = await fh.read(buf, 0, want, offset);
      const body = bytesRead === want ? buf : buf.subarray(0, bytesRead);
      return new NextResponse(body, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(body.byteLength),
          'Cache-Control': 'no-store',
        },
      });
    } finally {
      await fh.close();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'prepared zip read failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
