import fs from 'node:fs/promises'
import path from 'node:path'
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths'
import { type SmallPublicAttachScope, smallPublicScopeDirName } from '@/lib/smallPublicAttachScope'
import { resolveGgnrDataDir, turbopackOpaquePath } from '@/lib/turbopackFsPath'

/**
 * 소규모 공공시설 첨부 — file_data/small_public/{관리번호}/ 저장·삭제 (서버 전용)
 *   안전점검_{연도}/ · 후보지_{연도}/ · (시설 공통은 관리번호 폴더 바로 아래)
 */

const MNG_RE = /^SSF\d{2}FAC\d{5}$/i
const YEAR_RE = /^\d{4}$/
const ALLOWED_EXT = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.hwp', '.hwpx', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.txt', '.dwg',
])
export const SMALL_PUBLIC_ATTACH_MAX_BYTES = 50 * 1024 * 1024

function root(): string {
  return turbopackOpaquePath(path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.smallPublic))
}

function safeName(raw: string): string | null {
  const base = path.basename(String(raw ?? '').replace(/\\/g, '/')).trim()
  if (!base || base.startsWith('.') || base.includes('..')) return null
  if (!ALLOWED_EXT.has(path.extname(base).toLowerCase())) return null
  return base
}

/** 저장 폴더 — 안전점검·후보지는 «구분_연도», 시설 공통은 관리번호 폴더 */
export function smallPublicAttachDir(mngNo: string, scope: SmallPublicAttachScope, year: string): string | null {
  const m = String(mngNo ?? '').trim()
  if (!MNG_RE.test(m)) return null
  if (scope === 'common') return path.join(root(), m)
  const y = String(year ?? '').trim()
  if (!YEAR_RE.test(y)) return null
  return path.join(root(), m, smallPublicScopeDirName(scope, y))
}

/** 폴더에 저장 — 같은 이름이 있으면 (2)… 를 붙인다. 저장된 파일명 반환 */
export async function saveScopedAttachment(params: {
  mngNo: string
  scope: SmallPublicAttachScope
  year: string
  fileName: string
  data: Buffer
}): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const dir = smallPublicAttachDir(params.mngNo, params.scope, params.year)
  if (!dir) return { ok: false, error: '관리번호 또는 연도가 올바르지 않습니다.' }
  const name = safeName(params.fileName)
  if (!name) return { ok: false, error: 'PDF·이미지 파일만 올릴 수 있습니다.' }
  if (params.data.length === 0) return { ok: false, error: '빈 파일입니다.' }
  if (params.data.length > SMALL_PUBLIC_ATTACH_MAX_BYTES) return { ok: false, error: '파일이 너무 큽니다.' }

  await fs.mkdir(dir, { recursive: true })
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let finalName = name
  for (let n = 2; n < 100; n++) {
    try {
      await fs.writeFile(path.join(dir, finalName), params.data, { flag: 'wx' })
      return { ok: true, name: finalName }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      finalName = `${stem} (${n})${ext}`
    }
  }
  return { ok: false, error: '같은 이름의 파일이 너무 많습니다.' }
}

/** 폴더의 파일 삭제 */
export async function deleteScopedAttachment(params: {
  mngNo: string
  scope: SmallPublicAttachScope
  year: string
  fileName: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const dir = smallPublicAttachDir(params.mngNo, params.scope, params.year)
  if (!dir) return { ok: false, error: '관리번호 또는 연도가 올바르지 않습니다.' }
  const name = safeName(params.fileName)
  if (!name) return { ok: false, error: '파일명이 올바르지 않습니다.' }
  try {
    await fs.unlink(path.join(dir, name))
    return { ok: true }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    /** 예전 {연도}/ 폴더(안전점검)에 남아 있는 파일 */
    if (params.scope === 'inspection') {
      try {
        await fs.unlink(path.join(path.dirname(dir), String(params.year).trim(), name))
      } catch {
        /* 없으면 이미 지워진 것으로 본다 */
      }
    }
    return { ok: true }
  }
}

/** 구분·연도 폴더 통째로 비우고 삭제(후보지 평가를 지울 때) — 시설 공통 폴더는 지우지 않는다 */
export async function removeScopedAttachmentDir(params: {
  mngNo: string
  scope: 'inspection' | 'candidate'
  year: string
}): Promise<void> {
  const dir = smallPublicAttachDir(params.mngNo, params.scope, params.year)
  if (!dir) return
  await fs.rm(dir, { recursive: true, force: true })
}
