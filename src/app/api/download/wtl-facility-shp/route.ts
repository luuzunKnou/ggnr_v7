import { NextRequest, NextResponse } from 'next/server';
import { exportFacilityShpZip } from '@/service/wtlFacilityService';
import { recordLayerDownloadLog } from '@/service/layerDownloadLog';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await exportFacilityShpZip(body ?? {});
    if (!result.success || !result.zipBuffer) {
      console.error('[download/wtl-facility-shp]', result.error);
      return NextResponse.json(
        { error: result.error ?? 'SHP 보내기 실패' },
        { status: 500 }
      );
    }
    const tableName = String(body?.table ?? 'wtl_facility').trim() || 'wtl_facility';
    try {
      await recordLayerDownloadLog({
        tableName,
        format: 'SHP',
      });
    } catch (e) {
      console.warn(
        '[download/wtl-facility-shp] data_log',
        e instanceof Error ? e.message : e
      );
    }
    const fileName = String(result.fileName ?? '시설목록_SHP.zip').replace(
      /[^\w가-힣._-]+/g,
      '_'
    );
    return new NextResponse(new Uint8Array(result.zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[download/wtl-facility-shp] exception', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
