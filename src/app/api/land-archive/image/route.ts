import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { NextRequest, NextResponse } from 'next/server'
import { resolveImagePath } from '@/service/landArchiveService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function contentTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff'
  return 'image/jpeg'
}

/** 지적기록물 스캔 원본 — 표에 있는 행의 경로만 전달 */
export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get('t') ?? ''
  const n = req.nextUrl.searchParams.get('n') ?? ''
  try {
    const abs = await resolveImagePath({ t, n })
    if (!abs) return NextResponse.json({ error: '기록물을 찾을 수 없습니다.' }, { status: 404 })
    const st = await fs.stat(abs)
    const body = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>
    return new NextResponse(body, {
      headers: {
        'Content-Type': contentTypeFor(abs),
        'Content-Length': String(st.size),
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (e) {
    const status =
      e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number'
        ? (e as { status: number }).status
        : (e as NodeJS.ErrnoException)?.code === 'ENOENT'
          ? 404
          : 500
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status })
  }
}
