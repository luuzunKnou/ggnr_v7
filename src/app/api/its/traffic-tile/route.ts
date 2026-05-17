import { NextRequest, NextResponse } from 'next/server';

/**
 * ITS 실시간 통행 WMTS PNG 타일 프록시.
 * Query: z, x, y, minX, maxX, minY, maxY — CCTV(cctvInfo)와 동일한 WGS84 bbox(화상자료 조회 범위).
 * bbox는 ITS 타일 URL에 붙이지 않고(서버 미지원), 검증·캐시 키·추후 확장용으로만 수신합니다.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const z = sp.get('z');
  const x = sp.get('x');
  const y = sp.get('y');
  const minX = sp.get('minX');
  const maxX = sp.get('maxX');
  const minY = sp.get('minY');
  const maxY = sp.get('maxY');

  if (!z || !x || !y || !minX || !maxX || !minY || !maxY) {
    return NextResponse.json(
      { error: 'z, x, y, minX, maxX, minY, maxY are required (same as CCTV bbox)' },
      { status: 400 }
    );
  }

  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(y);
  if (!Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi)) {
    return NextResponse.json({ error: 'z, x, y must be integers' }, { status: 400 });
  }
  if (zi < 7 || zi > 15) {
    return NextResponse.json({ error: 'z must be between 7 and 15' }, { status: 400 });
  }

  const upstream = `https://its.go.kr:9443/geoserver/gwc/service/wmts/rest/ntic:N_LEVEL_${zi}/ntic:REALTIME/EPSG:3857/EPSG:3857:${zi}/${yi}/${xi}?format=image/png8`;

  try {
    const res = await fetch(upstream, { next: { revalidate: 0 } });
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type')?.includes('png') ? 'image/png' : 'image/png';
    return new NextResponse(buf, {
      status: res.ok ? 200 : res.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
