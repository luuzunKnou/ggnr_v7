/**
 * file_data/small_public/shp 6종 → layer.spf_{creek|bridge|intake|village|farm|drop} + spf_report + spf_check.
 *
 * 시설: CONS_CODE~HIGHT·geom (위험도·조사 필드는 check 로, 시설 테이블에 넣지 않음)
 * 점검: cons_code + report_id + RISK_* / SURV_* / CANDIDATE
 *
 *   npx tsx scripts/import-small-public-shp-to-spf.ts --project ggnr_sy --env dev
 */
import fs from 'node:fs'
import path from 'node:path'
import iconv from 'iconv-lite'
import { loadProjectEnv } from './load-project-env'
import { SPF_TYPE_TABLES } from '../src/lib/smallPublicTypeTables'

type DbfField = { name: string; type: string; length: number }
type ShpCoords = [number, number] | [number, number][] | null

type FacRow = {
  table: string
  type: string
  geomKind: 'LineString' | 'Point'
  consCode: string
  sisulName: string
  shpCode: string
  emd: string
  ri: string
  address: string
  startXy: string
  endXy: string
  benArea: string
  riskDate: string
  candidate: string
  lne: string
  width: string
  hight: string
  geomWkt: string | null
  riskScore: number | null
  survDate: string
  survName: string
  riskRank: string
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i < 0) return undefined
  return process.argv[i + 1]
}

function decodeCp949(buf: Buffer): string {
  return iconv.decode(buf, 'cp949').replace(/\0/g, '').trim()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function normalizeDate(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (!m) return s
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
}

function numText(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const n = Number(s)
  return Number.isFinite(n) ? String(n) : s
}

function parseScore(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}

function readShpGeoms(shpPath: string, shxPath: string, count: number): ShpCoords[] {
  if (!fs.existsSync(shpPath) || !fs.existsSync(shxPath)) {
    return Array.from({ length: count }, () => null)
  }
  const shp = fs.readFileSync(shpPath)
  const shx = fs.readFileSync(shxPath)
  const out: ShpCoords[] = []
  for (let i = 0; i < count; i++) {
    const shxOff = 100 + i * 8
    if (shxOff + 8 > shx.length) {
      out.push(null)
      continue
    }
    const byteOff = shx.readInt32BE(shxOff) * 2
    if (byteOff + 12 > shp.length) {
      out.push(null)
      continue
    }
    const shapeType = shp.readInt32LE(byteOff + 8)
    if (shapeType === 0) {
      out.push(null)
      continue
    }
    if (shapeType === 1 && byteOff + 28 <= shp.length) {
      out.push([round2(shp.readDoubleLE(byteOff + 12)), round2(shp.readDoubleLE(byteOff + 20))])
      continue
    }
    if ((shapeType === 3 || shapeType === 5) && byteOff + 52 <= shp.length) {
      const xmin = shp.readDoubleLE(byteOff + 12)
      const ymin = shp.readDoubleLE(byteOff + 20)
      const xmax = shp.readDoubleLE(byteOff + 28)
      const ymax = shp.readDoubleLE(byteOff + 36)
      const numParts = shp.readInt32LE(byteOff + 44)
      const numPoints = shp.readInt32LE(byteOff + 48)
      const partsOff = byteOff + 52
      const pointsOff = partsOff + numParts * 4
      if (shapeType === 3 && numPoints > 0 && pointsOff + numPoints * 16 <= shp.length) {
        const pts: [number, number][] = []
        for (let p = 0; p < numPoints; p++) {
          const o = pointsOff + p * 16
          pts.push([round2(shp.readDoubleLE(o)), round2(shp.readDoubleLE(o + 8))])
        }
        out.push(pts.length === 1 ? pts[0]! : pts)
        continue
      }
      /** Polygon 등 → 대표점 */
      out.push([round2((xmin + xmax) / 2), round2((ymin + ymax) / 2)])
      continue
    }
    out.push(null)
  }
  return out
}

function coordsToWkt(coords: ShpCoords, geomKind: 'LineString' | 'Point'): string | null {
  if (!coords) return null
  if (typeof coords[0] === 'number') {
    const [x, y] = coords as [number, number]
    return `POINT(${x} ${y})`
  }
  const pts = coords as [number, number][]
  if (pts.length === 0) return null
  if (geomKind === 'Point' || pts.length === 1) {
    const mid = pts[Math.floor(pts.length / 2)]!
    return `POINT(${mid[0]} ${mid[1]})`
  }
  return `LINESTRING(${pts.map(([x, y]) => `${x} ${y}`).join(', ')})`
}

function readTypeFile(
  shpDir: string,
  spec: (typeof SPF_TYPE_TABLES)[number]
): FacRow[] {
  const typeName = spec.shpFile
  const dbfPath = path.join(shpDir, `${typeName}.dbf`)
  const shpPath = path.join(shpDir, `${typeName}.shp`)
  const shxPath = path.join(shpDir, `${typeName}.shx`)
  if (!fs.existsSync(dbfPath)) {
    console.warn(`[skip] missing ${dbfPath}`)
    return []
  }
  const rawBuf = fs.readFileSync(dbfPath)
  const nrec = rawBuf.readUInt32LE(4)
  const hlen = rawBuf.readUInt16LE(8)
  const rlen = rawBuf.readUInt16LE(10)
  const fields: DbfField[] = []
  let pos = 32
  while (pos < hlen && rawBuf[pos] !== 0x0d) {
    fields.push({
      name: rawBuf.subarray(pos, pos + 11).toString('ascii').split('\0')[0]!.trim(),
      type: String.fromCharCode(rawBuf[pos + 11]!),
      length: rawBuf[pos + 16]!,
    })
    pos += 32
  }
  const geoms = readShpGeoms(shpPath, shxPath, nrec)
  const rows: FacRow[] = []
  for (let i = 0; i < nrec; i++) {
    const rec = rawBuf.subarray(hlen + i * rlen, hlen + (i + 1) * rlen)
    if (!rec.length || rec[0] === 0x2a) continue
    let off = 1
    const row: Record<string, string> = {}
    for (const f of fields) {
      row[f.name] = decodeCp949(rec.subarray(off, off + f.length))
      off += f.length
    }
    const consCode = (row.CONS_CODE || '').trim()
    /** 관리번호 없는 제외 행도 유형 테이블에 둠 */
    rows.push({
      table: spec.table,
      type: spec.type,
      geomKind: spec.geom,
      consCode,
      sisulName: (row.SISUL_NAME || '').trim() || consCode || `${spec.type}_${i + 1}`,
      shpCode: (row.SHP_CODE || '').trim(),
      emd: (row.EMD || '').trim(),
      ri: (row.RI || '').trim(),
      address: (row.ADDRESS || '').trim(),
      startXy: (row.START_XY || '').trim(),
      endXy: (row.END_XY || '').trim(),
      benArea: (row.BEN_AREA || '').trim(),
      riskDate: normalizeDate(row.RISK_DATE || ''),
      candidate: (row.CANDIDATE || '').trim() || (consCode ? '' : '제외'),
      lne: numText(row.LEN || ''),
      width: numText(row.WIDTH || ''),
      hight: numText(row.HIGHT || row.HEIGHT || ''),
      geomWkt: coordsToWkt(geoms[i] ?? null, spec.geom),
      riskScore: parseScore(row.RISK_SCORE || ''),
      survDate: normalizeDate(row.SURV_DATE || ''),
      survName: (row.SURV_NAME || '').trim(),
      riskRank: (row.RISK_RANK || '').trim(),
    })
  }
  console.log(`[read] ${typeName} → ${spec.table}: ${rows.length}`)
  return rows
}

async function main() {
  const project = argValue('--project') || 'ggnr_sy'
  const env = argValue('--env') || 'dev'
  loadProjectEnv(project, env)

  const dataDir = process.env.GGNR_DATA_DIR?.trim() || path.join('g:', 'ggnr_data_dir', 'ggnr_sy')
  const shpDir =
    argValue('--shp')?.trim() || path.join(dataDir, 'file_data', 'small_public', 'shp')
  console.log('[import-spf] project=', project, 'env=', env)
  console.log('[import-spf] shp=', shpDir)

  const byTable = new Map<string, FacRow[]>()
  const seenCons = new Set<string>()
  for (const spec of SPF_TYPE_TABLES) {
    const list: FacRow[] = []
    for (const row of readTypeFile(shpDir, spec)) {
      if (row.consCode) {
        if (seenCons.has(row.consCode)) continue
        seenCons.add(row.consCode)
      }
      list.push(row)
    }
    byTable.set(spec.table, list)
  }
  const all = [...byTable.values()].flat()
  console.log('[import-spf] facilities=', all.length, 'with cons=', seenCons.size)

  const { pool } = await import('../src/database/db')
  const { ensureSpfTables } = await import('../src/service/ensureLayerAppTables')
  await ensureSpfTables()

  const typeTables = SPF_TYPE_TABLES.map((t) => `layer.${t.table}`).join(', ')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `TRUNCATE ${typeTables}, layer.spf_check, layer.spf_report RESTART IDENTITY CASCADE`
    )

    const withCheck = all.filter((r) => r.consCode)
    const yearCounts = new Map<number, number>()
    for (const r of withCheck) {
      const y = Number((r.survDate || '').slice(0, 4)) || 2020
      yearCounts.set(y, (yearCounts.get(y) || 0) + 1)
    }
    const yearToReportId = new Map<number, number>()
    for (const year of [...yearCounts.keys()].sort((a, b) => a - b)) {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO layer.spf_report (year, write_date, title, agency, author, target_count)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [year, `${year}-12-31`, `소규모 공공시설 안전점검 ${year}년`, '', '', yearCounts.get(year) ?? 0]
      )
      yearToReportId.set(year, ins.rows[0]!.id)
      console.log('[import-spf] report', ins.rows[0]!.id, 'year', year, 'n', yearCounts.get(year))
    }

    const BATCH = 80
    for (const spec of SPF_TYPE_TABLES) {
      const rows = byTable.get(spec.table) ?? []
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH)
        const values: unknown[] = []
        const placeholders: string[] = []
        let p = 1
        for (const r of chunk) {
          placeholders.push(
            `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},CASE WHEN $${p}::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromText($${p++}), 5187) END)`
          )
          values.push(
            r.consCode || null,
            r.sisulName,
            r.shpCode || null,
            r.emd,
            r.ri,
            r.address,
            r.startXy,
            r.endXy,
            r.benArea,
            r.riskDate || null,
            r.candidate || null,
            r.lne || null,
            r.width || null,
            r.hight || null,
            r.geomWkt
          )
        }
        if (!placeholders.length) continue
        await client.query(
          `INSERT INTO layer.${spec.table} (
            cons_code, sisul_name, shp_code, emd, ri, address,
            start_xy, end_xy, ben_area, risk_date, candidate, lne, width, hight, geom
          ) VALUES ${placeholders.join(',')}`,
          values
        )
      }
      console.log(`[import-spf] ${spec.table} inserted=`, rows.length)
    }

    for (let i = 0; i < withCheck.length; i += BATCH) {
      const chunk = withCheck.slice(i, i + BATCH)
      const values: unknown[] = []
      const placeholders: string[] = []
      let p = 1
      for (const r of chunk) {
        const year = Number((r.survDate || '').slice(0, 4)) || 2020
        const reportId = yearToReportId.get(year)
        if (reportId == null) continue
        placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`)
        values.push(
          r.consCode,
          reportId,
          r.riskScore,
          r.survDate || null,
          r.survName || null,
          r.riskRank || null,
          r.candidate || null
        )
      }
      if (!placeholders.length) continue
      await client.query(
        `INSERT INTO layer.spf_check (
          cons_code, report_id, risk_score, surv_date, surv_name, risk_rank, candidate
        ) VALUES ${placeholders.join(',')}`,
        values
      )
    }
    console.log('[import-spf] check inserted')
    /** 부모관리번호·부모시설명 — shp에 없음. 읍면·리 추정 매핑 금지(거리·관계 불일치). 비워 둠. */

    await client.query('COMMIT')
    const counts = await pool.query(`
      SELECT r.id, r.year, r.target_count,
             (SELECT count(*)::int FROM layer.spf_check c WHERE c.report_id = r.id) AS linked
      FROM layer.spf_report r ORDER BY r.year
    `)
    console.log('[import-spf] done reports=', counts.rows)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
