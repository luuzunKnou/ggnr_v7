/**
 * 소규모 공공시설 — layer.spf_* DB 우선, 없으면 seed.json / shp·첨부 디스크 시드.
 * 첨부 폴더는 file_data/small_public/{관리번호}. 갱신: import-small-public-shp-to-spf / dump-small-public-seed
 */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import iconv from 'iconv-lite'
import { pool } from '@/database/db'
import { ensureSpfReportExtras } from './ensureLayerAppTables'
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths'
import { withBasePath } from '@/lib/basePath'
import {
  type SmallPublicAttachScope,
  parseSmallPublicScopeDir,
  smallPublicScopeDirName,
} from '@/lib/smallPublicAttachScope'
import { removeScopedAttachmentDir } from '@/lib/smallPublicAttachmentFs'
import {
  SPF_TYPE_TABLES,
  parseSpfFacilityUiId,
  spfFacilityUiId,
  spfTypeTableByName,
  spfTypeTableByType,
} from '@/lib/smallPublicTypeTables'
import { resolveGgnrDataDir, turbopackOpaquePath } from '@/lib/turbopackFsPath'
import {
  SMALL_PUBLIC_CANDIDATES,
  SMALL_PUBLIC_CLASSES,
  SMALL_PUBLIC_FAC_TYPES,
  SMALL_PUBLIC_GRADES,
  type SmallPublicCandidate,
  type SmallPublicClass,
  type SmallPublicFacType,
  type SmallPublicGrade,
} from '@/app/(pages)/map/_mapContents/smallPublic/smallPublicConfig'
import {
  smallPublicCheckFormFor,
  smallPublicCheckGradeOf,
  smallPublicMockCheckValues,
  type SmallPublicCheckForm,
} from '@/app/(pages)/map/_mapContents/smallPublic/smallPublicCheckForms'
import {
  smallPublicClassFormFor,
  smallPublicClassOf,
  smallPublicClassTotal,
  smallPublicMockClassValues,
} from '@/app/(pages)/map/_mapContents/smallPublic/smallPublicClassForms'
import type { SmallPublicCandidateResult } from '@/app/(pages)/map/_mapContents/smallPublic/smallPublicCandidateForms'
import {
  smallPublicReportTitle,
  type SmallPublicInspectionReport,
  type SmallPublicReportRow,
} from '@/app/(pages)/map/_mapContents/smallPublic/inspection/smallPublicInspectionReport'
import type {
  SmallPublicCandidateEval,
  SmallPublicDamageEvent,
  SmallPublicFacility,
  SmallPublicFile,
  SmallPublicFileKind,
  SmallPublicInspection,
  SmallPublicSafetyDoc,
} from '@/app/(pages)/map/_mapContents/smallPublic/smallPublicMock'

import {
  bridgeGroupCodeOfRi,
  bridgeRiOfName,
} from '@/app/(pages)/map/_mapContents/smallPublic/smallPublicBridgeGroup'

export const SMALL_PUBLIC_FILE_LAYER = 'small_public'

const MNG_DIR_RE = /^SSF\d{2}FAC\d{5}$/i

type DbfField = { name: string; type: string; length: number }
type DbfRow = Record<string, string>

function smallPublicRoot(): string {
  return turbopackOpaquePath(path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.smallPublic))
}

function smallPublicShpDir(): string {
  return turbopackOpaquePath(path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.smallPublicShp))
}

function fileUrl(
  mngNo: string,
  fileName: string,
  scope: SmallPublicAttachScope = 'common',
  year?: string | null
): string {
  const qs = new URLSearchParams({ mngNo, name: fileName })
  const y = String(year ?? '').trim()
  if (scope !== 'common' && y) {
    qs.set('scope', scope)
    qs.set('year', y)
  }
  return withBasePath(`/api/small-public/file?${qs.toString()}`)
}

function decodeCp949(buf: Buffer): string {
  return iconv.decode(buf, 'cp949').replace(/\0/g, '').trim()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

type ShpCoords = [number, number] | [number, number][] | null

/** SHP point / polyline 좌표열 / polygon 중심 (EPSG:5187). 인덱스 = DBF 원본 레코드 순. */
function readShpGeoms(shpPath: string, shxPath: string, count: number): ShpCoords[] {
  if (!fsSync.existsSync(shpPath) || !fsSync.existsSync(shxPath)) {
    return Array.from({ length: count }, () => null)
  }
  const shp = fsSync.readFileSync(shpPath)
  const shx = fsSync.readFileSync(shxPath)
  const out: ShpCoords[] = []
  for (let i = 0; i < count; i++) {
    const shxOff = 100 + i * 8
    if (shxOff + 8 > shx.length) {
      out.push(null)
      continue
    }
    const offsetWords = shx.readInt32BE(shxOff)
    const byteOff = offsetWords * 2
    if (byteOff + 12 > shp.length) {
      out.push(null)
      continue
    }
    const shapeType = shp.readInt32LE(byteOff + 8)
    if (shapeType === 0) {
      out.push(null)
      continue
    }
    // Point
    if (shapeType === 1 && byteOff + 28 <= shp.length) {
      out.push([round2(shp.readDoubleLE(byteOff + 12)), round2(shp.readDoubleLE(byteOff + 20))])
      continue
    }
    // Polyline / Polygon — bbox 다음 numParts·numPoints
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
      out.push([round2((xmin + xmax) / 2), round2((ymin + ymax) / 2)])
      continue
    }
    out.push(null)
  }
  return out
}

function asFacType(raw: string, fromFile: string): SmallPublicFacType {
  const t = raw.trim()
  if ((SMALL_PUBLIC_FAC_TYPES as readonly string[]).includes(t)) return t as SmallPublicFacType
  const base = path.basename(fromFile, path.extname(fromFile))
  if ((SMALL_PUBLIC_FAC_TYPES as readonly string[]).includes(base)) return base as SmallPublicFacType
  return '소교량'
}

function asCandidate(raw: string): SmallPublicCandidate {
  const t = raw.trim()
  if ((SMALL_PUBLIC_CANDIDATES as readonly string[]).includes(t)) return t as SmallPublicCandidate
  return '일반'
}

function asClass(raw: string): SmallPublicClass {
  const t = raw.trim()
  if ((SMALL_PUBLIC_CLASSES as readonly string[]).includes(t)) return t as SmallPublicClass
  return '일반'
}

function asGrade(raw: string): SmallPublicGrade {
  const t = raw.trim()
  if ((SMALL_PUBLIC_GRADES as readonly string[]).includes(t)) return t as SmallPublicGrade
  return '보통'
}

function geoJsonToCoords(
  gj: { type?: string; coordinates?: unknown } | null | undefined
): SmallPublicFacility['coords'] {
  if (!gj?.type || gj.coordinates == null) return null
  if (gj.type === 'Point') {
    const c = gj.coordinates as number[]
    if (c.length < 2) return null
    return [round2(c[0]!), round2(c[1]!)]
  }
  if (gj.type === 'LineString') {
    const line = (gj.coordinates as number[][])
      .filter((p) => p.length >= 2)
      .map((p) => [round2(p[0]!), round2(p[1]!)] as [number, number])
    if (line.length === 0) return null
    return line.length === 1 ? line[0]! : line
  }
  if (gj.type === 'MultiLineString') {
    const parts = gj.coordinates as number[][][]
    const first = parts[0] ?? []
    const line = first
      .filter((p) => p.length >= 2)
      .map((p) => [round2(p[0]!), round2(p[1]!)] as [number, number])
    if (line.length === 0) return null
    return line.length === 1 ? line[0]! : line
  }
  if (gj.type === 'Polygon' || gj.type === 'MultiPolygon') {
    const ring =
      gj.type === 'Polygon'
        ? ((gj.coordinates as number[][][])[0] ?? [])
        : ((gj.coordinates as number[][][][])[0]?.[0] ?? [])
    if (ring.length === 0) return null
    let sx = 0
    let sy = 0
    let n = 0
    for (const p of ring) {
      if (p.length < 2) continue
      sx += p[0]!
      sy += p[1]!
      n++
    }
    if (n === 0) return null
    return [round2(sx / n), round2(sy / n)]
  }
  return null
}

function specText(f: Pick<SmallPublicFacility, 'length' | 'width' | 'height'>): string {
  return [
    f.length ? `연장 ${f.length}m` : '',
    f.width ? `폭 ${f.width}m` : '',
    f.height ? `높이 ${f.height}m` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** 목록·시드 전송용 — 양식 본문은 비우고 화면에서 필요 시 채움 */
const SLIM_CHECK_FORM: SmallPublicCheckForm = {
  id: 'slim',
  facType: '소교량',
  version: '',
  effectiveFrom: '1970-01-01',
  stateRange: { A: [0, 3], B: [4, 6], C: [7, 10] },
  gradeRule: [
    { max: 30, grade: '양호' },
    { max: 70, grade: '보통' },
    { grade: '불량' },
  ],
  groups: [],
}

const EMPTY_CHECK_VALUES = {} as ReturnType<typeof smallPublicMockCheckValues>

function gradeFromCheck(
  type: SmallPublicFacType,
  riskRank: string | null | undefined,
  score: number
): SmallPublicGrade {
  const rank = String(riskRank ?? '').trim()
  if (rank) return asGrade(rank)
  return smallPublicCheckGradeOf(smallPublicCheckFormFor(type, '2099-01-01'), score)
}

type FacDbRow = {
  id: number
  cons_code: string | null
  sisul_name: string | null
  shp_code: string | null
  type: string | null
  src_table: string | null
  emd: string | null
  ri: string | null
  address: string | null
  start_xy: string | null
  end_xy: string | null
  ben_area: string | null
  risk_date: string | null
  candidate: string | null
  lne: string | null
  width: string | null
  hight: string | null
  parent_cons_code: string | null
  parent_fac_name: string | null
  gj: { type?: string; coordinates?: unknown } | null
}

function mapFacDbRow(r: FacDbRow): SmallPublicFacility {
  const src = String(r.src_table ?? '').trim() || 'spf_bridge'
  const mngNo = String(r.cons_code ?? '').trim()
  const type = asFacType(r.type || '', r.type || '소교량')
  const candidate = asCandidate(r.candidate || '')
  const id = spfFacilityUiId(mngNo, src, Number(r.id))
  const label = String(r.sisul_name ?? '').trim() || mngNo || '이름없음'
  return {
    id,
    /** 관리번호 없으면 빈 문자열 — 화면에 «없음», excl:… id 는 쓰지 않음 */
    mngNo,
    name: label,
    geomCode: String(r.shp_code ?? '').trim(),
    type,
    emd: String(r.emd ?? '').trim(),
    ri: String(r.ri ?? '').trim(),
    address: String(r.address ?? '').trim(),
    startXy: String(r.start_xy ?? '').trim(),
    endXy: String(r.end_xy ?? '').trim(),
    riskRank: '',
    riskScore: '',
    benefitArea: String(r.ben_area ?? '').trim(),
    riskDate: String(r.risk_date ?? '').trim(),
    surveyDate: '',
    surveyor: '',
    candidate,
    length: String(r.lne ?? '').trim(),
    width: String(r.width ?? '').trim(),
    height: String(r.hight ?? '').trim(),
    parentFacId: String(r.parent_cons_code ?? '').trim() || null,
    parentFacName: String(r.parent_fac_name ?? '').trim(),
    coords: geoJsonToCoords(r.gj),
    planFiles: [],
    damageEvents: [] as SmallPublicDamageEvent[],
    inspectionTarget: candidate === '위험',
  }
}

type CheckDbRow = {
  id: number
  cons_code: string
  report_id: number
  risk_score: number | null
  surv_date: string | null
  surv_name: string | null
  risk_rank: string | null
  candidate: string | null
  remark: string | null
}

function mapCheckDbRowSlim(
  c: CheckDbRow,
  facById: Map<string, SmallPublicFacility>
): SmallPublicInspection {
  const facilityId = String(c.cons_code ?? '').trim()
  const f = facById.get(facilityId)
  const type = f?.type ?? '소교량'
  const score = c.risk_score ?? 0
  return {
    id: String(c.id),
    facilityId,
    date: String(c.surv_date ?? '').trim() || '1970-01-01',
    inspector: String(c.surv_name ?? '').trim(),
    score,
    grade: gradeFromCheck(type, c.risk_rank, score),
    classResult: asClass(c.candidate || ''),
    classEval: null,
    reportId: String(c.report_id),
    remark: String(c.remark ?? '').trim(),
    form: SLIM_CHECK_FORM,
    values: EMPTY_CHECK_VALUES,
    file: null,
    classFile: null,
  }
}

/** 시드·목록 JSON에서 점검 양식 본문을 비움(전송량 축소). 등급·구분은 유지 */
export function stripInspectionPayloadForms(payload: SmallPublicSeedPayload): SmallPublicSeedPayload {
  return {
    ...payload,
    inspections: (payload.inspections ?? []).map((i) => ({
      ...i,
      form: SLIM_CHECK_FORM,
      values: EMPTY_CHECK_VALUES,
      classEval: i.classEval
        ? { form: i.classEval.form, values: {}, total: i.classEval.total }
        : null,
    })),
  }
}

/** 유형 6테이블 UNION — 목록·상세·지도 공통 */
const FAC_UNION_SQL = SPF_TYPE_TABLES.map(
  (t) => `
  SELECT
    '${t.type}'::text AS type,
    '${t.table}'::text AS src_table,
    id, cons_code, sisul_name, shp_code, emd, ri, address,
    start_xy, end_xy, ben_area, risk_date, candidate, lne, width, hight,
    parent_cons_code, parent_fac_name,
    CASE WHEN geom IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(geom)) END AS x,
    CASE WHEN geom IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(geom)) END AS y,
    CASE WHEN geom IS NULL THEN NULL ELSE ST_AsGeoJSON(geom)::json END AS gj
  FROM layer.${t.table}`
).join('\n  UNION ALL\n')

const FAC_SELECT_SQL = `
  SELECT * FROM (
    ${FAC_UNION_SQL}
  ) spf_fac_u
`

async function fetchFacilityByUiId(facilityId: string): Promise<SmallPublicFacility | null> {
  const parsed = parseSpfFacilityUiId(facilityId)
  if (!parsed) return null
  if (parsed.kind === 'cons') {
    const res = await pool.query<FacDbRow>(
      `${FAC_SELECT_SQL} WHERE cons_code = $1 LIMIT 1`,
      [parsed.consCode]
    )
    return res.rows[0] ? mapFacDbRow(res.rows[0]) : null
  }
  const meta = spfTypeTableByName(parsed.table)
  if (!meta) return null
  const res = await pool.query<FacDbRow>(
    `
    SELECT
      '${meta.type}'::text AS type,
      '${meta.table}'::text AS src_table,
      id, cons_code, sisul_name, shp_code, emd, ri, address,
      start_xy, end_xy, ben_area, risk_date, candidate, lne, width, hight,
      parent_cons_code, parent_fac_name,
      CASE WHEN geom IS NULL THEN NULL ELSE ST_AsGeoJSON(geom)::json END AS gj
    FROM layer.${meta.table}
    WHERE id = $1
    LIMIT 1
  `,
    [parsed.localId]
  )
  return res.rows[0] ? mapFacDbRow(res.rows[0]) : null
}

function classifyAttachment(fileName: string): {
  role: 'candidate' | 'risk' | 'class' | 'field' | 'ledger' | 'summary' | 'other'
  kind: SmallPublicFileKind
} {
  const n = fileName.replace(/\.[^.]+$/, '')
  if (/후보지평가/.test(n)) return { role: 'candidate', kind: 'candidate' }
  if (/위험도/.test(n)) return { role: 'risk', kind: 'safety' }
  if (/일반.?관리|구분/.test(n)) return { role: 'class', kind: 'safety' }
  if (/현장조사/.test(n)) return { role: 'field', kind: 'safety' }
  if (/대장/.test(n)) return { role: 'ledger', kind: 'other' }
  if (/요약/.test(n)) return { role: 'summary', kind: 'other' }
  return { role: 'other', kind: 'other' }
}

function makeFile(
  mngNo: string,
  fileName: string,
  kind: SmallPublicFileKind,
  idSuffix: string,
  scope: SmallPublicAttachScope = 'common',
  year?: string | null
): SmallPublicFile {
  const y = String(year ?? '').trim()
  return {
    id: `${mngNo}-${scope === 'common' ? 'root' : `${scope}-${y}`}-${idSuffix}-${fileName}`,
    name: fileName,
    url: fileUrl(mngNo, fileName, scope, y || null),
    kind,
  }
}

/** scope: common=시설 공통(루트), inspection=안전점검_YYYY(예전 YYYY 포함), candidate=후보지_YYYY */
type ListedAttach = { name: string; year: string | null; scope: SmallPublicAttachScope }

/** 루트(시설 공통) + 안전점검_{YYYY}/ · 후보지_{YYYY}/ (예전 {YYYY}/ 는 안전점검) 파일 목록 */
async function listAttachmentEntries(root: string, mngNo: string): Promise<ListedAttach[]> {
  const dir = path.join(root, mngNo)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: ListedAttach[] = []
  for (const e of entries) {
    if (e.isFile() && !e.name.startsWith('.') && !e.name.toLowerCase().endsWith('.tmp')) {
      out.push({ name: e.name, year: null, scope: 'common' })
      continue
    }
    if (!e.isDirectory()) continue
    const parsed = parseSmallPublicScopeDir(e.name)
    if (!parsed) continue
    let yearEntries: import('node:fs').Dirent[]
    try {
      yearEntries = await fs.readdir(path.join(dir, e.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const f of yearEntries) {
      if (!f.isFile() || f.name.startsWith('.') || f.name.toLowerCase().endsWith('.tmp')) continue
      out.push({ name: f.name, year: parsed.year, scope: parsed.scope })
    }
  }
  return out.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope)
    const ya = a.year ?? ''
    const yb = b.year ?? ''
    if (ya !== yb) return ya.localeCompare(yb)
    return a.name.localeCompare(b.name, 'ko')
  })
}

async function listMngAttachmentDirs(root: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && MNG_DIR_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en'))
}

async function listAttachmentFiles(root: string, mngNo: string): Promise<string[]> {
  /** 하위호환 — 이름만. 연도 구분은 listAttachmentEntries 사용 */
  return (await listAttachmentEntries(root, mngNo)).map((e) => e.name)
}

/** dbf는 shp 하위 폴더 우선, 없으면 루트(구버전 호환) */
function pickDbfFiles(root: string, shpDir: string): string[] {
  const from = (dir: string) => {
    if (!fsSync.existsSync(dir)) return [] as string[]
    return fsSync
      .readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith('.dbf'))
      .map((n) => path.join(dir, n))
  }
  const inShp = from(shpDir)
  if (inShp.length > 0) return inShp
  return from(root)
}

type Attached = {
  planFiles: SmallPublicFile[]
  candidateFile: SmallPublicFile | null
  riskFile: SmallPublicFile | null
  classFile: SmallPublicFile | null
  fieldFile: SmallPublicFile | null
  safetyFiles: SmallPublicFile[]
}

function mapAttachments(mngNo: string, entries: ListedAttach[] | string[]): Attached {
  const listed: ListedAttach[] = entries.map((e) =>
    typeof e === 'string' ? { name: e, year: null, scope: 'common' as const } : e
  )
  const planFiles: SmallPublicFile[] = []
  const safetyFiles: SmallPublicFile[] = []
  let candidateFile: SmallPublicFile | null = null
  let riskFile: SmallPublicFile | null = null
  let classFile: SmallPublicFile | null = null
  let fieldFile: SmallPublicFile | null = null
  listed.forEach((entry, i) => {
    const classified = classifyAttachment(entry.name)
    /** 후보지_{연도}/ 폴더의 파일은 이름과 무관하게 후보지 평가 첨부 */
    const role = entry.scope === 'candidate' ? 'candidate' : classified.role
    const kind = entry.scope === 'candidate' ? 'candidate' : classified.kind
    const f = makeFile(mngNo, entry.name, kind, String(i), entry.scope, entry.year)
    if (role === 'candidate') candidateFile = candidateFile ?? f
    else if (role === 'risk') {
      riskFile = f
      safetyFiles.push(f)
    } else if (role === 'class') {
      classFile = f
      safetyFiles.push(f)
    } else if (role === 'field') {
      fieldFile = f
      safetyFiles.push(f)
    } else {
      planFiles.push(f)
    }
  })
  return { planFiles, candidateFile, riskFile, classFile, fieldFile, safetyFiles }
}

/** 연도별 안전점검 첨부(위험도·구분·현장) — 루트에만 있으면 year=null 키. 후보지 폴더는 제외 */
function mapAttachmentsByYear(mngNo: string, entries: ListedAttach[]): Map<string, Attached> {
  const byYear = new Map<string, ListedAttach[]>()
  for (const e of entries) {
    if (e.scope === 'candidate') continue
    const { role } = classifyAttachment(e.name)
    /** 안전점검 연도 폴더는 올린 파일 전부, 루트(구버전)는 안전점검 계열만 */
    if (e.scope === 'common' && role !== 'risk' && role !== 'class' && role !== 'field') continue
    const key = e.year ?? ''
    const list = byYear.get(key) ?? []
    list.push(e)
    byYear.set(key, list)
  }
  const out = new Map<string, Attached>()
  for (const [y, list] of byYear) {
    out.set(y, mapAttachments(mngNo, list))
  }
  return out
}

/** 연도별 후보지 평가 첨부(후보지_{연도}/ 전체) */
function mapCandidateFilesByYear(mngNo: string, entries: ListedAttach[]): Map<string, SmallPublicFile[]> {
  const out = new Map<string, SmallPublicFile[]>()
  entries.forEach((e, i) => {
    if (e.scope !== 'candidate' || !e.year) return
    const list = out.get(e.year) ?? []
    list.push(makeFile(mngNo, e.name, 'candidate', String(i), 'candidate', e.year))
    out.set(e.year, list)
  })
  return out
}

function normalizeDate(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  const m = t.match(/^(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/)
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
  return t
}

function numText(raw: string): string {
  const n = Number(String(raw).replace(/,/g, ''))
  if (!Number.isFinite(n) || n === 0) return raw.trim() === '0' || raw.trim() === '0.00' ? '0' : raw.trim()
  return String(n)
}

type SeedFacility = SmallPublicFacility & { _att: Attached }

function buildInspections(facilities: SeedFacility[]): SmallPublicInspection[] {
  const out: SmallPublicInspection[] = []
  facilities.forEach((f, idx) => {
    if (f.candidate === '제외') return
    const target = f.candidate === '위험' || f.candidate === '관리' || f.candidate === '일반' ? f.candidate : '일반'
    const classForm = smallPublicClassFormFor(f.type)
    const base = Number(f.riskScore)
    if (!f.surveyDate || !Number.isFinite(base)) return
    const push = (date: string, score: number, inspector: string, withClass: boolean) => {
      const form = smallPublicCheckFormFor(f.type, date)
      const cap = target === '위험' ? 100 : 68
      const values = smallPublicMockCheckValues(form, Math.max(0, Math.min(cap, Math.round(score))))
      const total = Object.values(values).reduce((n, v) => n + v.score, 0)
      const grade = smallPublicCheckGradeOf(form, total)
      const classValues = withClass ? smallPublicMockClassValues(classForm, f.name, target, grade, f.length, idx) : null
      const classResult = classValues
        ? smallPublicClassOf(classForm, classValues, grade, target === '위험' ? '위험' : null)
        : target
      out.push({
        id: `${f.id}-${date}`,
        facilityId: f.id,
        date,
        inspector,
        score: total,
        grade,
        classResult,
        classEval: classValues
          ? { form: classForm, values: classValues, total: smallPublicClassTotal(classForm, classValues) }
          : null,
        remark: grade === '불량' ? '통수단면 부족, 구조물 파손' : grade === '보통' ? '부분 퇴적·마모, 정기 관리 필요' : '',
        form,
        values,
        file: f._att.riskFile,
        classFile: withClass ? f._att.classFile : null,
        reportId: date.startsWith('2025') ? 'report-sample-2025' : date.startsWith('2026') ? 'report-sample-2026' : null,
      })
    }
    push(f.surveyDate, base, f.surveyor || '조사자', Boolean(f._att.classFile) || idx % 2 === 0)
    /** 2025년 정기점검 — 시연용으로 대상 전원 완료(100%) */
    push(`2025-03-${String(10 + (idx % 18)).padStart(2, '0')}`, base + ((idx % 5) - 1), '울진군 건설과', true)
    if (idx % 3 === 0) {
      push(
        `2026-03-${String(12 + (idx % 14)).padStart(2, '0')}`,
        base + ((idx % 4) - 1),
        '울진군 건설과',
        Boolean(f._att.classFile)
      )
    }
  })
  return out
}

function buildCandidateEvals(facilities: SeedFacility[]): SmallPublicCandidateEval[] {
  return facilities.map((f) => ({
    id: `ce-${f.id}-1`,
    facilityId: f.id,
    date: f.surveyDate || '2019-12-31',
    evaluator: f.surveyor || '정비계획 용역',
    result: f.candidate === '제외' ? '선정제외' : '선정',
    remark: f.candidate === '제외' ? '사유지 분쟁 지역' : '',
    file: f._att.candidateFile,
  }))
}

function buildSafetyDocs(facilities: SeedFacility[]): SmallPublicSafetyDoc[] {
  return facilities
    .filter((f) => f._att.safetyFiles.length > 0)
    .map((f) => ({
      id: `sd-${f.id}-1`,
      facilityId: f.id,
      date: f.surveyDate || '2019-12-31',
      person: f.surveyor || '울진군 건설과',
      remark: '전산화 첨부(위험도·현장조사·구분평가)',
      includes: {
        risk: Boolean(f._att.riskFile),
        field: Boolean(f._att.fieldFile),
        class: Boolean(f._att.classFile),
      },
      files: f._att.safetyFiles,
    }))
}

/** 화면 확인용 — 갈면리 세천 001·002 */
const DEMO_GAL = {
  gal001: 'SSF01FAC00579', // 갈면리_세천_001
  gal002: 'SSF01FAC00580', // 갈면리_세천_002
} as const

/**
 * 정비계획 이관 확인용 — 2025까지 관리, 2026 점검에서 위험으로 바뀜.
 * (보고서 prevClass≠위험 + 올해 점검=위험 → 이관 목록. 새로고침 시 시드 원복)
 */
const DEMO_TRANSFER: {
  mngNo: string
  label: string
  surveyScore: number
  y2025Score: number
  y2026Score: number
  y2026Date: string
  damage: SmallPublicDamageEvent[]
}[] = [
  {
    mngNo: 'SSF04FAC01621',
    label: '황보리_소교량_030',
    surveyScore: 52,
    y2025Score: 58,
    y2026Score: 74,
    y2026Date: '2026-03-12',
    damage: [
      { id: 'de-SSF04FAC01621-1', occurredOn: '2023-08-12', itemCode: 'HOUSE_FLOOD', qty: 2, overrideSupportIndex: null, note: '호우 침수' },
      { id: 'de-SSF04FAC01621-2', occurredOn: '2023-08-12', itemCode: 'TENANT_AID', qty: 1, overrideSupportIndex: null },
    ],
  },
  {
    mngNo: 'SSF14FAC00283',
    label: '금매리_소교량_013',
    surveyScore: 48,
    y2025Score: 55,
    y2026Score: 72,
    y2026Date: '2026-03-14',
    damage: [
      { id: 'de-SSF14FAC00283-1', occurredOn: '2022-09-01', itemCode: 'HOUSE_HALF_LT66', qty: 1, overrideSupportIndex: null },
      { id: 'de-SSF14FAC00283-2', occurredOn: '2024-07-18', itemCode: 'HOUSE_FLOOD', qty: 1, overrideSupportIndex: null, note: '재해 재발' },
    ],
  },
  {
    mngNo: 'SSF01FAC00505',
    label: '매화리_세천_003',
    surveyScore: 50,
    y2025Score: 56,
    y2026Score: 76,
    y2026Date: '2026-03-20',
    damage: [
      { id: 'de-SSF01FAC00505-1', occurredOn: '2021-09-05', itemCode: 'HOUSE_FLOOD', qty: 3, overrideSupportIndex: null, note: '침수 다수' },
      { id: 'de-SSF01FAC00505-2', occurredOn: '2021-09-05', itemCode: 'TENANT_AID', qty: 2, overrideSupportIndex: null },
      { id: 'de-SSF01FAC00505-3', occurredOn: '2023-08-10', itemCode: 'HOUSE_FLOOD', qty: 2, overrideSupportIndex: null },
      { id: 'de-SSF01FAC00505-4', occurredOn: '2023-08-10', itemCode: 'INJURY_8_14', qty: 1, overrideSupportIndex: null },
    ],
  },
  {
    mngNo: 'SSF14FAC00293',
    label: '선구리_소교량_055',
    surveyScore: 54,
    y2025Score: 60,
    y2026Score: 78,
    y2026Date: '2026-03-15',
    damage: [
      { id: 'de-SSF14FAC00293-1', occurredOn: '2023-07-20', itemCode: 'HOUSE_FLOOD', qty: 1, overrideSupportIndex: null },
      { id: 'de-SSF14FAC00293-2', occurredOn: '2023-07-20', itemCode: 'INJURY_8_14', qty: 1, overrideSupportIndex: null },
    ],
  },
  {
    mngNo: 'SSF01FAC00593',
    label: '직산리_세천_002',
    surveyScore: 46,
    y2025Score: 52,
    y2026Score: 71,
    y2026Date: '2026-03-18',
    damage: [
      { id: 'de-SSF01FAC00593-1', occurredOn: '2022-08-25', itemCode: 'HOUSE_FLOOD', qty: 2, overrideSupportIndex: null },
      { id: 'de-SSF01FAC00593-2', occurredOn: '2024-08-03', itemCode: 'HOUSE_FLOOD', qty: 1, overrideSupportIndex: null, note: '피해이력지수' },
    ],
  },
  {
    mngNo: 'SSF04FAC00150',
    label: '삼율리_소교량_014',
    surveyScore: 51,
    y2025Score: 57,
    y2026Score: 73,
    y2026Date: '2026-03-17',
    damage: [
      { id: 'de-SSF04FAC00150-1', occurredOn: '2023-09-02', itemCode: 'HOUSE_HALF_LT66', qty: 1, overrideSupportIndex: null, note: '반파' },
      { id: 'de-SSF04FAC00150-2', occurredOn: '2023-09-02', itemCode: 'TENANT_AID', qty: 1, overrideSupportIndex: null },
    ],
  },
]

const DEMO_TRANSFER_IDS = new Set(DEMO_TRANSFER.map((d) => d.mngNo))
const DEMO_IDS = new Set<string>([DEMO_GAL.gal001, DEMO_GAL.gal002, ...DEMO_TRANSFER_IDS])

function pushInspection(
  out: SmallPublicInspection[],
  f: SeedFacility,
  opts: {
    date: string
    score: number
    inspector: string
    classResult: SmallPublicClass
    withClass: boolean
    reportId?: string | null
    remark?: string
  }
) {
  const form = smallPublicCheckFormFor(f.type, opts.date)
  const values = smallPublicMockCheckValues(form, Math.max(0, Math.min(100, Math.round(opts.score))))
  const total = Object.values(values).reduce((n, v) => n + v.score, 0)
  const grade = smallPublicCheckGradeOf(form, total)
  const classForm = smallPublicClassFormFor(f.type)
  const classValues = opts.withClass
    ? smallPublicMockClassValues(classForm, f.name, opts.classResult, grade, f.length, 0)
    : null
  const classResult = classValues
    ? smallPublicClassOf(classForm, classValues, grade, opts.classResult === '위험' ? '위험' : null)
    : opts.classResult
  out.push({
    id: `${f.id}-${opts.date}-demo`,
    facilityId: f.id,
    date: opts.date,
    inspector: opts.inspector,
    score: total,
    grade,
    classResult,
    classEval: classValues
      ? { form: classForm, values: classValues, total: smallPublicClassTotal(classForm, classValues) }
      : null,
    remark:
      opts.remark ??
      (grade === '불량' ? '통수단면 부족, 구조물 파손' : grade === '보통' ? '부분 퇴적·마모, 정기 관리 필요' : ''),
    form,
    values,
    file: f._att.riskFile,
    classFile: opts.withClass ? f._att.classFile : null,
    reportId: opts.reportId ?? null,
  })
}

/**
 * 갈면리 001·002 + 이관 대상 6곳 — 안전점검·후보지·피해이력 시나리오.
 * 이관 대상: 2025까지 관리 → 2026 위험(새로고침 시 시드로 원복).
 */
function applyDemoScenarios(
  facilities: SeedFacility[],
  inspections: SmallPublicInspection[],
  candidateEvals: SmallPublicCandidateEval[],
  safetyDocs: SmallPublicSafetyDoc[]
): {
  facilities: SeedFacility[]
  inspections: SmallPublicInspection[]
  candidateEvals: SmallPublicCandidateEval[]
  safetyDocs: SmallPublicSafetyDoc[]
} {
  const transferByMng = new Map(DEMO_TRANSFER.map((d) => [d.mngNo, d]))
  const nextFac = facilities.map((f) => {
    if (f.mngNo === DEMO_GAL.gal001) {
      return {
        ...f,
        candidate: '일반' as const,
        inspectionTarget: false,
        damageEvents: [
          { id: `de-${f.mngNo}-1`, occurredOn: '2022-08-18', itemCode: 'HOUSE_FLOOD', qty: 2, overrideSupportIndex: null, note: '집중호우로 인근 주택 침수' },
          { id: `de-${f.mngNo}-2`, occurredOn: '2022-08-18', itemCode: 'TENANT_AID', qty: 1, overrideSupportIndex: null },
          { id: `de-${f.mngNo}-3`, occurredOn: '2024-07-22', itemCode: 'HOUSE_FLOOD', qty: 1, overrideSupportIndex: null, note: '재해 재발 — 피해이력지수 확인용' },
        ],
      }
    }
    if (f.mngNo === DEMO_GAL.gal002) {
      return {
        ...f,
        candidate: '관리' as const,
        inspectionTarget: false,
        damageEvents: [
          { id: `de-${f.mngNo}-1`, occurredOn: '2023-07-15', itemCode: 'HOUSE_HALF_LT66', qty: 1, overrideSupportIndex: null, note: '반파 1동' },
          { id: `de-${f.mngNo}-2`, occurredOn: '2023-07-15', itemCode: 'INJURY_8_14', qty: 1, overrideSupportIndex: null },
        ],
      }
    }
    const xfer = transferByMng.get(f.mngNo)
    if (xfer) {
      // 이관 직전 상태: 관리. 2026 점검 반영 후 sync 로 위험으로 바뀜
      return {
        ...f,
        candidate: '관리' as const,
        riskRank: '보통',
        inspectionTarget: false,
        damageEvents: xfer.damage,
      }
    }
    return f
  })

  const nextInsp = inspections.filter((i) => !DEMO_IDS.has(i.facilityId))
  const nextCe = candidateEvals.filter((e) => !DEMO_IDS.has(e.facilityId))
  const nextSd = safetyDocs.filter((d) => !DEMO_IDS.has(d.facilityId))

  const gal1 = nextFac.find((x) => x.mngNo === DEMO_GAL.gal001)
  if (gal1) {
    pushInspection(nextInsp, gal1, {
      date: gal1.surveyDate || '2019-12-12',
      score: 27,
      inspector: gal1.surveyor || '정비계획 용역',
      classResult: '일반',
      withClass: true,
      remark: '최초 현장조사 — 양호',
    })
    pushInspection(nextInsp, gal1, {
      date: '2025-03-14',
      score: 32,
      inspector: '울진군 건설과',
      classResult: '일반',
      withClass: true,
      reportId: 'report-sample-2025',
    })
    pushInspection(nextInsp, gal1, {
      date: '2026-03-11',
      score: 38,
      inspector: '울진군 건설과',
      classResult: '일반',
      withClass: true,
      reportId: 'report-sample-2026',
      remark: '퇴적 소폭 증가, 일반시설 유지',
    })
    nextCe.push(
      {
        id: `ce-${gal1.id}-1`,
        facilityId: gal1.id,
        date: gal1.surveyDate || '2019-12-12',
        evaluator: gal1.surveyor || '정비계획 용역',
        result: '선정',
        remark: '갈면리 세천 001 — 후보지 선정',
        file: gal1._att.candidateFile,
      },
      {
        id: `ce-${gal1.id}-2`,
        facilityId: gal1.id,
        date: '2024-06-20',
        evaluator: '울진군 건설과',
        result: '선정',
        remark: '보완 조사 후 선정 유지',
        file: gal1._att.candidateFile,
      }
    )
    if (gal1._att.safetyFiles.length) {
      nextSd.push({
        id: `sd-${gal1.id}-1`,
        facilityId: gal1.id,
        date: gal1.surveyDate || '2019-12-12',
        person: gal1.surveyor || '울진군 건설과',
        remark: '최초 현장조사·위험도·구분평가',
        includes: { risk: true, field: true, class: true },
        files: gal1._att.safetyFiles,
      })
    }
  }

  const gal2 = nextFac.find((x) => x.mngNo === DEMO_GAL.gal002)
  if (gal2) {
    pushInspection(nextInsp, gal2, {
      date: gal2.surveyDate || '2019-12-12',
      score: 44,
      inspector: gal2.surveyor || '정비계획 용역',
      classResult: '일반',
      withClass: true,
    })
    pushInspection(nextInsp, gal2, {
      date: '2025-03-18',
      score: 55,
      inspector: '울진군 건설과',
      classResult: '관리',
      withClass: true,
      reportId: 'report-sample-2025',
      remark: '퇴적·법면 마모 — 관리시설로 상향',
    })
    pushInspection(nextInsp, gal2, {
      date: '2026-03-16',
      score: 58,
      inspector: '울진군 건설과',
      classResult: '관리',
      withClass: true,
      reportId: 'report-sample-2026',
    })
    nextCe.push({
      id: `ce-${gal2.id}-1`,
      facilityId: gal2.id,
      date: gal2.surveyDate || '2019-12-12',
      evaluator: gal2.surveyor || '정비계획 용역',
      result: '선정',
      remark: '갈면리 세천 002 — 후보지 선정',
      file: gal2._att.candidateFile,
    })
    if (gal2._att.safetyFiles.length) {
      nextSd.push({
        id: `sd-${gal2.id}-1`,
        facilityId: gal2.id,
        date: gal2.surveyDate || '2019-12-12',
        person: gal2.surveyor || '울진군 건설과',
        remark: '전산화 첨부 + 관리시설 시나리오',
        includes: { risk: true, field: true, class: true },
        files: gal2._att.safetyFiles,
      })
    }
  }

  for (const spec of DEMO_TRANSFER) {
    const f = nextFac.find((x) => x.mngNo === spec.mngNo)
    if (!f) continue
    pushInspection(nextInsp, f, {
      date: f.surveyDate || '2020-09-01',
      score: spec.surveyScore,
      inspector: f.surveyor || '정비계획 용역',
      classResult: '관리',
      withClass: true,
      remark: `${spec.label} — 최초 조사(관리)`,
    })
    pushInspection(nextInsp, f, {
      date: '2025-03-25',
      score: spec.y2025Score,
      inspector: '울진군 건설과',
      classResult: '관리',
      withClass: true,
      reportId: 'report-sample-2025',
      remark: '2025년 정기점검 — 관리시설 유지',
    })
    pushInspection(nextInsp, f, {
      date: spec.y2026Date,
      score: spec.y2026Score,
      inspector: '울진군 건설과',
      classResult: '위험',
      withClass: false,
      reportId: 'report-sample-2026',
      remark: '2026년 점검 — 위험시설 전환(정비계획 이관 테스트)',
    })
    nextCe.push({
      id: `ce-${f.id}-1`,
      facilityId: f.id,
      date: f.surveyDate || '2020-09-01',
      evaluator: f.surveyor || '정비계획 용역',
      result: '선정',
      remark: `${spec.label} — 후보지 선정`,
      file: f._att.candidateFile,
    })
    if (f._att.safetyFiles.length) {
      nextSd.push(
        {
          id: `sd-${f.id}-1`,
          facilityId: f.id,
          date: f.surveyDate || '2020-09-01',
          person: f.surveyor || '울진군 건설과',
          remark: '전산화 첨부',
          includes: { risk: true, field: Boolean(f._att.fieldFile), class: Boolean(f._att.classFile) },
          files: f._att.safetyFiles,
        },
        {
          id: `sd-${f.id}-2`,
          facilityId: f.id,
          date: spec.y2026Date,
          person: '울진군 건설과',
          remark: '2026년 위험 전환 점검',
          includes: { risk: true, field: false, class: false },
          files: f._att.riskFile ? [f._att.riskFile] : [],
        }
      )
    }
  }

  return { facilities: nextFac, inspections: nextInsp, candidateEvals: nextCe, safetyDocs: nextSd }
}

/**
 * 2025년 보고서 대상인데 해당 연도 점검이 없으면 채워 시연 완료율 100%를 맞춘다.
 * (조사일·점수 없어 buildInspections 에서 빠진 시설 등)
 */
function ensureYear2025Complete(
  facilities: SeedFacility[],
  inspections: SmallPublicInspection[]
): SmallPublicInspection[] {
  const reportId = 'report-sample-2025'
  const covered = new Set(inspections.filter((i) => i.reportId === reportId).map((i) => i.facilityId))
  const out = [...inspections]
  facilities.forEach((f, idx) => {
    if (f.candidate === '제외' || covered.has(f.id)) return
    if (f.candidate !== '일반' && f.candidate !== '관리' && f.candidate !== '위험') return
    const score = Number(f.riskScore)
    pushInspection(out, f, {
      date: `2025-04-${String(1 + (idx % 28)).padStart(2, '0')}`,
      score: Number.isFinite(score) ? score : 50,
      inspector: '울진군 건설과',
      classResult: f.candidate === '위험' ? '위험' : f.candidate === '관리' ? '관리' : '일반',
      withClass: f.candidate !== '위험',
      reportId,
      remark: '2025년 정기점검',
    })
  })
  return out
}

export type SmallPublicSeedPayload = {
  facilities: SmallPublicFacility[]
  inspections: SmallPublicInspection[]
  candidateEvals: SmallPublicCandidateEval[]
  safetyDocs: SmallPublicSafetyDoc[]
  /** DB spf_report 기준. 없으면 화면에서 예시 보고서를 만든다 */
  reports?: SmallPublicInspectionReport[]
  source: {
    root: string
    shpDir: string
    dbfFiles: string[]
    attachmentDirs: number
    matched: number
    fromJson?: string
    fromDb?: boolean
    /** 후보지 목록 API — 최근 점검만 */
    listOnly?: boolean
  }
}

/**
 * 유형별 후보지·spf_check·spf_report·spf_eval → 화면 시드.
 * 첨부 PDF는 file_data/small_public/{관리번호} 가 있을 때만 붙인다.
 */
export async function loadFromDb(): Promise<SmallPublicSeedPayload | null> {
  let facCount = 0
  try {
    const parts = SPF_TYPE_TABLES.map((t) => `SELECT count(*)::int AS n FROM layer.${t.table}`)
    const cnt = await pool.query<{ n: number }>(
      `SELECT COALESCE(SUM(n),0)::int AS n FROM (${parts.join(' UNION ALL ')}) s`
    )
    facCount = cnt.rows[0]?.n ?? 0
  } catch {
    return null
  }
  if (facCount <= 0) return null

  const root = smallPublicRoot()
  /* 첨부 폴더 전수 스캔은 수천 회 disk I/O로 초기 로딩이 느려져 생략 — 상세에서 필요 시 별도 로드 */

  const facRes = await pool.query<FacDbRow>(`
    ${FAC_SELECT_SQL}
    ORDER BY cons_code NULLS LAST, id
  `)

  const checkRes = await pool.query<CheckDbRow>(`
    SELECT id, cons_code, report_id, risk_score, surv_date, surv_name, risk_rank, candidate, remark
    FROM layer.spf_check
    ORDER BY surv_date DESC NULLS LAST, id DESC
  `)

  const reportRes = await pool.query<{
    id: number
    year: number
    write_date: string | null
    title: string | null
    agency: string | null
    author: string | null
    target_count: number | null
  }>(`
    SELECT id, year, write_date, title, agency, author, target_count
    FROM layer.spf_report
    ORDER BY year DESC, id DESC
  `)

  const evalRes = await pool.query<{
    id: number
    cons_code: string | null
    eval_date: string | null
    evaluator: string | null
    result: string | null
    remark: string | null
  }>(`
    SELECT id, cons_code, eval_date, evaluator, result, remark
    FROM layer.spf_eval
    ORDER BY eval_date DESC NULLS LAST, id DESC
  `).catch(() => ({ rows: [] as Array<{
    id: number
    cons_code: string | null
    eval_date: string | null
    evaluator: string | null
    result: string | null
    remark: string | null
  }> }))

  const facilities: SmallPublicFacility[] = facRes.rows.map(mapFacDbRow)
  const facById = new Map(facilities.map((f) => [f.id, f]))
  const inspections: SmallPublicInspection[] = checkRes.rows.map((c) => mapCheckDbRowSlim(c, facById))

  const candidateEvals: SmallPublicCandidateEval[] = evalRes.rows.map((e) => {
    const facilityId = String(e.cons_code ?? '').trim()
    const resultRaw = String(e.result ?? '').trim()
    const result: SmallPublicCandidateResult = resultRaw.includes('제외') ? '선정제외' : '선정'
    return {
      id: String(e.id),
      facilityId,
      date: String(e.eval_date ?? '').trim() || '1970-01-01',
      evaluator: String(e.evaluator ?? '').trim(),
      result,
      remark: String(e.remark ?? '').trim(),
      file: null,
    }
  })

  const reports: SmallPublicInspectionReport[] = reportRes.rows.map((r) => {
    const reportId = String(r.id)
    const year = Number(r.year)
    const baseDate = String(r.write_date ?? '').trim() || `${year}-12-31`
    const rows: SmallPublicReportRow[] = inspections
      .filter((i) => i.reportId === reportId)
      .map((i) => {
        const f = facById.get(i.facilityId)
        if (!f) return null
        return {
          facilityId: f.id,
          mngNo: f.mngNo,
          name: f.name,
          type: f.type,
          emd: f.emd,
          ri: f.ri,
          address: f.address,
          spec: specText(f),
          prevClass: asCandidate(i.classResult),
          prevDate: i.date,
        } satisfies SmallPublicReportRow
      })
      .filter((x): x is SmallPublicReportRow => x != null)
      .sort(
        (a, b) =>
          a.emd.localeCompare(b.emd, 'ko') ||
          a.type.localeCompare(b.type, 'ko') ||
          a.name.localeCompare(b.name, 'ko')
      )
    return {
      id: reportId,
      year,
      baseDate,
      title: String(r.title ?? '').trim() || smallPublicReportTitle(year),
      agency: String(r.agency ?? '').trim(),
      author: String(r.author ?? '').trim(),
      summary: '',
      createdAt: `${baseDate}T00:00:00`,
      rows,
      sample: false,
    }
  })

  return {
    facilities,
    inspections,
    candidateEvals,
    safetyDocs: [],
    reports,
    source: {
      root,
      shpDir: smallPublicShpDir(),
      dbfFiles: [],
      attachmentDirs: 0,
      matched: facilities.length,
      fromDb: true,
    },
  }
}

/** 후보지 목록 한 줄 — 화면에서 Facility·최근점검 스텁으로 펼침(전송량 최소화) */
export type SmallPublicListRow = {
  id: string
  mngNo: string
  name: string
  type: SmallPublicFacType
  emd: string
  ri: string
  /** DB 시설 구분(평가 제외 반영 전) */
  candidate: SmallPublicCandidate
  x: number | null
  y: number | null
  /** 지도용 좌표(점 또는 선). 없으면 x·y 사용 */
  coords?: SmallPublicFacility['coords']
  /** 최근 점검 — 없으면 빈 문자열 */
  grade: SmallPublicGrade | ''
  classResult: SmallPublicClass | ''
  inspId: string
  inspDate: string
  /** 최근 평가가 선정제외면 true */
  evalExcluded: boolean
}

export type SmallPublicListPayload = {
  success: true
  rows: SmallPublicListRow[]
  total: number
  page: number
  pageSize: number
  emdOptions: string[]
}

function mapListDbRow(r: {
  id: number
  cons_code: string | null
  sisul_name: string | null
  type: string | null
  src_table?: string | null
  emd: string | null
  ri: string | null
  candidate: string | null
  x: number | null
  y: number | null
  gj?: FacDbRow['gj']
  insp_id: number | null
  surv_date: string | null
  risk_rank: string | null
  risk_score: number | null
  class_result: string | null
  eval_excluded: boolean | null
}): SmallPublicListRow {
  const src = String(r.src_table ?? '').trim() || 'spf_bridge'
  const mngNo = String(r.cons_code ?? '').trim()
  const id = spfFacilityUiId(mngNo, src, Number(r.id))
  const type = asFacType(r.type || '', r.type || '소교량')
  const score = r.risk_score ?? 0
  const hasInsp = r.insp_id != null
  const fromGj = r.gj ? geoJsonToCoords(r.gj) : null
  return {
    id,
    mngNo,
    name: String(r.sisul_name ?? '').trim() || mngNo || '이름없음',
    type,
    emd: String(r.emd ?? '').trim(),
    ri: String(r.ri ?? '').trim(),
    candidate: asCandidate(r.candidate || ''),
    x: r.x != null && Number.isFinite(Number(r.x)) ? round2(Number(r.x)) : null,
    y: r.y != null && Number.isFinite(Number(r.y)) ? round2(Number(r.y)) : null,
    coords: fromGj,
    grade: hasInsp ? gradeFromCheck(type, r.risk_rank, score) : '',
    classResult: hasInsp ? asClass(r.class_result || '') : '',
    inspId: hasInsp ? String(r.insp_id) : '',
    inspDate: hasInsp ? String(r.surv_date ?? '').trim() || '1970-01-01' : '',
    evalExcluded: Boolean(r.eval_excluded),
  }
}

function emdOptionsSql(): string {
  return SPF_TYPE_TABLES.map(
    (t) => `
    SELECT DISTINCT emd FROM layer.${t.table}
    WHERE emd IS NOT NULL AND btrim(emd) <> ''`
  ).join('\nUNION\n')
}

/** 화면 구분 = 평가제외 → 제외, 아니면 최근점검 구분, 없으면 시설 candidate */
const FAC_LIST_DISPLAY_CLASS_EXPR = `
  CASE
    WHEN e.result IS NOT NULL AND e.result LIKE '%제외%' THEN '제외'
    WHEN c.candidate IS NOT NULL AND btrim(c.candidate::text) <> '' THEN btrim(c.candidate::text)
    ELSE COALESCE(NULLIF(btrim(COALESCE(f.candidate::text, '')), ''), '일반')
  END`

function buildFacListFilter(params?: {
  type?: string
  candidate?: string
  emd?: string
  keyword?: string
}): { where: string[]; args: unknown[]; joinSql: string } {
  const type = String(params?.type ?? '').trim()
  const candidate = String(params?.candidate ?? '').trim()
  const emd = String(params?.emd ?? '').trim()
  const keyword = String(params?.keyword ?? '').trim()
  const where: string[] = ['1=1']
  const args: unknown[] = []
  const add = (sqlFrag: string, value: unknown) => {
    args.push(value)
    where.push(sqlFrag.replace('?', `$${args.length}`))
  }
  if (type) add('f.type = ?', type)
  if (emd) add('f.emd = ?', emd)
  if (keyword) {
    args.push(`%${keyword}%`)
    const p = `$${args.length}`
    /** 레이어설정 show_search + 관리번호(매핑키) */
    where.push(
      `(f.sisul_name ILIKE ${p} OR f.cons_code ILIKE ${p} OR COALESCE(f.ri,'') ILIKE ${p} OR COALESCE(f.emd,'') ILIKE ${p} OR COALESCE(f.address,'') ILIKE ${p} OR COALESCE(f.ben_area,'') ILIKE ${p} OR COALESCE(f.risk_date,'') ILIKE ${p})`
    )
  }
  if (candidate) {
    args.push(candidate)
    where.push(`(${FAC_LIST_DISPLAY_CLASS_EXPR}) = $${args.length}`)
  }
  /**
   * 최근 점검·평가는 관리번호별 1건씩 한 번에 모은 뒤 해시 조인한다.
   * (행마다 LATERAL 로 찾으면 spf_eval 에 인덱스가 없을 때 6천 행 × 전체 스캔이 된다)
   */
  const joinSql = `
      FROM (
        ${FAC_UNION_SQL}
      ) f
      LEFT JOIN (
        SELECT DISTINCT ON (cons_code) id, cons_code, surv_date, risk_rank, risk_score, candidate
        FROM layer.spf_check
        WHERE cons_code IS NOT NULL AND btrim(cons_code) <> ''
        ORDER BY cons_code, surv_date DESC NULLS LAST, id DESC
      ) c ON c.cons_code = f.cons_code
      LEFT JOIN (
        SELECT DISTINCT ON (cons_code) cons_code, result
        FROM layer.spf_eval
        WHERE cons_code IS NOT NULL AND btrim(cons_code) <> ''
        ORDER BY cons_code, eval_date DESC NULLS LAST, id DESC
      ) e ON e.cons_code = f.cons_code
      WHERE ${where.join(' AND ')}
    `
  return { where, args, joinSql }
}

/**
 * 후보지 목록 — 메모처럼 서버 페이지·필터만 반환(전체 JSON dump 없음).
 */
export async function listFacilities(params?: {
  page?: number
  pageSize?: number
  type?: string
  candidate?: string
  emd?: string
  keyword?: string
}): Promise<SmallPublicListPayload | { success: false; error: string }> {
  try {
    const pageSize = Math.min(200, Math.max(1, Number(params?.pageSize) || 100))
    const page = Math.max(1, Number(params?.page) || 1)
    const offset = (page - 1) * pageSize
    const { args, joinSql } = buildFacListFilter(params)

    const countRes = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n ${joinSql}`,
      args
    )
    const total = countRes.rows[0]?.n ?? 0

    args.push(pageSize)
    const lim = `$${args.length}`
    args.push(offset)
    const off = `$${args.length}`

    const res = await pool.query(
      `
      SELECT
        f.id,
        f.cons_code,
        f.sisul_name,
        f.type,
        f.src_table,
        f.emd,
        f.ri,
        f.candidate,
        f.x,
        f.y,
        c.id AS insp_id,
        c.surv_date,
        c.risk_rank,
        c.risk_score,
        c.candidate AS class_result,
        (e.result IS NOT NULL AND e.result LIKE '%제외%') AS eval_excluded
      ${joinSql}
      ORDER BY CASE WHEN (${FAC_LIST_DISPLAY_CLASS_EXPR}) = '제외' THEN 1 ELSE 0 END,
               f.sisul_name NULLS LAST, f.id
      LIMIT ${lim} OFFSET ${off}
    `,
      args
    )

    const emdRes = await pool.query<{ emd: string }>(`
      SELECT DISTINCT emd FROM (${emdOptionsSql()}) e
      ORDER BY emd
    `)

    return {
      success: true,
      rows: res.rows.map((r) => mapListDbRow(r as Parameters<typeof mapListDbRow>[0])),
      total,
      page,
      pageSize,
      emdOptions: emdRes.rows.map((r) => String(r.emd ?? '').trim()).filter(Boolean),
    }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 지도에서 고른 시설이 목록 몇 페이지인지 — listFacilities 와 동일 필터·정렬.
 * 구분·검색에 걸려 없으면 found=false (호출측에서 필터를 풀고 다시 찾을 수 있음).
 */
export async function locateFacilityListPage(params?: {
  facilityId?: string
  pageSize?: number
  type?: string
  candidate?: string
  emd?: string
  keyword?: string
}): Promise<{ success: true; page: number; found: boolean } | { success: false; error: string }> {
  try {
    const facilityId = String(params?.facilityId ?? '').trim()
    const parsed = parseSpfFacilityUiId(facilityId)
    if (!parsed) return { success: false, error: 'facilityId가 필요합니다.' }
    const pageSize = Math.min(200, Math.max(1, Number(params?.pageSize) || 100))
    const { args, joinSql } = buildFacListFilter(params)
    let whereId: string
    if (parsed.kind === 'cons') {
      args.push(parsed.consCode)
      whereId = `cons_code = $${args.length}`
    } else {
      args.push(parsed.table)
      args.push(parsed.localId)
      whereId = `src_table = $${args.length - 1} AND id = $${args.length}`
    }
    const res = await pool.query<{ rn: number }>(
      `
      SELECT rn FROM (
        SELECT f.id, f.cons_code, f.src_table,
               ROW_NUMBER() OVER (
                 ORDER BY CASE WHEN (${FAC_LIST_DISPLAY_CLASS_EXPR}) = '제외' THEN 1 ELSE 0 END,
                          f.sisul_name NULLS LAST, f.id
               ) AS rn
        ${joinSql}
      ) ranked
      WHERE ${whereId}
    `,
      args
    )
    const rn = Number(res.rows[0]?.rn)
    if (!Number.isFinite(rn) || rn < 1) return { success: true, page: 1, found: false }
    return { success: true, page: Math.max(1, Math.ceil(rn / pageSize)), found: true }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 지도 오버레이 — 유형·읍면만 적용한 전체 좌표(페이지·구분·검색 없음).
 * 목록 필터와 분리해 «전체»면 전 시설, «세천»이면 해당 유형만.
 */
export async function listMapFacilities(params?: {
  type?: string
  emd?: string
}): Promise<
  | { success: true; rows: SmallPublicListRow[]; emdOptions: string[] }
  | { success: false; error: string }
> {
  try {
    const type = String(params?.type ?? '').trim()
    const emd = String(params?.emd ?? '').trim()
    const where: string[] = ['1=1']
    const args: unknown[] = []
    const add = (sqlFrag: string, value: unknown) => {
      args.push(value)
      where.push(sqlFrag.replace('?', `$${args.length}`))
    }
    if (type) add('f.type = ?', type)
    if (emd) add('f.emd = ?', emd)

    /** 지도는 좌표·시설구분만 — 점검/평가 조인 없이 가볍게 */
    const res = await pool.query(
      `
      SELECT
        f.id,
        f.cons_code,
        f.sisul_name,
        f.type,
        f.src_table,
        f.emd,
        f.ri,
        f.candidate,
        f.x,
        f.y,
        f.gj,
        NULL::bigint AS insp_id,
        NULL::text AS surv_date,
        NULL::text AS risk_rank,
        NULL::int AS risk_score,
        NULL::text AS class_result,
        false AS eval_excluded
      FROM (
        ${FAC_UNION_SQL}
      ) f
      WHERE ${where.join(' AND ')}
        AND f.gj IS NOT NULL
      ORDER BY f.id
    `,
      args
    )

    const emdRes = await pool.query<{ emd: string }>(`
      SELECT DISTINCT emd FROM (${emdOptionsSql()}) e
      ORDER BY emd
    `)

    return {
      success: true,
      rows: res.rows.map((r) => mapListDbRow(r as Parameters<typeof mapListDbRow>[0])),
      emdOptions: emdRes.rows.map((r) => String(r.emd ?? '').trim()).filter(Boolean),
    }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

type PgQueryable = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>
}

/** 유형 테이블에서 관리번호 마지막 숫자 +1 (자릿수·접두 유지). 전체 유형에서 중복이면 계속 증가. */
async function allocateNextConsCodeOn(
  db: PgQueryable,
  type: string
): Promise<{ success: true; consCode: string } | { success: false; error: string }> {
  const meta = spfTypeTableByType(type)
  if (!meta) return { success: false, error: '유형이 필요합니다.' }
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`spf_cons:${meta.table}`])
  const lastRes = await db.query<{ cons_code: string }>(
    `
    SELECT cons_code
    FROM layer.${meta.table}
    WHERE cons_code ~ '[0-9]+$'
    ORDER BY (substring(cons_code from '[0-9]+$'))::bigint DESC
    LIMIT 1
  `
  )
  const last = String(lastRes.rows[0]?.cons_code ?? '').trim()
  const m = last.match(/^(.*?)(\d+)$/)
  const prefix = m?.[1] || meta.consPrefix
  const dig = m?.[2]?.length ?? 5
  let n = m ? Number(m[2]) + 1 : 1
  if (!Number.isFinite(n) || n < 1) n = 1

  for (let i = 0; i < 50; i++) {
    const consCode = `${prefix}${String(n).padStart(dig, '0')}`
    const hit = await db.query(
      `
      SELECT 1 FROM (
        ${FAC_UNION_SQL}
      ) u
      WHERE u.cons_code = $1
      LIMIT 1
    `,
      [consCode]
    )
    if (hit.rows.length === 0) return { success: true, consCode }
    n += 1
  }
  return { success: false, error: '관리번호를 발급할 수 없습니다.' }
}

export async function allocateNextConsCode(params?: {
  type?: string
}): Promise<{ success: true; consCode: string } | { success: false; error: string }> {
  const type = String(params?.type ?? '').trim()
  if (!spfTypeTableByType(type)) return { success: false, error: '유형이 필요합니다.' }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await allocateNextConsCodeOn(client, type)
    await client.query(out.success ? 'COMMIT' : 'ROLLBACK')
    return out
  } catch (e: unknown) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    client.release()
  }
}

function coordsToWkt(
  geomKind: 'LineString' | 'Point',
  coords: SmallPublicFacility['coords']
): string | null {
  if (!coords) return null
  if (geomKind === 'LineString') {
    const line = Array.isArray(coords[0]) ? (coords as [number, number][]) : null
    if (!line || line.length < 2) return null
    return `LINESTRING(${line.map(([x, y]) => `${x} ${y}`).join(', ')})`
  }
  const pt = Array.isArray(coords[0]) ? (coords as [number, number][])[0] : (coords as [number, number])
  if (!pt) return null
  return `POINT(${pt[0]} ${pt[1]})`
}

export type SaveFacilityParams = {
  facilityId?: string
  type?: string
  name?: string
  geomCode?: string
  emd?: string
  ri?: string
  address?: string
  startXy?: string
  endXy?: string
  benefitArea?: string
  riskDate?: string
  candidate?: string
  length?: string
  width?: string
  height?: string
  parentFacId?: string | null
  parentFacName?: string
  coords?: SmallPublicFacility['coords']
}

/** 후보지 등록·수정 — 관리번호는 유형 테이블 마지막 번호+1(신규만) */
export async function saveFacility(
  params: SaveFacilityParams
): Promise<{ success: true; facility: SmallPublicFacility } | { success: false; error: string }> {
  const type = String(params?.type ?? '').trim()
  const meta = spfTypeTableByType(type)
  if (!meta) return { success: false, error: '유형이 필요합니다.' }
  const name = String(params?.name ?? '').trim()
  if (!name) return { success: false, error: '시설명을 넣으세요.' }
  const candidate = asCandidate(params?.candidate || '일반')
  const geomWkt = coordsToWkt(meta.geom, params?.coords ?? null)
  if (!geomWkt) return { success: false, error: '위치를 지도에서 찍으세요.' }

  const facilityId = String(params?.facilityId ?? '').trim()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let consCode = ''
    let localId = 0

    if (facilityId) {
      const parsed = parseSpfFacilityUiId(facilityId)
      if (!parsed) {
        await client.query('ROLLBACK')
        return { success: false, error: '시설 id가 올바르지 않습니다.' }
      }
      if (parsed.kind === 'cons') {
        consCode = parsed.consCode
        const cur = await client.query<{ id: number; src_table: string }>(
          `
          SELECT id, src_table FROM (
            ${FAC_UNION_SQL}
          ) u WHERE cons_code = $1 LIMIT 1
        `,
          [consCode]
        )
        const row = cur.rows[0]
        if (!row) {
          await client.query('ROLLBACK')
          return { success: false, error: '시설을 찾을 수 없습니다.' }
        }
        if (row.src_table !== meta.table) {
          await client.query('ROLLBACK')
          return { success: false, error: '유형을 바꿀 수 없습니다. 삭제 후 다시 등록하세요.' }
        }
        localId = Number(row.id)
        await client.query(
          `
          UPDATE layer.${meta.table} SET
            sisul_name = $1, shp_code = $2, emd = $3, ri = $4, address = $5,
            start_xy = $6, end_xy = $7, ben_area = $8, risk_date = $9, candidate = $10,
            lne = $11, width = $12, hight = $13,
            parent_cons_code = $14, parent_fac_name = $15,
            geom = ST_SetSRID(ST_GeomFromText($16), 5187)
          WHERE id = $17
        `,
          [
            name,
            String(params.geomCode ?? '').trim() || null,
            String(params.emd ?? '').trim() || null,
            String(params.ri ?? '').trim() || null,
            String(params.address ?? '').trim() || null,
            String(params.startXy ?? '').trim() || null,
            String(params.endXy ?? '').trim() || null,
            String(params.benefitArea ?? '').trim() || null,
            String(params.riskDate ?? '').trim() || null,
            candidate,
            String(params.length ?? '').trim() || null,
            String(params.width ?? '').trim() || null,
            String(params.height ?? '').trim() || null,
            String(params.parentFacId ?? '').trim() || null,
            String(params.parentFacName ?? '').trim() || null,
            geomWkt,
            localId,
          ]
        )
      } else {
        await client.query('ROLLBACK')
        return { success: false, error: '관리번호 없는 제외 시설은 여기서 수정할 수 없습니다.' }
      }
    } else {
      const alloc = await allocateNextConsCodeOn(client, type)
      if (!alloc.success) {
        await client.query('ROLLBACK')
        return alloc
      }
      consCode = alloc.consCode
      const ins = await client.query<{ id: number }>(
        `
        INSERT INTO layer.${meta.table} (
          cons_code, sisul_name, shp_code, emd, ri, address,
          start_xy, end_xy, ben_area, risk_date, candidate, lne, width, hight,
          parent_cons_code, parent_fac_name, geom
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
          ST_SetSRID(ST_GeomFromText($17), 5187)
        )
        RETURNING id
      `,
        [
          consCode,
          name,
          String(params.geomCode ?? '').trim() || null,
          String(params.emd ?? '').trim() || null,
          String(params.ri ?? '').trim() || null,
          String(params.address ?? '').trim() || null,
          String(params.startXy ?? '').trim() || null,
          String(params.endXy ?? '').trim() || null,
          String(params.benefitArea ?? '').trim() || null,
          String(params.riskDate ?? '').trim() || null,
          candidate,
          String(params.length ?? '').trim() || null,
          String(params.width ?? '').trim() || null,
          String(params.height ?? '').trim() || null,
          String(params.parentFacId ?? '').trim() || null,
          String(params.parentFacName ?? '').trim() || null,
          geomWkt,
        ]
      )
      localId = Number(ins.rows[0]?.id)
    }

    await client.query('COMMIT')
    const facility = await fetchFacilityByUiId(spfFacilityUiId(consCode, meta.table, localId))
    if (!facility) return { success: false, error: '저장 후 시설을 읽지 못했습니다.' }
    return { success: true, facility }
  } catch (e: unknown) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    client.release()
  }
}

/** 세천 ↔ 소교량·낙차공 부속 관계 (parent_cons_code) */
async function fetchRelatedFacilities(facility: SmallPublicFacility): Promise<SmallPublicFacility[]> {
  try {
    if (facility.type === '세천') {
      const cons = String(facility.mngNo ?? '').trim()
      if (!cons) return []
      const res = await pool.query<FacDbRow>(
        `
        SELECT * FROM (
          ${FAC_UNION_SQL}
        ) u
        WHERE u.type IN ('소교량', '낙차공')
          AND u.parent_cons_code = $1
        ORDER BY u.type, u.sisul_name NULLS LAST, u.id
      `,
        [cons]
      )
      return res.rows.map(mapFacDbRow)
    }
    if (facility.type === '소교량' || facility.type === '낙차공') {
      const parentCons = String(facility.parentFacId ?? '').trim()
      if (!parentCons) return []
      const res = await pool.query<FacDbRow>(
        `
        ${FAC_SELECT_SQL}
        WHERE type = '세천' AND cons_code = $1
        LIMIT 1
      `,
        [parentCons]
      )
      return res.rows.map(mapFacDbRow)
    }
    return []
  } catch {
    return []
  }
}

/** 후보지 상세 — 한 시설 + 해당 점검·평가 이력(양식 본문 제외) + 부속·상위 시설 */
export async function getFacilityDetail(params: {
  facilityId?: string
}): Promise<
  | {
      success: true
      facility: SmallPublicFacility
      inspections: SmallPublicInspection[]
      candidateEvals: SmallPublicCandidateEval[]
      relatedFacilities: SmallPublicFacility[]
    }
  | { success: false; error: string }
> {
  const facilityId = String(params?.facilityId ?? '').trim()
  if (!facilityId) return { success: false, error: 'facilityId가 필요합니다.' }

  try {
    const facility = await fetchFacilityByUiId(facilityId)
    if (!facility) return { success: false, error: '시설을 찾을 수 없습니다.' }
    const facById = new Map([[facility.id, facility]])
    const cons = facility.mngNo && !facility.mngNo.startsWith('excl:') ? facility.mngNo : ''

    const checkRes = cons
      ? await pool.query<CheckDbRow>(
          `
      SELECT id, cons_code, report_id, risk_score, surv_date, surv_name, risk_rank, candidate, remark
      FROM layer.spf_check
      WHERE cons_code = $1
      ORDER BY surv_date DESC NULLS LAST, id DESC
    `,
          [cons]
        )
      : { rows: [] as CheckDbRow[] }
    const inspections = checkRes.rows.map((c) => mapCheckDbRowSlim(c, facById))

    const evalRes = cons
      ? await pool
          .query<{
            id: number
            cons_code: string | null
            eval_date: string | null
            evaluator: string | null
            result: string | null
            remark: string | null
          }>(
            `
        SELECT id, cons_code, eval_date, evaluator, result, remark
        FROM layer.spf_eval
        WHERE cons_code = $1
        ORDER BY eval_date DESC NULLS LAST, id DESC
      `,
            [cons]
          )
          .catch(() => ({
            rows: [] as Array<{
              id: number
              cons_code: string | null
              eval_date: string | null
              evaluator: string | null
              result: string | null
              remark: string | null
            }>,
          }))
      : {
          rows: [] as Array<{
            id: number
            cons_code: string | null
            eval_date: string | null
            evaluator: string | null
            result: string | null
            remark: string | null
          }>,
        }

    const root = smallPublicRoot()
    const fileEntries = cons ? await listAttachmentEntries(root, cons) : []
    const rootAtt = mapAttachments(
      cons || facility.id,
      fileEntries.filter((e) => e.scope === 'common')
    )
    const byYear = mapAttachmentsByYear(cons || facility.id, fileEntries)
    /** 후보지 평가 첨부는 평가일 연도의 후보지_{연도}/ 폴더 — 안전점검 연도와 겹쳐도 따로 읽는다 */
    const candidateByYear = mapCandidateFilesByYear(cons || facility.id, fileEntries)

    const inspectionsWithFiles = inspections.map((insp) => {
      const y = String(insp.date ?? '').slice(0, 4)
      const yearAtt = (y && byYear.get(y)) || byYear.get('') || null
      if (!yearAtt) return insp
      return {
        ...insp,
        file: yearAtt.riskFile,
        classFile: yearAtt.classFile,
        fieldFile: yearAtt.fieldFile,
        files: [...yearAtt.safetyFiles, ...yearAtt.planFiles],
      }
    })

    const candidateEvals: SmallPublicCandidateEval[] = evalRes.rows.map((e) => {
      const resultRaw = String(e.result ?? '').trim()
      const result: SmallPublicCandidateResult = resultRaw.includes('제외') ? '선정제외' : '선정'
      return {
        id: String(e.id),
        facilityId: String(e.cons_code ?? '').trim() || facility.id,
        date: String(e.eval_date ?? '').trim() || '1970-01-01',
        evaluator: String(e.evaluator ?? '').trim(),
        result,
        remark: String(e.remark ?? '').trim(),
        /** 평가일 연도 폴더의 첨부, 폴더가 없으면 예전 루트의 후보지평가 파일 */
        file: candidateByYear.get(String(e.eval_date ?? '').trim().slice(0, 4))?.[0] ?? rootAtt.candidateFile,
      }
    })

    /** 평가 이력(DB)이 없어도 후보지 첨부가 있으면 연도별 한 건으로 매핑 — 선정여부는 시설 구분에서 따른다 */
    if (candidateEvals.length === 0) {
      const result: SmallPublicCandidateResult = facility.candidate === '제외' ? '선정제외' : '선정'
      for (const [y, files] of [...candidateByYear.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
        candidateEvals.push({
          id: `file:${cons || facility.id}:${y}`,
          facilityId: cons || facility.id,
          date: '',
          evaluator: '',
          result,
          remark: '',
          file: files[0] ?? null,
        })
      }
      if (candidateEvals.length === 0 && rootAtt.candidateFile) {
        candidateEvals.push({
          id: `file:${cons || facility.id}`,
          facilityId: cons || facility.id,
          date: '',
          evaluator: '',
          result,
          remark: '',
          file: rootAtt.candidateFile,
        })
      }
    }

    const facilityWithFiles: SmallPublicFacility = {
      ...facility,
      planFiles: rootAtt.planFiles,
    }

    const relatedFacilities = await fetchRelatedFacilities(facility)
    return {
      success: true,
      facility: facilityWithFiles,
      inspections: inspectionsWithFiles,
      candidateEvals,
      relatedFacilities,
    }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 안전점검 보고서 목록 한 줄 */
export type SmallPublicReportListItem = {
  id: string
  year: number
  baseDate: string
  title: string
  agency: string
  author: string
  targetCount: number
  inspected: number
}

/**
 * 안전점검 보고서 목록 — 시설·점검 본문 없이 헤더·건수만.
 */
export async function listReports(params?: {
  year?: string | number
  keyword?: string
}): Promise<
  | { success: true; reports: SmallPublicReportListItem[]; yearOptions: number[] }
  | { success: false; error: string }
> {
  try {
    await ensureReportExtras()
    const year = String(params?.year ?? '').trim()
    const keyword = String(params?.keyword ?? '').trim()
    const where: string[] = ['1=1']
    const args: unknown[] = []
    if (year) {
      args.push(Number(year))
      where.push(`r.year = $${args.length}`)
    }
    if (keyword) {
      args.push(`%${keyword}%`)
      const p = `$${args.length}`
      where.push(`(COALESCE(r.title,'') ILIKE ${p} OR COALESCE(r.author,'') ILIKE ${p} OR COALESCE(r.agency,'') ILIKE ${p})`)
    }

    const res = await pool.query<{
      id: number
      year: number
      write_date: string | null
      title: string | null
      agency: string | null
      author: string | null
      target_count: number | null
      inspected: number
      target_rows: number
      union_count: number
    }>(
      `
      SELECT
        r.id,
        r.year,
        r.write_date,
        r.title,
        r.agency,
        r.author,
        r.target_count,
        (SELECT count(*)::int FROM layer.spf_check c WHERE c.report_id = r.id) AS inspected,
        (SELECT count(*)::int FROM layer.spf_report_target t WHERE t.report_id = r.id) AS target_rows,
        (SELECT count(*)::int FROM (
           SELECT cons_code FROM layer.spf_report_target WHERE report_id = r.id
           UNION
           SELECT cons_code FROM layer.spf_check WHERE report_id = r.id
         ) u) AS union_count
      FROM layer.spf_report r
      WHERE ${where.join(' AND ')}
      ORDER BY r.year DESC, r.id DESC
    `,
      args
    )

    const years = await pool.query<{ year: number }>(`
      SELECT DISTINCT year FROM layer.spf_report ORDER BY year DESC
    `)

    const reports: SmallPublicReportListItem[] = res.rows.map((r) => {
      const y = Number(r.year)
      const baseDate = String(r.write_date ?? '').trim() || `${y}-12-31`
      const inspected = Number(r.inspected) || 0
      /** 대상 목록이 있는 보고서는 대상∪점검 건수, 예전 보고서는 저장된 대상 수 */
      const targetCount =
        Number(r.target_rows) > 0
          ? Number(r.union_count)
          : r.target_count != null
            ? Number(r.target_count)
            : inspected
      return {
        id: String(r.id),
        year: y,
        baseDate,
        title: String(r.title ?? '').trim() || smallPublicReportTitle(y),
        agency: String(r.agency ?? '').trim(),
        author: String(r.author ?? '').trim(),
        targetCount: Number.isFinite(targetCount) ? targetCount : inspected,
        inspected,
      }
    })

    return {
      success: true,
      reports,
      yearOptions: years.rows.map((r) => Number(r.year)).filter((n) => Number.isFinite(n)),
    }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 보고서 상세 — 대상 목록 + 해당 점검(양식 제외) + 지도용 시설 좌표.
 */
export async function getReportDetail(params: {
  reportId?: string
}): Promise<
  | {
      success: true
      report: SmallPublicInspectionReport
      facilities: SmallPublicFacility[]
      inspections: SmallPublicInspection[]
    }
  | { success: false; error: string }
> {
  const reportId = String(params?.reportId ?? '').trim()
  if (!reportId) return { success: false, error: 'reportId가 필요합니다.' }
  const idNum = Number(reportId)
  if (!Number.isFinite(idNum)) return { success: false, error: 'reportId가 올바르지 않습니다.' }

  try {
    await ensureReportExtras()
    const reportRes = await pool.query<{
      id: number
      year: number
      write_date: string | null
      title: string | null
      agency: string | null
      author: string | null
      target_count: number | null
      summary: string | null
    }>(
      `
      SELECT id, year, write_date, title, agency, author, target_count, summary
      FROM layer.spf_report
      WHERE id = $1
      LIMIT 1
    `,
      [idNum]
    )
    const rr = reportRes.rows[0]
    if (!rr) return { success: false, error: '보고서를 찾을 수 없습니다.' }

    const checkRes = await pool.query<CheckDbRow>(
      `
      SELECT
        c.id, c.cons_code, c.report_id, c.risk_score, c.surv_date, c.surv_name, c.risk_rank, c.candidate, c.remark
      FROM layer.spf_check c
      WHERE c.report_id = $1
      ORDER BY c.surv_date DESC NULLS LAST, c.id DESC
    `,
      [idNum]
    )

    /** 작성 시점에 보관한 대상(직전 평가구분 포함) */
    const targetRes = await pool.query<{ cons_code: string; prev_class: string | null; prev_date: string | null }>(
      `SELECT cons_code, prev_class, prev_date FROM layer.spf_report_target WHERE report_id = $1`,
      [idNum]
    )
    const targetByCons = new Map(targetRes.rows.map((t) => [String(t.cons_code).trim(), t]))
    /** 대상 목록이 없는 예전 보고서 — 점검 건마다 그 이전 점검의 평가구분을 직전 구분으로 쓴다 */
    const prevRes = await pool.query<{ check_id: number; prev_class: string | null; prev_date: string | null }>(
      `
      SELECT DISTINCT ON (c.id) c.id AS check_id, p.candidate AS prev_class, p.surv_date AS prev_date
      FROM layer.spf_check c
      LEFT JOIN layer.spf_check p
        ON p.cons_code = c.cons_code AND p.id <> c.id AND p.surv_date IS NOT NULL AND p.surv_date < c.surv_date
      WHERE c.report_id = $1
      ORDER BY c.id, p.surv_date DESC NULLS LAST, p.id DESC
    `,
      [idNum]
    )
    const prevByCheck = new Map(prevRes.rows.map((p) => [String(p.check_id), p]))

    const consCodes = [
      ...new Set([
        ...checkRes.rows.map((c) => String(c.cons_code ?? '').trim()),
        ...targetRes.rows.map((t) => String(t.cons_code ?? '').trim()),
      ].filter(Boolean)),
    ]
    let facRows: FacDbRow[] = []
    if (consCodes.length > 0) {
      const facRes = await pool.query<FacDbRow>(
        `
        ${FAC_SELECT_SQL}
        WHERE cons_code = ANY($1::text[])
      `,
        [consCodes]
      )
      facRows = facRes.rows
    }
    const facilities = facRows.map(mapFacDbRow)
    const facById = new Map(facilities.map((f) => [f.id, f]))
    /** 첨부는 목록에서 읽지 않는다 — 점검 상세를 열 때 getInspectionFiles 로 가져온다 */
    const inspections = checkRes.rows.map((c) => mapCheckDbRowSlim(c, facById))

    const year = Number(rr.year)
    const baseDate = String(rr.write_date ?? '').trim() || `${year}-12-31`
    const rowOf = (f: SmallPublicFacility, prevClass: string, prevDate: string): SmallPublicReportRow => ({
      facilityId: f.id,
      mngNo: f.mngNo,
      name: f.name,
      type: f.type,
      emd: f.emd,
      ri: f.ri,
      address: f.address,
      spec: specText(f),
      prevClass: asCandidate(prevClass),
      prevDate,
    })
    const rowByFac = new Map<string, SmallPublicReportRow>()
    for (const t of targetRes.rows) {
      const f = facById.get(String(t.cons_code).trim())
      if (!f) continue
      rowByFac.set(f.id, rowOf(f, String(t.prev_class ?? '').trim() || f.candidate, String(t.prev_date ?? '').trim()))
    }
    /** 대상 목록에 없는데 점검이 있는 시설(예전 보고서·대상 밖 점검)도 줄에 넣는다 */
    inspections.forEach((i) => {
      const f = facById.get(i.facilityId)
      if (!f || rowByFac.has(f.id)) return
      const prev = targetByCons.size === 0 ? prevByCheck.get(i.id) : undefined
      rowByFac.set(
        f.id,
        rowOf(f, String(prev?.prev_class ?? '').trim() || i.classResult, String(prev?.prev_date ?? '').trim() || i.date)
      )
    })
    const rows: SmallPublicReportRow[] = [...rowByFac.values()].sort(
      (a, b) =>
        a.emd.localeCompare(b.emd, 'ko') || a.type.localeCompare(b.type, 'ko') || a.name.localeCompare(b.name, 'ko')
    )

    const report: SmallPublicInspectionReport = {
      id: String(rr.id),
      year,
      baseDate,
      title: String(rr.title ?? '').trim() || smallPublicReportTitle(year),
      agency: String(rr.agency ?? '').trim(),
      author: String(rr.author ?? '').trim(),
      summary: String(rr.summary ?? '').trim(),
      createdAt: `${baseDate}T00:00:00`,
      rows,
      sample: false,
    }

    return { success: true, report, facilities, inspections }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

type SvcFail = { success: false; error: string }

const svcErr = (e: unknown): SvcFail => ({
  success: false,
  error: e instanceof Error ? e.message : String(e),
})

const isUniqueViolation = (e: unknown): boolean => (e as { code?: string } | null)?.code === '23505'

function todaySeoul(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** 보고서 대상 테이블·개요 컬럼 — 프로세스당 한 번만 보장 */
let reportExtrasReady: Promise<void> | null = null
function ensureReportExtras(): Promise<void> {
  if (!reportExtrasReady) {
    const p = ensureSpfReportExtras().then((r) => {
      if (r.errors.length > 0) throw new Error(r.errors.join('; '))
    })
    reportExtrasReady = p
    p.catch(() => {
      if (reportExtrasReady === p) reportExtrasReady = null
    })
  }
  return reportExtrasReady
}

type TargetCalcRow = { cons_code: string; prev_class: string; prev_date: string | null }

/**
 * 보고서 대상 계산 — 기준일 시점 평가구분 = 기준일 이전 마지막 점검의 평가구분(없으면 시설 구분).
 * onlyCons 가 없으면 일반·관리 시설 + 직전 연도 보고서의 위험(계속 점검) 시설, 평가 제외는 뺀다.
 * onlyCons 가 있으면 그 시설만(대상 밖 추가용).
 */
async function calcReportTargets(
  db: PgQueryable,
  p: { baseDate: string; prevReportId: number | null; excludeReportId: number | null; onlyCons: string[] | null }
): Promise<TargetCalcRow[]> {
  const res = await db.query<TargetCalcRow & { excluded: boolean; carried: boolean }>(
    `
    WITH fc AS (
      SELECT cons_code, candidate FROM (${FAC_UNION_SQL}) u
      WHERE cons_code IS NOT NULL AND btrim(cons_code) <> ''
    ),
    lc AS (
      SELECT DISTINCT ON (cons_code) cons_code, candidate, surv_date
      FROM layer.spf_check
      WHERE cons_code IS NOT NULL AND surv_date IS NOT NULL AND surv_date <= $1
        AND ($3::int IS NULL OR report_id <> $3::int)
      ORDER BY cons_code, surv_date DESC, id DESC
    ),
    ev AS (
      SELECT DISTINCT ON (cons_code) cons_code, result FROM layer.spf_eval
      WHERE cons_code IS NOT NULL AND btrim(cons_code) <> ''
      ORDER BY cons_code, eval_date DESC NULLS LAST, id DESC
    ),
    carry AS (
      SELECT cons_code FROM layer.spf_report_target WHERE report_id = $2::int
      UNION
      SELECT cons_code FROM layer.spf_check WHERE report_id = $2::int
    )
    SELECT DISTINCT ON (fc.cons_code)
      fc.cons_code,
      COALESCE(NULLIF(btrim(lc.candidate), ''), NULLIF(btrim(fc.candidate), ''), '일반') AS prev_class,
      lc.surv_date AS prev_date,
      (ev.result IS NOT NULL AND ev.result LIKE '%제외%') AS excluded,
      (carry.cons_code IS NOT NULL) AS carried
    FROM fc
    LEFT JOIN lc ON lc.cons_code = fc.cons_code
    LEFT JOIN ev ON ev.cons_code = fc.cons_code
    LEFT JOIN carry ON carry.cons_code = fc.cons_code
    WHERE ($4::text[] IS NULL OR fc.cons_code = ANY($4::text[]))
  `,
    [p.baseDate, p.prevReportId, p.excludeReportId, p.onlyCons]
  )
  return res.rows
    .filter((r) => {
      if (p.onlyCons) return true
      if (r.excluded) return false
      return r.prev_class === '일반' || r.prev_class === '관리' || (r.prev_class === '위험' && r.carried)
    })
    .map((r) => ({ cons_code: r.cons_code, prev_class: r.prev_class, prev_date: r.prev_date }))
}

async function insertReportTargets(db: PgQueryable, reportId: number, rows: TargetCalcRow[]): Promise<void> {
  if (rows.length === 0) return
  await db.query(
    `
    INSERT INTO layer.spf_report_target (report_id, cons_code, prev_class, prev_date)
    SELECT $1::int, t.cons_code, t.prev_class, t.prev_date
    FROM unnest($2::text[], $3::text[], $4::text[]) AS t(cons_code, prev_class, prev_date)
    ON CONFLICT (report_id, cons_code) DO NOTHING
  `,
    [reportId, rows.map((r) => r.cons_code), rows.map((r) => r.prev_class), rows.map((r) => r.prev_date)]
  )
}

/** 보고서 대상 수 = 대상 목록 ∪ 점검 건 */
async function syncReportTargetCount(db: PgQueryable, reportId: number): Promise<void> {
  await db.query(
    `
    UPDATE layer.spf_report r SET target_count = (
      SELECT count(*)::int FROM (
        SELECT cons_code FROM layer.spf_report_target WHERE report_id = r.id
        UNION
        SELECT cons_code FROM layer.spf_check WHERE report_id = r.id
      ) u
    )
    WHERE r.id = $1
  `,
    [reportId]
  )
}

/**
 * 안전점검 보고서 저장 — reportId 가 없으면 새 보고서(연도는 하나만).
 * 새 보고서는 지금 일반·관리 시설과 직전 연도 보고서의 위험(계속 점검) 시설을 대상으로 자동 등록한다.
 */
export async function saveReport(params: {
  reportId?: string
  year?: number
  baseDate?: string
  title?: string
  agency?: string
  author?: string
  summary?: string
}): Promise<{ success: true; reportId: string; targetCount: number } | SvcFail> {
  const year = Number(params?.year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { success: false, error: '연도가 올바르지 않습니다.' }
  const title = String(params?.title ?? '').trim()
  if (!title) return { success: false, error: '제목을 넣으세요.' }
  const baseDateRaw = normalizeDate(String(params?.baseDate ?? ''))
  const baseDate = YMD_RE.test(baseDateRaw) ? baseDateRaw : todaySeoul()
  const agency = String(params?.agency ?? '').trim() || null
  const author = String(params?.author ?? '').trim() || null
  const summary = String(params?.summary ?? '').trim() || null
  const dupMsg = `${year}년 보고서가 이미 있습니다.`

  try {
    await ensureReportExtras()
    const reportIdRaw = String(params?.reportId ?? '').trim()
    if (reportIdRaw) {
      const idNum = Number(reportIdRaw)
      if (!Number.isFinite(idNum)) return { success: false, error: 'reportId가 올바르지 않습니다.' }
      try {
        const upd = await pool.query<{ id: number; target_count: number | null }>(
          `
          UPDATE layer.spf_report
          SET year = $2, write_date = $3, title = $4, agency = $5, author = $6, summary = $7
          WHERE id = $1
          RETURNING id, target_count
        `,
          [idNum, year, baseDate, title, agency, author, summary]
        )
        if (!upd.rows[0]) return { success: false, error: '보고서를 찾을 수 없습니다.' }
        return { success: true, reportId: String(idNum), targetCount: Number(upd.rows[0].target_count) || 0 }
      } catch (e) {
        if (isUniqueViolation(e)) return { success: false, error: dupMsg }
        throw e
      }
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const dup = await client.query<{ id: number }>(`SELECT id FROM layer.spf_report WHERE year = $1 LIMIT 1`, [year])
      if (dup.rows[0]) {
        await client.query('ROLLBACK')
        return { success: false, error: dupMsg }
      }
      const prev = await client.query<{ id: number }>(
        `SELECT id FROM layer.spf_report WHERE year < $1 ORDER BY year DESC LIMIT 1`,
        [year]
      )
      const ins = await client.query<{ id: number }>(
        `
        INSERT INTO layer.spf_report (year, write_date, title, agency, author, summary, target_count)
        VALUES ($1, $2, $3, $4, $5, $6, 0)
        RETURNING id
      `,
        [year, baseDate, title, agency, author, summary]
      )
      const newId = Number(ins.rows[0]!.id)
      const targets = await calcReportTargets(client, {
        baseDate,
        prevReportId: prev.rows[0] ? Number(prev.rows[0].id) : null,
        excludeReportId: newId,
        onlyCons: null,
      })
      await insertReportTargets(client, newId, targets)
      await syncReportTargetCount(client, newId)
      await client.query('COMMIT')
      return { success: true, reportId: String(newId), targetCount: targets.length }
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (isUniqueViolation(e)) return { success: false, error: dupMsg }
      throw e
    } finally {
      client.release()
    }
  } catch (e: unknown) {
    return svcErr(e)
  }
}

/** 보고서 삭제 — 점검 결과가 있으면 지우지 않는다(점검 기록 보호) */
export async function deleteReport(params: { reportId?: string }): Promise<{ success: true } | SvcFail> {
  const idNum = Number(String(params?.reportId ?? '').trim())
  if (!Number.isFinite(idNum)) return { success: false, error: 'reportId가 올바르지 않습니다.' }
  try {
    await ensureReportExtras()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const chk = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM layer.spf_check WHERE report_id = $1`,
        [idNum]
      )
      const n = chk.rows[0]?.n ?? 0
      if (n > 0) {
        await client.query('ROLLBACK')
        return { success: false, error: `점검 ${n}건이 있는 보고서는 삭제할 수 없습니다.` }
      }
      await client.query(`DELETE FROM layer.spf_report_target WHERE report_id = $1`, [idNum])
      await client.query(`DELETE FROM layer.spf_report WHERE id = $1`, [idNum])
      await client.query('COMMIT')
      return { success: true }
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw e
    } finally {
      client.release()
    }
  } catch (e: unknown) {
    return svcErr(e)
  }
}

/** 보고서에 대상 밖 시설(위험시설 재점검 등) 추가 — 기준일 시점 직전 평가구분을 함께 보관 */
export async function addReportTarget(params: {
  reportId?: string
  facilityId?: string
}): Promise<{ success: true; targetCount: number } | SvcFail> {
  const idNum = Number(String(params?.reportId ?? '').trim())
  if (!Number.isFinite(idNum)) return { success: false, error: 'reportId가 올바르지 않습니다.' }
  const parsed = parseSpfFacilityUiId(String(params?.facilityId ?? ''))
  if (!parsed || parsed.kind !== 'cons') return { success: false, error: '관리번호가 없는 시설은 대상에 넣을 수 없습니다.' }
  try {
    await ensureReportExtras()
    const rep = await pool.query<{ year: number; write_date: string | null }>(
      `SELECT year, write_date FROM layer.spf_report WHERE id = $1`,
      [idNum]
    )
    const rr = rep.rows[0]
    if (!rr) return { success: false, error: '보고서를 찾을 수 없습니다.' }
    const baseDate = String(rr.write_date ?? '').trim() || `${Number(rr.year)}-12-31`
    const calc = await calcReportTargets(pool, {
      baseDate,
      prevReportId: null,
      excludeReportId: idNum,
      onlyCons: [parsed.consCode],
    })
    if (calc.length === 0) return { success: false, error: '시설을 찾을 수 없습니다.' }
    await insertReportTargets(pool, idNum, calc)
    await syncReportTargetCount(pool, idNum)
    const cnt = await pool.query<{ target_count: number | null }>(
      `SELECT target_count FROM layer.spf_report WHERE id = $1`,
      [idNum]
    )
    return { success: true, targetCount: Number(cnt.rows[0]?.target_count) || 0 }
  } catch (e: unknown) {
    return svcErr(e)
  }
}

/**
 * 점검 저장 — layer.spf_check. 보고서당 시설 1건(같은 보고서에 이미 있으면 그 건을 고친다).
 * reportId 가 없으면 점검일 연도의 보고서에 넣는다.
 */
export async function saveInspection(params: {
  inspectionId?: string
  facilityId?: string
  reportId?: string | null
  date?: string
  inspector?: string
  score?: number
  grade?: string
  classResult?: string
  remark?: string
}): Promise<{ success: true; inspectionId: string; reportId: string } | SvcFail> {
  const parsed = parseSpfFacilityUiId(String(params?.facilityId ?? ''))
  if (!parsed || parsed.kind !== 'cons') return { success: false, error: '관리번호가 없는 시설은 점검을 저장할 수 없습니다.' }
  const date = normalizeDate(String(params?.date ?? ''))
  if (!YMD_RE.test(date)) return { success: false, error: '점검일이 올바르지 않습니다.' }
  const score = Math.round(Number(params?.score))
  if (!Number.isFinite(score)) return { success: false, error: '평가점수를 숫자로 넣으세요.' }
  const grade = asGrade(String(params?.grade ?? ''))
  const classResult = asClass(String(params?.classResult ?? ''))
  const inspector = String(params?.inspector ?? '').trim() || null
  const remark = String(params?.remark ?? '').trim() || null

  try {
    await ensureReportExtras()
    const existingId = Number(String(params?.inspectionId ?? '').trim())
    if (Number.isFinite(existingId) && String(params?.inspectionId ?? '').trim() !== '') {
      const upd = await pool.query<{ id: number; report_id: number }>(
        `
        UPDATE layer.spf_check
        SET risk_score = $2, surv_date = $3, surv_name = $4, risk_rank = $5, candidate = $6, remark = $7
        WHERE id = $1
        RETURNING id, report_id
      `,
        [existingId, score, date, inspector, grade, classResult, remark]
      )
      if (upd.rows[0]) {
        return { success: true, inspectionId: String(upd.rows[0].id), reportId: String(upd.rows[0].report_id) }
      }
    }

    let reportId = Number(String(params?.reportId ?? '').trim())
    if (!Number.isFinite(reportId) || String(params?.reportId ?? '').trim() === '') {
      const byYear = await pool.query<{ id: number }>(`SELECT id FROM layer.spf_report WHERE year = $1 LIMIT 1`, [
        Number(date.slice(0, 4)),
      ])
      if (!byYear.rows[0]) {
        return { success: false, error: `${date.slice(0, 4)}년 보고서가 없습니다. 안전점검에서 보고서를 먼저 만드세요.` }
      }
      reportId = Number(byYear.rows[0].id)
    } else {
      const exists = await pool.query(`SELECT 1 FROM layer.spf_report WHERE id = $1`, [reportId])
      if (exists.rows.length === 0) return { success: false, error: '보고서를 찾을 수 없습니다.' }
    }

    const ins = await pool.query<{ id: number }>(
      `
      INSERT INTO layer.spf_check (cons_code, report_id, risk_score, surv_date, surv_name, risk_rank, candidate, remark)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (report_id, cons_code) DO UPDATE SET
        risk_score = EXCLUDED.risk_score, surv_date = EXCLUDED.surv_date, surv_name = EXCLUDED.surv_name,
        risk_rank = EXCLUDED.risk_rank, candidate = EXCLUDED.candidate, remark = EXCLUDED.remark
      RETURNING id
    `,
      [parsed.consCode, reportId, score, date, inspector, grade, classResult, remark]
    )
    await syncReportTargetCount(pool, reportId)
    return { success: true, inspectionId: String(ins.rows[0]!.id), reportId: String(reportId) }
  } catch (e: unknown) {
    return svcErr(e)
  }
}

/** 점검 삭제 — layer.spf_check 한 건(보고서 대상 목록은 그대로 둔다) */
export async function deleteInspection(params: { inspectionId?: string }): Promise<{ success: true } | SvcFail> {
  const idNum = Number(String(params?.inspectionId ?? '').trim())
  if (!Number.isFinite(idNum)) return { success: false, error: 'inspectionId가 올바르지 않습니다.' }
  try {
    await ensureReportExtras()
    const del = await pool.query<{ report_id: number }>(
      `DELETE FROM layer.spf_check WHERE id = $1 RETURNING report_id`,
      [idNum]
    )
    if (del.rows[0]) await syncReportTargetCount(pool, Number(del.rows[0].report_id))
    return { success: true }
  } catch (e: unknown) {
    return svcErr(e)
  }
}

/**
 * 후보지 평가 저장 — layer.spf_eval. 평가는 5년 주기 등으로 하므로 시설당 연도마다 한 건(평가일 연도).
 * 첨부는 {관리번호}/후보지_{평가연도}/ 에 두며, 기존 평가는 평가일 연도를 바꿀 수 없다.
 */
export async function saveCandidateEval(params: {
  evalId?: string
  facilityId?: string
  date?: string
  evaluator?: string
  result?: string
  remark?: string
}): Promise<{ success: true; evalId: string } | SvcFail> {
  const parsed = parseSpfFacilityUiId(String(params?.facilityId ?? ''))
  if (!parsed || parsed.kind !== 'cons') return { success: false, error: '관리번호가 없는 시설은 평가를 저장할 수 없습니다.' }
  const date = normalizeDate(String(params?.date ?? ''))
  if (!YMD_RE.test(date)) return { success: false, error: '평가일이 올바르지 않습니다.' }
  const year = date.slice(0, 4)
  const result = String(params?.result ?? '').includes('제외') ? '선정제외' : '선정'
  const evaluator = String(params?.evaluator ?? '').trim() || null
  const remark = String(params?.remark ?? '').trim() || null
  const evalIdRaw = String(params?.evalId ?? '').trim()
  const existingId = /^\d+$/.test(evalIdRaw) ? Number(evalIdRaw) : null

  try {
    const fac = await pool.query(`SELECT 1 FROM (${FAC_UNION_SQL}) u WHERE cons_code = $1 LIMIT 1`, [parsed.consCode])
    if (fac.rows.length === 0) return { success: false, error: '시설을 찾을 수 없습니다.' }

    if (existingId != null) {
      const cur = await pool.query<{ eval_date: string | null; cons_code: string | null }>(
        `SELECT eval_date, cons_code FROM layer.spf_eval WHERE id = $1`,
        [existingId]
      )
      if (cur.rows[0]) {
        if (String(cur.rows[0].eval_date ?? '').trim().slice(0, 4) !== year) {
          return { success: false, error: '평가일의 연도는 바꿀 수 없습니다.' }
        }
        await pool.query(
          `UPDATE layer.spf_eval SET eval_date = $2, evaluator = $3, result = $4, remark = $5 WHERE id = $1`,
          [existingId, date, evaluator, result, remark]
        )
        return { success: true, evalId: String(existingId) }
      }
    }

    const dup = await pool.query(
      `SELECT 1 FROM layer.spf_eval WHERE cons_code = $1 AND left(btrim(eval_date), 4) = $2 LIMIT 1`,
      [parsed.consCode, year]
    )
    if (dup.rows.length > 0) return { success: false, error: `${year}년 후보지 평가가 이미 있습니다.` }
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO layer.spf_eval (cons_code, eval_date, evaluator, result, remark) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [parsed.consCode, date, evaluator, result, remark]
    )
    return { success: true, evalId: String(ins.rows[0]!.id) }
  } catch (e: unknown) {
    return svcErr(e)
  }
}

/** 후보지 평가 삭제 — 평가 한 건과 그 연도의 후보지_{연도}/ 첨부 폴더를 함께 지운다(안전점검 폴더·시설 공통 파일은 그대로) */
export async function deleteCandidateEval(params: { evalId?: string }): Promise<{ success: true } | SvcFail> {
  const idNum = Number(String(params?.evalId ?? '').trim())
  if (!Number.isFinite(idNum)) return { success: false, error: 'evalId가 올바르지 않습니다.' }
  try {
    const del = await pool.query<{ cons_code: string | null; eval_date: string | null }>(
      `DELETE FROM layer.spf_eval WHERE id = $1 RETURNING cons_code, eval_date`,
      [idNum]
    )
    const row = del.rows[0]
    const cons = String(row?.cons_code ?? '').trim()
    const year = String(row?.eval_date ?? '').trim().slice(0, 4)
    if (cons && /^\d{4}$/.test(year) && MNG_DIR_RE.test(cons)) {
      await removeScopedAttachmentDir({ mngNo: cons, scope: 'candidate', year }).catch(() => undefined)
    }
    return { success: true }
  } catch (e: unknown) {
    return svcErr(e)
  }
}

/**
 * 후보지(시설) 삭제 — 유형 테이블 행과 그 시설의 점검·평가·보고서 대상을 함께 지운다.
 * 정비계획에 들어 있는 시설은 지우지 않는다. 부속 시설의 상위 연결은 비운다.
 */
export async function deleteFacility(params: { facilityId?: string }): Promise<{ success: true } | SvcFail> {
  const parsed = parseSpfFacilityUiId(String(params?.facilityId ?? ''))
  if (!parsed) return { success: false, error: '시설 id가 올바르지 않습니다.' }
  const client = await pool.connect()
  try {
    await ensureReportExtras()
    await client.query('BEGIN')
    let table = ''
    let localId = 0
    let consCode = ''
    if (parsed.kind === 'cons') {
      const cur = await client.query<{ id: number; src_table: string }>(
        `SELECT id, src_table FROM (${FAC_UNION_SQL}) u WHERE cons_code = $1 LIMIT 1`,
        [parsed.consCode]
      )
      if (!cur.rows[0]) {
        await client.query('ROLLBACK')
        return { success: false, error: '시설을 찾을 수 없습니다.' }
      }
      table = cur.rows[0].src_table
      localId = Number(cur.rows[0].id)
      consCode = parsed.consCode
    } else {
      table = parsed.table
      localId = parsed.localId
    }
    const meta = spfTypeTableByName(table)
    if (!meta) {
      await client.query('ROLLBACK')
      return { success: false, error: '시설 유형을 알 수 없습니다.' }
    }

    if (consCode) {
      const grp = await client.query<{ group_code: string }>(
        `SELECT group_code FROM layer.spf_bridge_group WHERE cons_code = $1`,
        [consCode]
      )
      const planCodes = [consCode, ...grp.rows.map((g) => g.group_code)]
      const planned = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM layer.spf_plan_fac WHERE cons_code = ANY($1::text[])`,
        [planCodes]
      )
      if ((planned.rows[0]?.n ?? 0) > 0) {
        await client.query('ROLLBACK')
        return { success: false, error: '정비계획에 포함된 시설은 삭제할 수 없습니다.' }
      }
      await client.query(`DELETE FROM layer.spf_check WHERE cons_code = $1`, [consCode])
      await client.query(`DELETE FROM layer.spf_eval WHERE cons_code = $1`, [consCode])
      await client.query(`DELETE FROM layer.spf_report_target WHERE cons_code = $1`, [consCode])
      await client.query(`DELETE FROM layer.spf_bridge_group WHERE cons_code = $1`, [consCode])
      for (const t of SPF_TYPE_TABLES) {
        await client.query(
          `UPDATE layer.${t.table} SET parent_cons_code = NULL, parent_fac_name = NULL WHERE parent_cons_code = $1`,
          [consCode]
        )
      }
    }
    await client.query(`DELETE FROM layer.${meta.table} WHERE id = $1`, [localId])
    await client.query(
      `
      UPDATE layer.spf_report r SET target_count = (
        SELECT count(*)::int FROM (
          SELECT cons_code FROM layer.spf_report_target WHERE report_id = r.id
          UNION
          SELECT cons_code FROM layer.spf_check WHERE report_id = r.id
        ) u
      )
      WHERE EXISTS (SELECT 1 FROM layer.spf_report_target t WHERE t.report_id = r.id)
    `
    )
    await client.query('COMMIT')
    return { success: true }
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => undefined)
    return svcErr(e)
  } finally {
    client.release()
  }
}

/**
 * 점검 상세용 — {관리번호}/{점검연도}/ 첨부 전체(위험도·구분·현장조사·기타).
 * 연도 폴더가 없으면 루트의 안전점검 파일(구버전 평탄 구조)로 대신한다.
 */
export async function getInspectionFiles(params: {
  facilityId?: string
  date?: string
}): Promise<
  | {
      success: true
      file: SmallPublicFile | null
      classFile: SmallPublicFile | null
      fieldFile: SmallPublicFile | null
      files: SmallPublicFile[]
    }
  | { success: false; error: string }
> {
  const cons = String(params?.facilityId ?? '').trim()
  if (!MNG_DIR_RE.test(cons)) {
    return { success: true, file: null, classFile: null, fieldFile: null, files: [] }
  }
  try {
    const entries = await listAttachmentEntries(smallPublicRoot(), cons)
    const byYear = mapAttachmentsByYear(cons, entries)
    const y = String(params?.date ?? '').slice(0, 4)
    const att = (y && byYear.get(y)) || byYear.get('') || null
    if (!att) return { success: true, file: null, classFile: null, fieldFile: null, files: [] }
    return {
      success: true,
      file: att.riskFile,
      classFile: att.classFile,
      fieldFile: att.fieldFile,
      files: [...att.safetyFiles, ...att.planFiles],
    }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 이관·정비계획용 — 관리번호(또는 excl:…) 목록으로 시설 조회 */
export async function getFacilitiesByIds(params: {
  facilityIds?: string[]
}): Promise<
  | { success: true; facilities: SmallPublicFacility[] }
  | { success: false; error: string }
> {
  const ids = [...new Set((params?.facilityIds ?? []).map((x) => String(x).trim()).filter(Boolean))]
  if (ids.length === 0) return { success: true, facilities: [] }
  try {
    const consCodes = ids.filter((id) => parseSpfFacilityUiId(id)?.kind === 'cons')
    const facilities: SmallPublicFacility[] = []
    if (consCodes.length > 0) {
      const facRes = await pool.query<FacDbRow>(
        `
        ${FAC_SELECT_SQL}
        WHERE cons_code = ANY($1::text[])
      `,
        [consCodes]
      )
      facilities.push(...facRes.rows.map(mapFacDbRow))
    }
    for (const id of ids) {
      if (parseSpfFacilityUiId(id)?.kind !== 'excl') continue
      const f = await fetchFacilityByUiId(id)
      if (f) facilities.push(f)
    }
    return { success: true, facilities }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 안전점검 이관 — 위험 소교량을 리 묶음 매핑(spf_bridge_group)에 등록한다.
 * 이미 등록된 소교량은 건너뛴다. 소교량이 아니거나 관리번호가 없는 id 는 무시한다.
 */
export async function registerBridgeGroupMembers(params: {
  facilityIds?: string[]
}): Promise<
  | { success: true; groups: { groupCode: string; ri: string; added: number }[] }
  | { success: false; error: string }
> {
  const consCodes = [
    ...new Set(
      (params?.facilityIds ?? [])
        .map((x) => String(x).trim())
        .filter((id) => parseSpfFacilityUiId(id)?.kind === 'cons')
    ),
  ]
  if (consCodes.length === 0) return { success: true, groups: [] }
  try {
    const bridges = await pool.query<{ cons_code: string; sisul_name: string }>(
      `SELECT cons_code, sisul_name FROM layer.spf_bridge WHERE cons_code = ANY($1::text[])`,
      [consCodes]
    )
    const added = new Map<string, { groupCode: string; ri: string; added: number }>()
    for (const b of bridges.rows) {
      const ri = bridgeRiOfName(b.sisul_name)
      if (!ri) continue
      const groupCode = bridgeGroupCodeOfRi(ri)
      const ins = await pool.query(
        `INSERT INTO layer.spf_bridge_group (group_code, ri, cons_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (cons_code) DO NOTHING`,
        [groupCode, ri, b.cons_code]
      )
      const cur = added.get(groupCode) ?? { groupCode, ri, added: 0 }
      cur.added += ins.rowCount ?? 0
      added.set(groupCode, cur)
    }
    return { success: true, groups: [...added.values()] }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 저장소·데이터 폴더에 두는 시드 JSON (폴더 순회 대신 읽음) */
export function smallPublicSeedJsonRepoPath(): string {
  return path.join(
    process.cwd(),
    'src',
    'app',
    '(pages)',
    'map',
    '_mapContents',
    'smallPublic',
    'smallPublicSeed.json'
  )
}

function smallPublicSeedJsonDataPath(root: string): string {
  return path.join(root, 'seed.json')
}

async function readSeedJsonFile(filePath: string): Promise<SmallPublicSeedPayload | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const data = JSON.parse(raw) as SmallPublicSeedPayload
    if (!Array.isArray(data?.facilities) || data.facilities.length === 0) return null
    return {
      ...data,
      inspections: data.inspections ?? [],
      candidateEvals: data.candidateEvals ?? [],
      safetyDocs: data.safetyDocs ?? [],
      source: {
        root: data.source?.root ?? '',
        shpDir: data.source?.shpDir ?? '',
        dbfFiles: data.source?.dbfFiles ?? [],
        attachmentDirs: data.source?.attachmentDirs ?? 0,
        matched: data.facilities.length,
        fromJson: filePath,
      },
    }
  } catch {
    return null
  }
}

/**
 * file_data/small_public 디스크를 읽어 시드 페이로드 생성.
 * root·shpDir 을 넘기면 GGNR 경로 resolve 없이 그 폴더를 쓴다(덤프 스크립트용).
 */
export async function buildSeedFromDisk(
  root = smallPublicRoot(),
  shpDir = smallPublicShpDir()
): Promise<SmallPublicSeedPayload> {
  const attachmentDirs = await listMngAttachmentDirs(root)
  const attachSet = new Set(attachmentDirs)
  const dbfPaths = pickDbfFiles(root, shpDir)

  const seedFacilities: SeedFacility[] = []
  const seen = new Set<string>()

  for (const dbfPath of dbfPaths) {
    const baseName = path.basename(dbfPath, path.extname(dbfPath))
    const dir = path.dirname(dbfPath)
    const shpPath = path.join(dir, `${baseName}.shp`)
    const shxPath = path.join(dir, `${baseName}.shx`)
    const rawBuf = fsSync.readFileSync(dbfPath)
    const nrec = rawBuf.readUInt32LE(4)
    const geoms = readShpGeoms(shpPath, shxPath, nrec)
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

    for (let i = 0; i < nrec; i++) {
      const rec = rawBuf.subarray(hlen + i * rlen, hlen + (i + 1) * rlen)
      if (!rec.length || rec[0] === 0x2a) continue
      let off = 1
      const row: DbfRow = {}
      for (const f of fields) {
        row[f.name] = decodeCp949(rec.subarray(off, off + f.length))
        off += f.length
      }
      const mngNo = (row.CONS_CODE || '').trim()
      if (!mngNo || !attachSet.has(mngNo) || seen.has(mngNo)) continue
      seen.add(mngNo)

      const fileEntries = await listAttachmentEntries(root, mngNo)
      const att = mapAttachments(mngNo, fileEntries)
      const type = asFacType(row.TYPE || '', dbfPath)
      const candidate = asCandidate(row.CANDIDATE || '')
      const coords = geoms[i] ?? null

      seedFacilities.push({
        id: mngNo,
        mngNo,
        name: (row.SISUL_NAME || '').trim() || mngNo,
        geomCode: (row.SHP_CODE || '').trim(),
        type,
        emd: (row.EMD || '').trim(),
        ri: (row.RI || '').trim(),
        address: (row.ADDRESS || '').trim(),
        startXy: (row.START_XY || '').trim(),
        endXy: (row.END_XY || '').trim(),
        riskRank: (row.RISK_RANK || '').trim(),
        riskScore: (row.RISK_SCORE || '').trim(),
        benefitArea: (row.BEN_AREA || '').trim(),
        riskDate: normalizeDate(row.RISK_DATE || ''),
        surveyDate: normalizeDate(row.SURV_DATE || ''),
        surveyor: (row.SURV_NAME || '').trim(),
        candidate,
        length: numText(row.LEN || ''),
        width: numText(row.WIDTH || ''),
        height: numText(row.HIGHT || row.HEIGHT || ''),
        parentFacId: null,
        parentFacName: '',
        coords,
        planFiles: att.planFiles,
        damageEvents: [],
        inspectionTarget: candidate === '위험',
        _att: att,
      })
    }
  }

  /** 부모·부속 — shp에 관계 필드 없음. 읍면·리 추정 연결 금지. */

  seedFacilities.sort((a, b) => a.mngNo.localeCompare(b.mngNo, 'en'))

  const baseInspections = buildInspections(seedFacilities)
  const baseCandidateEvals = buildCandidateEvals(seedFacilities)
  const baseSafetyDocs = buildSafetyDocs(seedFacilities)
  const demo = applyDemoScenarios(seedFacilities, baseInspections, baseCandidateEvals, baseSafetyDocs)
  const inspections = ensureYear2025Complete(demo.facilities, demo.inspections)

  const facilities: SmallPublicFacility[] = demo.facilities.map(({ _att: _a, ...rest }) => rest)
  const candidateEvals = demo.candidateEvals
  const safetyDocs = demo.safetyDocs

  return {
    facilities,
    inspections,
    candidateEvals,
    safetyDocs,
    source: {
      root,
      shpDir,
      dbfFiles: dbfPaths.map((p) => path.basename(p)),
      attachmentDirs: attachmentDirs.length,
      matched: facilities.length,
    },
  }
}

/** 시드 JSON 저장 — dataDir seed.json + 저장소 smallPublicSeed.json */
export async function writeSeedJson(
  payload: SmallPublicSeedPayload,
  opts?: { dataRoot?: string; repoPath?: string }
): Promise<{ dataPath: string; repoPath: string; bytes: number; matched: number }> {
  const dataRoot = opts?.dataRoot ?? smallPublicRoot()
  const dataPath = smallPublicSeedJsonDataPath(dataRoot)
  const repoPath = opts?.repoPath ?? smallPublicSeedJsonRepoPath()
  const body = `${JSON.stringify(payload)}\n`
  await fs.mkdir(path.dirname(dataPath), { recursive: true })
  await fs.mkdir(path.dirname(repoPath), { recursive: true })
  await fs.writeFile(dataPath, body, 'utf8')
  await fs.writeFile(repoPath, body, 'utf8')
  return { dataPath, repoPath, bytes: Buffer.byteLength(body, 'utf8'), matched: payload.facilities.length }
}

/**
 * 시드 반환 — layer.spf_* DB 우선, 없으면 seed.json, 없으면 디스크 스캔.
 * params.rebuild === true 이면 JSON/디스크 경로(DB 건너뜀).
 * params.fromDisk === true 이면 DB·JSON 건너뛰고 디스크만.
 */
export async function loadSeed(params?: Record<string, unknown>): Promise<SmallPublicSeedPayload> {
  const rebuild = Boolean(params?.rebuild)
  const fromDiskOnly = Boolean(params?.fromDisk)
  const root = smallPublicRoot()

  if (!rebuild && !fromDiskOnly) {
    try {
      const fromDb = await loadFromDb()
      if (fromDb && fromDb.facilities.length > 0) return stripInspectionPayloadForms(fromDb)
    } catch (e) {
      console.warn('[smallPublicService.loadSeed] DB 로드 실패, seed.json으로 대체', e)
    }
  }

  if (!rebuild && !fromDiskOnly) {
    const fromData = await readSeedJsonFile(smallPublicSeedJsonDataPath(root))
    if (fromData) return stripInspectionPayloadForms(fromData)
    const fromRepo = await readSeedJsonFile(smallPublicSeedJsonRepoPath())
    if (fromRepo) return stripInspectionPayloadForms(fromRepo)
  }
  const payload = await buildSeedFromDisk(root, smallPublicShpDir())
  if (rebuild) {
    try {
      await writeSeedJson(payload, { dataRoot: root })
    } catch {
      /* 쓰기 실패해도 시드 응답은 유지 */
    }
  }
  return stripInspectionPayloadForms(payload)
}

/** 디스크 스캔 후 seed.json 덤프 */
export async function dumpSeed(params?: Record<string, unknown>): Promise<{
  ok: boolean
  dataPath: string
  repoPath: string
  bytes: number
  matched: number
  ms: number
}> {
  const dataRoot =
    typeof params?.dataRoot === 'string' && params.dataRoot.trim()
      ? turbopackOpaquePath(path.normalize(params.dataRoot.trim()))
      : smallPublicRoot()
  const shpDir =
    typeof params?.shpDir === 'string' && params.shpDir.trim()
      ? turbopackOpaquePath(path.normalize(params.shpDir.trim()))
      : path.join(dataRoot, 'shp')
  const t0 = Date.now()
  const payload = await buildSeedFromDisk(dataRoot, shpDir)
  const written = await writeSeedJson(payload, { dataRoot })
  return { ok: true, ...written, ms: Date.now() - t0 }
}

/**
 * 첨부 파일 절대경로 해석 (API 라우트용).
 * scope+year 있으면 {관리번호}/{안전점검|후보지}_{year}/(안전점검은 예전 {year}/ 도),
 * scope 없이 year 만 있으면 안전점검으로 보고, year 가 없으면 루트→구분·연도 폴더 순 탐색.
 */
export async function resolveAttachmentPath(params: {
  mngNo?: string
  name?: string
  year?: string
  scope?: SmallPublicAttachScope
}): Promise<string | null> {
  const mngNo = String(params.mngNo ?? '').trim()
  const name = String(params.name ?? '').trim()
  const year = String(params.year ?? '').trim()
  if (!MNG_DIR_RE.test(mngNo)) return null
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return null
  if (year && !/^\d{4}$/.test(year)) return null

  const base = path.join(smallPublicRoot(), mngNo)
  const tryStat = async (abs: string) => {
    try {
      const st = await fs.stat(abs)
      return st.isFile() ? turbopackOpaquePath(abs) : null
    } catch {
      return null
    }
  }

  const scope = params.scope
  if (scope === 'common') return tryStat(path.join(base, name))
  if (year) {
    const s: 'inspection' | 'candidate' = scope === 'candidate' ? 'candidate' : 'inspection'
    const hit = await tryStat(path.join(base, smallPublicScopeDirName(s, year), name))
    if (hit || s === 'candidate') return hit
    /** 예전 {연도}/ 폴더(안전점검) */
    return tryStat(path.join(base, year, name))
  }
  const atRoot = await tryStat(path.join(base, name))
  if (atRoot) return atRoot
  try {
    const entries = await fs.readdir(base, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory() || !parseSmallPublicScopeDir(e.name)) continue
      const hit = await tryStat(path.join(base, e.name, name))
      if (hit) return hit
    }
  } catch {
    return null
  }
  return null
}
