import { NextRequest, NextResponse } from 'next/server';
import { readDxfText } from '@/service/digitalMapService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/digitalMap/dxf?folder=…&file=….dxf — 수치지형도 도엽 본문
 */
export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get('folder') ?? '';
  const file = req.nextUrl.searchParams.get('file') ?? '';
  if (!folder || !file) {
    return NextResponse.json({ error: 'folder·file 이 필요합니다.' }, { status: 400 });
  }

  try {
    const dxfText = await readDxfText(folder, file);
    return new NextResponse(dxfText, {
      status: 200,
      headers: {
        'Content-Type': 'application/dxf; charset=utf-8',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /없|올바르지|허용/.test(msg) ? 404 : 500;
    console.error('[digitalMap/dxf]', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
