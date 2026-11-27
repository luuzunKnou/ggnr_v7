/**
 * file_data/small_public/{관리번호}/ 첨부를 구분·연도 폴더로 정리한다.
 *   루트: 대장·요약 등 시설 공통 (그대로)
 *   안전점검_{연도}/: 위험도·현장조사·일반관리구분 (조사일 연도) — 예전 {연도}/ 폴더는 이름만 바꿔 합침
 *   후보지_{연도}/: 후보지평가 파일 (후보지 평가일 연도)
 *
 * 기본은 미리보기(파일을 옮기지 않음). 실제 이동은 --apply.
 *
 *   npx tsx scripts/organize-small-public-attachments-by-year.ts --project ggnr_sy --env dev
 *   npx tsx scripts/organize-small-public-attachments-by-year.ts --project ggnr_sy --env dev --apply
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { loadProjectEnv } from './load-project-env'
import pg from 'pg'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i < 0) return undefined
  return process.argv[i + 1]
}

const apply = process.argv.includes('--apply')
loadProjectEnv(argValue('--project') ?? 'ggnr_sy', argValue('--env') ?? 'dev')

const MNG_DIR_RE = /^SSF\d{2}FAC\d{5}$/i
const LEGACY_YEAR_RE = /^\d{4}$/
const INSPECTION_PREFIX = '안전점검_'
const CANDIDATE_PREFIX = '후보지_'

type Role = 'candidate' | 'risk' | 'class' | 'field' | 'ledger' | 'summary' | 'other'

function classify(fileName: string): Role {
  const n = fileName.replace(/\.[^.]+$/, '')
  if (/후보지평가/.test(n)) return 'candidate'
  if (/위험도/.test(n)) return 'risk'
  if (/일반.?관리|구분/.test(n)) return 'class'
  if (/현장조사/.test(n)) return 'field'
  if (/대장/.test(n)) return 'ledger'
  if (/요약/.test(n)) return 'summary'
  return 'other'
}

function isInspectionRole(role: Role): boolean {
  return role === 'risk' || role === 'class' || role === 'field'
}

async function moveFile(src: string, destDir: string, name: string, label: string, stat: { moved: number; skipped: number }) {
  const dest = path.join(destDir, name)
  if (fs.existsSync(dest)) {
    console.warn(`[organize] 이미 있어 건너뜀 ${label}`)
    stat.skipped++
    return
  }
  console.log(`[organize] ${label}`)
  if (apply) {
    await fsp.mkdir(destDir, { recursive: true })
    await fsp.rename(src, dest)
  }
  stat.moved++
}

async function main() {
  const dataDir = process.env.GGNR_DATA_DIR
  if (!dataDir) throw new Error('GGNR_DATA_DIR 없음')
  const root = path.join(dataDir, 'file_data', 'small_public')
  if (!fs.existsSync(root)) throw new Error(`첨부 루트 없음: ${root}`)

  const pool = new pg.Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
  })

  try {
    const checkRes = await pool.query<{ cons_code: string; y: string }>(`
      SELECT cons_code, left(btrim(surv_date), 4) AS y
      FROM layer.spf_check
      WHERE cons_code IS NOT NULL AND btrim(cons_code) <> ''
        AND surv_date IS NOT NULL AND btrim(surv_date) <> ''
        AND left(btrim(surv_date), 4) ~ '^[0-9]{4}$'
      ORDER BY cons_code, surv_date DESC NULLS LAST, id DESC
    `)
    /** 관리번호 → 가장 최근 조사 연도 */
    const latestInspectionYear = new Map<string, string>()
    for (const row of checkRes.rows) {
      const cons = String(row.cons_code).trim()
      if (cons && !latestInspectionYear.has(cons)) latestInspectionYear.set(cons, String(row.y).trim())
    }

    const evalRes = await pool.query<{ cons_code: string; y: string }>(`
      SELECT cons_code, left(btrim(eval_date), 4) AS y
      FROM layer.spf_eval
      WHERE cons_code IS NOT NULL AND btrim(cons_code) <> ''
        AND eval_date IS NOT NULL AND btrim(eval_date) <> ''
        AND left(btrim(eval_date), 4) ~ '^[0-9]{4}$'
      ORDER BY cons_code, eval_date DESC NULLS LAST, id DESC
    `)
    /** 관리번호 → 가장 최근 후보지 평가 연도 */
    const latestEvalYear = new Map<string, string>()
    for (const row of evalRes.rows) {
      const cons = String(row.cons_code).trim()
      if (cons && !latestEvalYear.has(cons)) latestEvalYear.set(cons, String(row.y).trim())
    }

    const entries = await fsp.readdir(root, { withFileTypes: true })
    const mngDirs = entries.filter((e) => e.isDirectory() && MNG_DIR_RE.test(e.name)).map((e) => e.name)
    console.log(`[organize] root=${root} dirs=${mngDirs.length} mode=${apply ? 'APPLY' : '미리보기(--apply 로 실행)'}`)

    const stat = { moved: 0, skipped: 0 }
    let noInspectionYear = 0
    let noEvalYear = 0

    for (const mng of mngDirs) {
      const dir = path.join(root, mng)
      const children = await fsp.readdir(dir, { withFileTypes: true })

      /** 1) 예전 {연도}/ → 안전점검_{연도}/ */
      for (const c of children) {
        if (!c.isDirectory() || !LEGACY_YEAR_RE.test(c.name)) continue
        const srcDir = path.join(dir, c.name)
        const destDir = path.join(dir, `${INSPECTION_PREFIX}${c.name}`)
        const files = (await fsp.readdir(srcDir, { withFileTypes: true })).filter((e) => e.isFile())
        for (const f of files) {
          await moveFile(path.join(srcDir, f.name), destDir, f.name, `${mng}/${c.name}/${f.name} -> ${mng}/${INSPECTION_PREFIX}${c.name}/${f.name}`, stat)
        }
        if (apply) {
          const left = await fsp.readdir(srcDir).catch(() => ['x'])
          if (left.length === 0) await fsp.rmdir(srcDir).catch(() => undefined)
        }
      }

      /** 2) 루트 파일 — 안전점검 계열은 안전점검_{조사연도}/, 후보지평가는 후보지_{평가연도}/ */
      const rootFiles = children
        .filter((e) => e.isFile() && !e.name.startsWith('.') && !e.name.toLowerCase().endsWith('.tmp'))
        .map((e) => e.name)
      for (const name of rootFiles) {
        const role = classify(name)
        const src = path.join(dir, name)
        if (isInspectionRole(role)) {
          const year = latestInspectionYear.get(mng)
          if (!year) {
            console.warn(`[organize] 조사 연도 없음 — 루트 유지 ${mng}/${name}`)
            noInspectionYear++
            continue
          }
          await moveFile(src, path.join(dir, `${INSPECTION_PREFIX}${year}`), name, `${mng}/${name} -> ${mng}/${INSPECTION_PREFIX}${year}/${name}`, stat)
        } else if (role === 'candidate') {
          const year = latestEvalYear.get(mng)
          if (!year) {
            console.warn(`[organize] 후보지 평가 연도 없음 — 루트 유지 ${mng}/${name}`)
            noEvalYear++
            continue
          }
          await moveFile(src, path.join(dir, `${CANDIDATE_PREFIX}${year}`), name, `${mng}/${name} -> ${mng}/${CANDIDATE_PREFIX}${year}/${name}`, stat)
        }
      }
    }

    console.log(
      `[organize] ${apply ? '완료' : '미리보기'} 이동=${stat.moved} 건너뜀=${stat.skipped} 조사연도없음=${noInspectionYear} 평가연도없음=${noEvalYear}`
    )
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
