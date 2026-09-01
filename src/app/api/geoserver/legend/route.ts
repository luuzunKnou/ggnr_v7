import { NextRequest, NextResponse } from 'next/server';
import { getGeoServerInternalBase } from '@/lib/geoserverUrl';

const WORKSPACE = 'ggnr';
const LAYER_NAME_RE = /^[A-Za-z0-9_]+$/;

/** 1×1 투명 PNG — 테이블·레이어가 없어도 img 요청이 500으로 떨어지지 않게 */
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);

function emptyLegend(): NextResponse {
  return new NextResponse(TRANSPARENT_PNG, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * GeoServer GetLegendGraphic 프록시.
 * DB 테이블·레이어가 없으면 GeoServer가 500 XML을 주므로, 그때는 투명 PNG로 바꿔 범례·콘솔 오류를 막는다.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const layer = String(sp.get('layer') ?? '').trim();
  if (!LAYER_NAME_RE.test(layer)) return emptyLegend();

  const styleRaw = String(sp.get('style') ?? '').trim();
  const style = LAYER_NAME_RE.test(styleRaw) ? styleRaw : layer;
  const width = Math.min(64, Math.max(8, Number(sp.get('width') ?? 20) || 20));
  const height = Math.min(64, Math.max(8, Number(sp.get('height') ?? 20) || 20));

  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetLegendGraphic',
    VERSION: '1.0.0',
    FORMAT: 'image/png',
    LAYER: `${WORKSPACE}:${layer}`,
    STYLE: style,
    WIDTH: String(width),
    HEIGHT: String(height),
    TRANSPARENT: 'true',
    EXCEPTIONS: 'application/vnd.ogc.se_xml',
  });
  const upstream = `${getGeoServerInternalBase()}/wms?${params.toString()}`;

  try {
    const res = await fetch(upstream, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return emptyLegend();
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!ct.includes('image')) return emptyLegend();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) return emptyLegend();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch {
    return emptyLegend();
  }
}
