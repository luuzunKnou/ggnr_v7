import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getGeoServerInternalBase } from '@/lib/geoserverUrl';

const WORKSPACE = 'ggnr';
const LAYER_NAME_RE = /^[A-Za-z0-9_]+$/;
const ORTHO_EXTENT = 'ortho_extent';

/** 1×1 투명 PNG — 테이블·레이어가 없어도 img 요청이 500으로 떨어지지 않게 */
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);

function emptyLegend(): NextResponse {
  return new NextResponse(new Uint8Array(TRANSPARENT_PNG), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}

function legendPng(buf: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

async function fetchLegendPng(upstream: string): Promise<Buffer | null> {
  try {
    const res = await fetch(upstream, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!ct.includes('image')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
    return buf;
  } catch {
    return null;
  }
}

/** landown 폴리곤 SLD와 동일 구조·색만 보라 — 디스크 SLD 우선 */
function loadOrthoExtentSld(namedLayer: string): string {
  const sldPath = path.join(process.cwd(), 'geoserver_modules', 'data_dir', 'styles', 'ortho_extent.sld');
  try {
    const raw = fs.readFileSync(sldPath, 'utf8');
    if (namedLayer === ORTHO_EXTENT) return raw;
    return raw.replace(/<sld:Name>ortho_extent<\/sld:Name>/, `<sld:Name>${namedLayer}</sld:Name>`);
  } catch {
    return `<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0"><sld:NamedLayer><sld:Name>${namedLayer}</sld:Name><sld:UserStyle><sld:Name>Default Styler</sld:Name><sld:FeatureTypeStyle><sld:Rule><sld:PolygonSymbolizer><sld:Fill><sld:CssParameter name="fill">#7C3AED</sld:CssParameter><sld:CssParameter name="fill-opacity">0.3</sld:CssParameter></sld:Fill><sld:Stroke><sld:CssParameter name="stroke">#FFFFFF</sld:CssParameter><sld:CssParameter name="stroke-opacity">1.0</sld:CssParameter><sld:CssParameter name="stroke-width">1</sld:CssParameter></sld:Stroke></sld:PolygonSymbolizer></sld:Rule></sld:FeatureTypeStyle></sld:UserStyle></sld:NamedLayer></sld:StyledLayerDescriptor>`;
  }
}

/**
 * 가상 레이어 ortho_extent — GeoServer에 테이블이 없어도
 * landown 계열과 같은 PolygonSymbolizer SLD(색만 보라)로 GetLegendGraphic 생성.
 */
async function fetchOrthoExtentLegend(width: number, height: number): Promise<Buffer | null> {
  const base = getGeoServerInternalBase();
  /** GetLegendGraphic은 실제 레이어가 필요하므로, SLD NamedLayer 이름을 캐리어에 맞춘다 */
  const carriers = [ORTHO_EXTENT, 'landown_dea', 'landown_jeon', 'permit'];

  for (const carrier of carriers) {
    const sldBody = loadOrthoExtentSld(carrier);
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      REQUEST: 'GetLegendGraphic',
      VERSION: '1.0.0',
      FORMAT: 'image/png',
      LAYER: `${WORKSPACE}:${carrier}`,
      WIDTH: String(width),
      HEIGHT: String(height),
      TRANSPARENT: 'true',
      EXCEPTIONS: 'application/vnd.ogc.se_xml',
      SLD_BODY: sldBody,
    });
    const buf = await fetchLegendPng(`${base}/wms?${params.toString()}`);
    if (buf) return buf;
  }

  // 스타일이 카탈로그에 등록된 경우 STYLE만으로 재시도
  for (const carrier of carriers.slice(1)) {
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      REQUEST: 'GetLegendGraphic',
      VERSION: '1.0.0',
      FORMAT: 'image/png',
      LAYER: `${WORKSPACE}:${carrier}`,
      STYLE: ORTHO_EXTENT,
      WIDTH: String(width),
      HEIGHT: String(height),
      TRANSPARENT: 'true',
      EXCEPTIONS: 'application/vnd.ogc.se_xml',
    });
    const buf = await fetchLegendPng(`${base}/wms?${params.toString()}`);
    if (buf) return buf;
  }

  return null;
}

/**
 * GeoServer GetLegendGraphic 프록시.
 * DB 테이블·레이어가 없으면 GeoServer가 500 XML을 주므로, 그때는 투명 PNG로 바꿔 범례·콘솔 오류를 막는다.
 * ortho_extent(가상)는 landown 폴리곤 SLD와 동일 구조·보라색으로 범례를 만든다.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const layer = String(sp.get('layer') ?? '').trim();
  if (!LAYER_NAME_RE.test(layer)) return emptyLegend();

  const styleRaw = String(sp.get('style') ?? '').trim();
  const style = LAYER_NAME_RE.test(styleRaw) ? styleRaw : layer;
  const width = Math.min(64, Math.max(8, Number(sp.get('width') ?? 20) || 20));
  const height = Math.min(64, Math.max(8, Number(sp.get('height') ?? 20) || 20));

  if (layer === ORTHO_EXTENT) {
    const buf = await fetchOrthoExtentLegend(width, height);
    return buf ? legendPng(buf) : emptyLegend();
  }

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
  const buf = await fetchLegendPng(upstream);
  return buf ? legendPng(buf) : emptyLegend();
}
