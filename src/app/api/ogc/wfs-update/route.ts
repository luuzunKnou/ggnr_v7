import { NextRequest, NextResponse } from 'next/server';
import { proxyWfsUpdate } from '@/service/qgisLayerControlService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** QGIS WFS Transaction 프록시 — can_write=Y 만 GeoServer로 전달 */
export async function POST(req: NextRequest) {
  try {
    const key =
      req.nextUrl.searchParams.get('key') ||
      req.headers.get('x-qgis-key') ||
      '';
    const body = new Uint8Array(await req.arrayBuffer());
    const result = await proxyWfsUpdate({
      key,
      body,
      contentType: req.headers.get('content-type'),
    });
    return new NextResponse(Buffer.from(result.body), {
      status: result.status,
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(`WFS Update 오류: ${msg}`, { status: 500 });
  }
}
