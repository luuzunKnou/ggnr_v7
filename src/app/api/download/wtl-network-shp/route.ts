import { NextRequest, NextResponse } from 'next/server';
import { exportWtlNetworkShpZip } from '@/service/wtlNetworkService';
import { recordLayerDownloadLog } from '@/service/layerDownloadLog';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await exportWtlNetworkShpZip(body ?? {});
    if (!result.success || !result.zipBuffer) {
      console.error('[download/wtl-network-shp]', result.error);
      return NextResponse.json(
        { error: result.error ?? 'SHP 보내기 실패' },
        { status: 500 }
      );
    }
    const keys = Array.isArray(body?.layerKeys) ? body.layerKeys : [];
    try {
      await recordLayerDownloadLog({
        tableName: keys.length === 1 ? String(keys[0]) : 'wtl_network',
        format: 'SHP',
      });
    } catch (e) {
      console.warn(
        '[download/wtl-network-shp] data_log',
        e instanceof Error ? e.message : e
      );
    }
    const fileName = String(result.fileName ?? '관망조회_SHP.zip').replace(
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
    console.error('[download/wtl-network-shp] exception', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
