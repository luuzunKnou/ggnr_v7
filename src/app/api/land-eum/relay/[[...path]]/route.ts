import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { fetchEumRelay } from '@/lib/eumLandProxy';

export const dynamic = 'force-dynamic';

async function relay(req: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  if (!(await getSessionUsrId())) {
    return new NextResponse(null, { status: 401 });
  }
  const { path: parts } = await context.params;
  const path = (parts ?? []).join('/');
  if (!path) return new NextResponse(null, { status: 400 });
  try {
    const forwarded = await fetchEumRelay({
      path,
      search: req.nextUrl.search,
      method: req.method === 'POST' ? 'POST' : 'GET',
      body: req.method === 'POST' ? await req.arrayBuffer() : null,
      contentType: req.headers.get('content-type'),
    });
    return new NextResponse(forwarded.body, {
      status: forwarded.status,
      headers: {
        'Content-Type': forwarded.contentType,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}

export const GET = relay;
export const POST = relay;
