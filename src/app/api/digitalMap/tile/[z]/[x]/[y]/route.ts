import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { digitalMapPmtilesInfo, readDigitalMapPmtilesTile } from '@/lib/digitalMapPmtiles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ z: string; x: string; y: string }> };

const MVT_HEADERS = {
  'Content-Type': 'application/vnd.mapbox-vector-tile',
  'Cache-Control': 'private, max-age=600',
};

/**
 * GET /api/digitalMap/tile/{z}/{x}/{y}?folder=수치지형도(25000) — 수치지형도 벡터타일(MVT, EPSG:3857 XYZ)
 * digital_map 폴더의 PMTiles 파일에서 읽는다. 파일이 없으면 404.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const folder = (req.nextUrl.searchParams.get('folder') ?? '').trim();
  if (!folder || folder.includes('/') || folder.includes('\\') || folder.includes('..')) {
    return NextResponse.json({ error: 'folder 가 올바르지 않습니다.' }, { status: 400 });
  }
  const usrId = await getSessionUsrId();
  if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { z, x, y } = await ctx.params;

  try {
    if (!(await digitalMapPmtilesInfo(folder))) {
      return NextResponse.json({ error: '수치지형도 PMTiles 파일이 없습니다.' }, { status: 404 });
    }
    const tile = await readDigitalMapPmtilesTile(folder, Number(z), Number(x), Number(y));
    return new NextResponse(new Uint8Array(tile.body), {
      status: 200,
      headers: tile.encoding ? { ...MVT_HEADERS, 'Content-Encoding': tile.encoding } : MVT_HEADERS,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /올바르지/.test(msg) ? 400 : 500;
    console.error('[digitalMap/tile]', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
