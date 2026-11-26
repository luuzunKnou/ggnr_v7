import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUsrId } from '@/lib/auth/guard'
import { withBasePath } from '@/lib/basePath'
import { type SmallPublicAttachScope, parseSmallPublicScope } from '@/lib/smallPublicAttachScope'
import { deleteScopedAttachment, saveScopedAttachment } from '@/lib/smallPublicAttachmentFs'
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

function attachUrl(mngNo: string, name: string, scope: SmallPublicAttachScope, year: string): string {
  const qs = new URLSearchParams({ mngNo, name })
  if (scope !== 'common') {
    qs.set('scope', scope)
    qs.set('year', year)
  }
  return withBasePath(`/api/small-public/file?${qs.toString()}`)
}

/**
 * 첨부 업로드 — multipart(mngNo, scope, year, files[])
 * scope: inspection → 안전점검_{연도}/, candidate → 후보지_{연도}/, common → 관리번호 폴더(시설 공통)
 */
export async function POST(req: NextRequest) {
  const usrId = await getSessionUsrId()
  if (!usrId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  try {
    const form = await req.formData()
    const mngNo = String(form.get('mngNo') ?? '').trim()
    const year = String(form.get('year') ?? '').trim()
    const scope = parseSmallPublicScope(String(form.get('scope') ?? ''))
    const files = form.getAll('files').filter((x): x is File => x instanceof File)
    if (files.length === 0) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
    const saved: Array<{ name: string; url: string; year: string; scope: SmallPublicAttachScope }> = []
    for (const f of files) {
      const buf = Buffer.from(await f.arrayBuffer())
      const r = await saveScopedAttachment({ mngNo, scope, year, fileName: f.name, data: buf })
      if (!r.ok) return NextResponse.json({ error: r.error, saved }, { status: 400 })
      saved.push({ name: r.name, url: attachUrl(mngNo, r.name, scope, year), year, scope })
    }
    return NextResponse.json({ success: true, files: saved })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

/** 첨부 삭제 — 구분·연도 폴더 또는 시설 공통 폴더의 파일 */
export async function DELETE(req: NextRequest) {
  const usrId = await getSessionUsrId()
  if (!usrId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const mngNo = req.nextUrl.searchParams.get('mngNo') ?? ''
  const name = req.nextUrl.searchParams.get('name') ?? ''
  const year = req.nextUrl.searchParams.get('year') ?? ''
  const scope = parseSmallPublicScope(req.nextUrl.searchParams.get('scope') ?? (year ? '' : 'common'))
  const r = await deleteScopedAttachment({ mngNo, scope, year, fileName: name })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ success: true })
}

/** file_data/small_public/{관리번호}/[{구분_연도}/]{파일} — 로그인 사용자만 */
export async function GET(req: NextRequest) {
  const usrId = await getSessionUsrId()
  if (!usrId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }
  const mngNo = req.nextUrl.searchParams.get('mngNo') ?? ''
  const name = req.nextUrl.searchParams.get('name') ?? ''
  const year = req.nextUrl.searchParams.get('year') ?? ''
  const scopeRaw = req.nextUrl.searchParams.get('scope')
  try {
    const abs = await resolveAttachmentPath({
      mngNo,
      name,
      year: year || undefined,
      scope: scopeRaw ? parseSmallPublicScope(scopeRaw) : undefined,
    })
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
