import { NextRequest, NextResponse } from 'next/server';
import { buildAppBaseUrl, proxyWmsGet } from '@/service/qgisLayerControlService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function appBaseFromRequest(req: NextRequest): string {
  const proto =
    req.headers.get('x-forwarded-proto') ||
    req.nextUrl.protocol.replace(/:$/, '') ||
    'http';
  const host =
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    req.nextUrl.host;
  return buildAppBaseUrl({ proto, host });
}

function toResponse(result: {
  status: number;
  contentType: string;
  body: Uint8Array;
}): NextResponse {
  return new NextResponse(Buffer.from(result.body), {
    status: result.status,
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'no-store',
    },
  });
}

/** QGIS WMS 프록시 — key 권한으로 Capabilities·GetMap 통제 */
export async function GET(req: NextRequest) {
  try {
    const result = await proxyWmsGet({
      searchParams: req.nextUrl.searchParams,
      appBaseUrl: appBaseFromRequest(req),
    });
    return toResponse(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(`WMS 프록시 오류: ${msg}`, { status: 500 });
  }
}
