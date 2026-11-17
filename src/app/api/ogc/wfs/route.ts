import { NextRequest, NextResponse } from 'next/server';
import {
  buildAppBaseUrl,
  proxyWfsGet,
  proxyWfsPost,
  proxyWfsUpdate,
} from '@/service/qgisLayerControlService';

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

/** QGIS WFS 프록시 — key 권한으로 Capabilities·조회 통제 */
export async function GET(req: NextRequest) {
  try {
    const result = await proxyWfsGet({
      searchParams: req.nextUrl.searchParams,
      appBaseUrl: appBaseFromRequest(req),
    });
    return toResponse(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(`WFS 프록시 오류: ${msg}`, { status: 500 });
  }
}

/**
 * 레거시 `/wfs.do` 는 method 제한 없음.
 * Transaction POST → 권한 검사 후 GeoServer.
 * 그 외 POST(GetFeature 등) → GeoServer 중계.
 */
export async function POST(req: NextRequest) {
  try {
    const key =
      req.nextUrl.searchParams.get('key') ||
      req.headers.get('x-qgis-key') ||
      '';
    const body = new Uint8Array(await req.arrayBuffer());
    const head = new TextDecoder('utf-8').decode(body.slice(0, Math.min(body.length, 2000)));
    const looksLikeTransaction =
      /<(?:[\w.]+:)?Transaction\b/i.test(head) ||
      (/<(?:[\w.]+:)?(?:Insert|Update|Delete)\b/i.test(head) && /wfs/i.test(head));

    if (looksLikeTransaction) {
      return toResponse(
        await proxyWfsUpdate({
          key,
          body,
          contentType: req.headers.get('content-type'),
        })
      );
    }

    return toResponse(
      await proxyWfsPost({
        searchParams: req.nextUrl.searchParams,
        body,
        contentType: req.headers.get('content-type'),
        keyHint: key,
        appBaseUrl: appBaseFromRequest(req),
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(`WFS 프록시 오류: ${msg}`, { status: 500 });
  }
}
