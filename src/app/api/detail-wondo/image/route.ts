import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { resolveImagePath } from '@/service/detailWondoService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 세부원도 원본 JPG — 목록에 있는 id만 전달 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  try {
    const abs = await resolveImagePath(id);
    if (!abs) return NextResponse.json({ error: '원도를 찾을 수 없습니다.' }, { status: 404 });
    const st = await fs.stat(abs);
    const body = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>;
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(st.size),
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (e) {
    const status =
      e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number'
        ? (e as { status: number }).status
        : (e as NodeJS.ErrnoException)?.code === 'ENOENT'
          ? 404
          : 500;
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status });
  }
}
