import { NextRequest, NextResponse } from 'next/server';
import { downloadMyLayerShp } from '@/service/myMapService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/myMap/download?tableName=... — 나의지도 SHP zip
 */
export async function GET(req: NextRequest) {
  const tableName = req.nextUrl.searchParams.get('tableName')?.trim() ?? '';
  if (!tableName) {
    return NextResponse.json({ error: 'tableName이 필요합니다.' }, { status: 400 });
  }
  try {
    const result = await downloadMyLayerShp({ tableName });
    if (!result.success || !result.zipBuffer) {
      return NextResponse.json({ error: result.error ?? '내보내기 실패' }, { status: 500 });
    }
    return new NextResponse(new Uint8Array(result.zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${tableName}.zip"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      typeof e === 'object' && e && 'status' in e && typeof (e as { status: unknown }).status === 'number'
        ? (e as { status: number }).status
        : /로그인|세션|인증/.test(msg)
          ? 401
          : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
