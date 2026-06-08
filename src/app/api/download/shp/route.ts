import { NextRequest, NextResponse } from 'next/server';
import { exportLayerTableToShp } from '@/service/shpUploadService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tableName = (body?.tableName ?? body?.table ?? '').trim();
    if (!tableName) {
      return NextResponse.json({ error: 'tableName이 필요합니다.' }, { status: 400 });
    }
    const schemaRaw = String(body?.schema ?? '').toLowerCase();
    const schema = schemaRaw === 'public_layer' ? ('public_layer' as const) : ('layer' as const);
    const result = await exportLayerTableToShp({ tableName, schema });
    if (!result.success || !result.zipBuffer) {
      console.error('[download/shp]', tableName, result.error);
      return NextResponse.json(
        { error: result.error ?? 'SHP보내기 실패' },
        { status: 500 }
      );
    }
    console.log('[download/shp]', tableName, result.zipBuffer.length, 'bytes');
    const safeName = tableName.replace(/[^a-zA-Z0-9_가-힣-]/g, '_');
    return new NextResponse(new Uint8Array(result.zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeName}.zip"`,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[download/shp] exception', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
