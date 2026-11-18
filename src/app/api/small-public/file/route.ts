import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUsrId } from '@/lib/auth/guard'
import { resolveAttachmentPath } from '@/service/smallPublicService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function contentTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'application/octet-stream'
}

/** file_data/small_public/{관리번호}/{파일} — 로그인 사용자만 */
export async function GET(req: NextRequest) {
  const usrId = await getSessionUsrId()
  if (!usrId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }
  const mngNo = req.nextUrl.searchParams.get('mngNo') ?? ''
  const name = req.nextUrl.searchParams.get('name') ?? ''
  try {
    const abs = await resolveAttachmentPath({ mngNo, name })
    if (!abs) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })
    const st = await fs.stat(abs)
    const body = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>
    return new NextResponse(body, {
      headers: {
        'Content-Type': contentTypeFor(name),
        'Content-Length': String(st.size),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`,
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
