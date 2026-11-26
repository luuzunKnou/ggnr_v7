/**
 * 후보지평가(layer.spf_eval)를 첨부 폴더 기준으로 채운다.
 *   - 대상: file_data/small_public/{관리번호}/ 루트에 «후보지평가» 파일이 있는 관리번호
 *   - 평가일: 같은 폴더 «소규모공공시설대장» PDF 1쪽의 대장 작성일
 *   - 평가자: 비움
 *   - 선정여부: 시설 구분이 제외면 «선정제외», 그 외 «선정»
 *   - 이미 spf_eval 에 있는 관리번호는 건너뜀 (재실행 안전)
 *
 * pdftotext(poppler) 필요.
 *
 *   npx tsx scripts/import-small-public-candidate-eval-from-ledger.ts --project ggnr_sy --env dev            (미리보기)
 *   npx tsx scripts/import-small-public-candidate-eval-from-ledger.ts --project ggnr_sy --env dev --apply    (DB 반영)
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
import { loadProjectEnv } from './load-project-env'

const execFileP = promisify(execFile)

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i < 0 ? undefined : process.argv[i + 1]
}

const apply = process.argv.includes('--apply')
loadProjectEnv(argValue('--project') ?? 'ggnr_sy', argValue('--env') ?? 'dev')

const MNG_DIR_RE = /^SSF\d{2}FAC\d{5}$/i
const TYPE_TABLES = ['spf_creek', 'spf_bridge', 'spf_intake', 'spf_village', 'spf_farm', 'spf_drop']

/** 대장 1쪽: «작성일» 뒤 «YYYY년 M월 D일» (줄바꿈 허용) */
function parseLedgerDate(text: string): string | null {
  const m = text.match(/작성일\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

async function readLedgerDate(pdfPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('pdftotext', ['-enc', 'UTF-8', '-raw', '-l', '1', pdfPath, '-'], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
    return parseLedgerDate(stdout)
  } catch {
    return null
  }
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (true) {
        const i = next++
        if (i >= items.length) return
        out[i] = await fn(items[i]!)
      }
    })
  )
  return out
}

async function main() {
  const dataDir = process.env.GGNR_DATA_DIR
  if (!dataDir) throw new Error('GGNR_DATA_DIR 없음')
  const root = path.join(dataDir, 'file_data', 'small_public')
  if (!fs.existsSync(root)) throw new Error(`첨부 루트 없음: ${root}`)

  const db = new pg.Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
  })

  try {
    const existing = new Set(
      (await db.query<{ cons_code: string }>(`SELECT DISTINCT cons_code FROM layer.spf_eval WHERE cons_code IS NOT NULL`)).rows.map(
        (r) => String(r.cons_code).trim()
      )
    )

    const candByCons = new Map<string, string>()
    for (const t of TYPE_TABLES) {
      const r = await db.query<{ cons_code: string; candidate: string | null }>(
        `SELECT cons_code, candidate FROM layer.${t} WHERE cons_code IS NOT NULL AND btrim(cons_code) <> ''`
      )
      for (const row of r.rows) candByCons.set(String(row.cons_code).trim(), String(row.candidate ?? '').trim())
    }

    const dirs = (await fsp.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && MNG_DIR_RE.test(e.name))
      .map((e) => e.name)
      .sort()

    type Row = { cons: string; date: string | null; result: string }
    const skipped = { exists: 0, noCandFile: 0, notInDb: 0 }

    const targets: { cons: string; ledger: string | null }[] = []
    for (const mng of dirs) {
      if (existing.has(mng)) {
        skipped.exists++
        continue
      }
      if (!candByCons.has(mng)) {
        skipped.notInDb++
        continue
      }
      const files = (await fsp.readdir(path.join(root, mng), { withFileTypes: true }))
        .filter((e) => e.isFile())
        .map((e) => e.name)
      if (!files.some((n) => /후보지평가/.test(n))) {
        skipped.noCandFile++
        continue
      }
      const ledgers = files.filter((n) => /소규모공공시설대장|대장/.test(n) && n.toLowerCase().endsWith('.pdf'))
      const ledger = ledgers.find((n) => n.startsWith(mng)) ?? ledgers[0] ?? null
      targets.push({ cons: mng, ledger: ledger ? path.join(root, mng, ledger) : null })
    }

    console.log(`[eval] dirs=${dirs.length} targets=${targets.length} skipped=${JSON.stringify(skipped)} apply=${apply}`)

    let done = 0
    const rows: Row[] = await pool(targets, 8, async (t) => {
      const date = t.ledger ? await readLedgerDate(t.ledger) : null
      done++
      if (done % 500 === 0) console.log(`[eval] read ${done}/${targets.length}`)
      const cand = candByCons.get(t.cons) ?? ''
      return { cons: t.cons, date, result: cand === '제외' ? '선정제외' : '선정' }
    })

    const noDate = rows.filter((r) => !r.date)
    const byDate = new Map<string, number>()
    for (const r of rows) byDate.set(r.date ?? '(없음)', (byDate.get(r.date ?? '(없음)') ?? 0) + 1)
    const byResult = new Map<string, number>()
    for (const r of rows) byResult.set(r.result, (byResult.get(r.result) ?? 0) + 1)
    console.log('[eval] 평가일 분포', Object.fromEntries([...byDate.entries()].sort()))
    console.log('[eval] 선정여부', Object.fromEntries(byResult))
    if (noDate.length) console.log('[eval] 평가일 없음 샘플', noDate.slice(0, 10).map((r) => r.cons))

    if (!apply) {
      console.log('[eval] 미리보기 — 반영하려면 --apply')
      return
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const CHUNK = 500
      for (let i = 0; i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK)
        const args: unknown[] = []
        const values = part
          .map((r, j) => {
            args.push(r.cons, r.date, null, r.result, null)
            const b = j * 5
            return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`
          })
          .join(',')
        await client.query(
          `INSERT INTO layer.spf_eval (cons_code, eval_date, evaluator, result, remark) VALUES ${values}`,
          args
        )
      }
      await client.query('COMMIT')
      console.log(`[eval] inserted=${rows.length}`)
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  } finally {
    await db.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
