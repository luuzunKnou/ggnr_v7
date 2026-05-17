import { NextRequest, NextResponse } from 'next/server';

export async function proxyVworldGet(req: NextRequest, upstreamBaseUrl: string) {
  try {
    const upstreamUrl = new URL(upstreamBaseUrl);
    req.nextUrl.searchParams.forEach((value, key) => {
      upstreamUrl.searchParams.append(key, value);
    });

    const upstreamRes = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      cache: 'no-store',
    });

    const body = await upstreamRes.text();
    const contentType = upstreamRes.headers.get('content-type') ?? 'application/json; charset=utf-8';

    return new NextResponse(body, {
      status: upstreamRes.status,
      headers: {
        'content-type': contentType,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'VWorld proxy failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
