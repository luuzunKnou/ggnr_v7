import { NextRequest, NextResponse } from 'next/server';
import { getMapConfig } from '@/service/configService';

const UPSTREAM = 'https://api.vworld.kr/req/search';
const MAX_ATTEMPTS = 3;

/** VWorld Search API 2.0 — JSONP 대신 서버 fetch (502 시 재시도) */
export async function GET(req: NextRequest) {
  try {
    const { VWORLD_API_KEY } = getMapConfig();
    if (!VWORLD_API_KEY) {
      return NextResponse.json(
        { response: { status: 'ERROR', error: { text: 'VWORLD_API_KEY not configured' } } },
        { status: 503 }
      );
    }

    const upstream = new URL(UPSTREAM);
    req.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'key') upstream.searchParams.set(key, value);
    });
    upstream.searchParams.set('key', VWORLD_API_KEY);

    let lastStatus = 502;
    let lastBody = '';

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
      try {
        const upstreamRes = await fetch(upstream.toString(), { method: 'GET', cache: 'no-store' });
        lastStatus = upstreamRes.status;
        lastBody = await upstreamRes.text();
        if (upstreamRes.ok) {
          const contentType = upstreamRes.headers.get('content-type') ?? 'application/json; charset=utf-8';
          return new NextResponse(lastBody, {
            status: upstreamRes.status,
            headers: { 'content-type': contentType, 'cache-control': 'no-store' },
          });
        }
        if (lastStatus !== 502 && lastStatus !== 503 && lastStatus !== 504) break;
      } catch (e) {
        lastStatus = 502;
        lastBody = e instanceof Error ? e.message : 'fetch failed';
      }
    }

    return new NextResponse(lastBody || 'VWorld search upstream error', {
      status: lastStatus,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'VWorld search proxy failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
