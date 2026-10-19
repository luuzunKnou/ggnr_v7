import { NextRequest, NextResponse } from 'next/server';
import { buildGeoserverWebUpstream, proxyGeoserverWeb } from '@/lib/geoserverWebProxy';

export const dynamic = 'force-dynamic';

/**
 * GeoServer 관리 화면만 중계한다.
 * 지도 WMS·REST 는 next.config rewrite 를 그대로 쓴다.
 * 내부 주소로 나가는 리다이렉트와 세션 쿠키 경로를 공개 주소에 맞춘다.
 */
async function relay(req: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path } = await context.params;
  const upstream = buildGeoserverWebUpstream(path, req.nextUrl.search);
  if (!upstream) {
    return new NextResponse('잘못된 경로입니다.', { status: 400 });
  }
  try {
    return await proxyGeoserverWeb(req, upstream);
  } catch {
    return new NextResponse('GeoServer 관리 화면에 연결하지 못했습니다.', { status: 502 });
  }
}

export const GET = relay;
export const POST = relay;
export const PUT = relay;
export const PATCH = relay;
export const DELETE = relay;
export const HEAD = relay;
