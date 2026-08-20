import { NextRequest, NextResponse } from 'next/server';

function buildUrl(kind: string): string | null {
  if (kind === 'ledger') return 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
  if (kind === 'recap') return 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo';
  if (kind === 'floor') return 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrFlrOulnInfo';
  if (kind === 'arch') return 'https://apis.data.go.kr/1613000/ArchPmsHubService/getApBasisOulnInfo';
  if (kind === 'housing') return 'https://apis.data.go.kr/1613000/HsPmsHubService/getHpBasisOulnInfo';
  return null;
}

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  const upstreamBase = buildUrl(kind);
  if (!upstreamBase) {
    return NextResponse.json({ error: 'kind must be ledger|recap|floor|arch|housing' }, { status: 400 });
  }

  const serviceKey = req.nextUrl.searchParams.get('serviceKey') ?? '';
  const sigunguCd = req.nextUrl.searchParams.get('sigunguCd') ?? '';
  const bjdongCd = req.nextUrl.searchParams.get('bjdongCd') ?? '';
  const platGbCd = req.nextUrl.searchParams.get('platGbCd') ?? '';
  const bun = req.nextUrl.searchParams.get('bun') ?? '';
  const ji = req.nextUrl.searchParams.get('ji') ?? '';
  const numOfRows = req.nextUrl.searchParams.get('numOfRows') ?? '10';
  const pageNo = req.nextUrl.searchParams.get('pageNo') ?? '1';
  const format = req.nextUrl.searchParams.get('format') ?? 'json';

  const qs = new URLSearchParams({
    serviceKey,
    sigunguCd,
    bjdongCd,
    platGbCd,
    bun,
    ji,
    numOfRows,
    pageNo,
    format,
  });
  const upstreamUrl = `${upstreamBase}?${qs.toString()}`;

  console.log('[building-proxy:req]', {
    kind,
    sigunguCd,
    bjdongCd,
    platGbCd,
    bun,
    ji,
    numOfRows,
    pageNo,
    format,
    hasServiceKey: Boolean(serviceKey),
  });

  try {
    const res = await fetch(upstreamUrl, { method: 'GET', cache: 'no-store' });
    const text = await res.text();
    const lower = text.toLowerCase();
    const quotaHit =
      res.status === 429 ||
      lower.includes('quota') ||
      (lower.includes('트래픽') && lower.includes('초과'));
    if (quotaHit) {
      console.warn('[building-proxy] 공공데이터포털 호출 한도(쿼터) 초과', { kind, status: res.status });
    }
    console.log('[building-proxy:res]', {
      kind,
      status: res.status,
      quotaExceeded: quotaHit,
      bodySnippet: text.slice(0, 300),
    });
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/xml; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[building-proxy:error]', { kind, message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
