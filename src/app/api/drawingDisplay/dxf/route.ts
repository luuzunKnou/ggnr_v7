import { NextRequest, NextResponse } from 'next/server';
import { readDxfTextById } from '@/service/drawingDisplayService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/drawingDisplay/dxf?id=… — 저장된 도면 DXF 본문
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!id) {
    return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  }

  try {
    const dxfText = await readDxfTextById(id);
    return new NextResponse(dxfText, {
      status: 200,
      headers: {
        'Content-Type': 'application/dxf; charset=utf-8',
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /없|올바르지|로그인|세션/.test(msg) ? 404 : 500;
    console.error('[drawingDisplay/dxf]', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
