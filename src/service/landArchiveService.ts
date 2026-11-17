/**
 * 지적기록물 — layer 기록물 표 기준 목록·스캔 파일
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { pool } from '@/database/db'
import { getSessionUsrId } from '@/lib/auth/guard'
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths'
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath'
import {
  getLandArchiveLedgerType,
  type LandArchiveDocType,
  type LandArchiveFile,
  type LandArchiveLedgerType,
  type LandArchiveParcelGeom,
  type LandArchiveParcelRef,
} from '@/app/(pages)/map/_mapContents/landArchive/landArchiveConfig'

type Params = Record<string, unknown>

type QueryRow = Record<string, unknown>

type ParcelSrc = {
  table: string
  pk: string
  label: string
  code: LandArchiveDocType
  hjdon: string
  jibun: string
  kind?: string
  kown?: string
  page?: string
  san?: string
}

type DualSrc = {
  table: string
  pk: string
  label: string
  code: LandArchiveDocType
  kind?: string
  kown?: string
  page?: string
}

type VolumeSrc = {
  table: string
  pk: string
  label: string
  code: LandArchiveDocType
  key: string
  kind?: string
  page?: string
}

type OrgSrc = {
  table: string
  pk: string
  label: string
  code: LandArchiveDocType
  key: string
  kind?: string
  kown?: string
  page?: string
}

const PARCEL_SOURCES: ParcelSrc[] = [
  {
    table: 'ms_data',
    pk: 'data_no',
    label: '구대장',
    code: 'ledger',
    hjdon: 'HJDON_NAME',
    jibun: 'JIBUN_DSP',
    kind: 'KIND_NAME',
    kown: 'KWON_NO',
    page: 'PAGE_NO',
    san: 'SAN_CODE',
  },
  {
    table: 'dj_cadamap',
    pk: 'cadamap_no',
    label: '지적도',
    code: 'map',
    hjdon: 'HJDON_NAME',
    jibun: 'JIBUN_DSP',
    kind: 'KIND_NAME',
    kown: 'KWON_NO',
    page: 'PAGE_NO',
    san: 'SAN_CODE',
  },
  {
    table: 'dj_landjosa',
    pk: 'landjosa_no',
    label: '토지조사부',
    code: 'landjosa',
    hjdon: 'HJDON_NAME',
    jibun: 'JIBUN_DSP',
    kind: 'KIND_NAME',
    kown: 'KWON_NO',
    page: 'PAGE_NO',
    san: 'SAN_CODE',
  },
  {
    table: 'dj_spms',
    pk: 'spms_no',
    label: '특조법',
    code: 'spms',
    hjdon: 'HJDON_NAME',
    jibun: 'JIBUN_DSP',
    kind: 'KIND_NAME',
    kown: 'KWON_NO',
    page: 'PAGE_NO',
    san: 'SAN_CODE',
  },
  {
    table: 'dj_survchklist',
    pk: 'surv_no',
    label: '측량성과검사정리부',
    code: 'survchk',
    hjdon: 'HJDON_NAME',
    jibun: 'JIBUN_DSP',
    kind: 'KIND_NAME',
    kown: 'KWON_NO',
    page: 'PAGE_NO',
    san: 'SAN_CODE',
  },
  {
    table: 'dj_topographic',
    pk: 'topographic_no',
    label: '기초측량부',
    code: 'topo',
    hjdon: 'HJDON_NAME',
    jibun: 'JIBUN_DSP',
    kind: 'KIND_NAME',
    kown: 'KWON_NO',
    page: 'PAGE_NO',
    san: 'SAN_CODE',
  },
]

const DUAL_SOURCES: DualSrc[] = [
  {
    table: 'dj_area',
    pk: 'area_no',
    label: '면적측정부',
    code: 'area',
    kown: 'KWON_NO',
    page: 'PAGE_NO',
  },
  {
    table: 'dj_landmove',
    pk: 'landmove_no',
    label: '이동지결의서',
    code: 'move',
    kind: 'KIND_NAME',
    kown: 'KWON_NO',
    page: 'PAGE_NO',
  },
]

const VOLUME_SOURCES: VolumeSrc[] = [
  {
    table: 'dj_hwanji_image',
    pk: 'himg_no',
    label: '환지대장',
    code: 'hwanji',
    key: 'KWON_NO',
    kind: 'KIND_NAME',
    page: 'PAGE_NO',
  },
]

/** 측량결과도 — 본표는 스캔, 지번은 하위 표 */
const MEASURE_SOURCE = {
  table: 'dj_measure',
  subTable: 'dj_measure_sub',
  pk: 'mea_no',
  label: '측량결과도',
  code: 'survey' as const,
  kind: 'KIND_NAME',
  kown: 'KWON_NO',
  page: 'PAGE_NO',
}

const ORG_SOURCES: OrgSrc[] = [
  {
    table: 'dj_nocorp',
    pk: 'nocorp_no',
    label: '비법인대장',
    code: 'nocorp',
    key: 'REGIST_NAME',
    kind: 'KIND_NAME',
    kown: 'KWON_NO',
    page: 'PAGE_NO',
  },
]

const ALL_TABLE_PK = new Map<string, string>(
  [...PARCEL_SOURCES, ...DUAL_SOURCES, ...VOLUME_SOURCES, ...ORG_SOURCES, MEASURE_SOURCE].map((s) => [
    s.table,
    s.pk,
  ])
)

const LIST_FILE_MAX = 200
const DETAIL_PARCEL_MAX = 200
const EXISTING_TTL_MS = 30_000
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp'])

/** 자료 폴더 1단 이름 → 기록물 표 */
const FOLDER_TABLES: Record<string, string[]> = {
  구대장: ['ms_data'],
  지적도: ['dj_cadamap'],
  폐쇄지적도: ['dj_cadamap'],
  토지조사부: ['dj_landjosa'],
  특조법: ['dj_spms'],
  측량성과검사정리부: ['dj_survchklist'],
  기초측량부: ['dj_topographic'],
  도근측량부: ['dj_topographic'],
  면적측정부: ['dj_area'],
  이동지결의서: ['dj_landmove'],
  측량결과도: ['dj_measure'],
  환지대장: ['dj_hwanji_image'],
  비법인대장: ['dj_nocorp'],
}

type FileRow = {
  table: string
  pk: number
  hjdon: string
  jibun: string
  kind: string
  code: LandArchiveDocType
  label: string
  volumeNo: string
  pageNo: string
  fileName: string
  ledgerType: LandArchiveLedgerType
  rel: string
  parcelCount: number
}

type ExistingFiles = { rels: string[]; set: Set<string> }

let existingCache: { root: string; data: ExistingFiles; at: number } | null = null

export type LandArchiveEmd = { code: string; name: string }

function throwHttp(status: number, message: string): never {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  throw err
}

async function requireUsr(): Promise<string> {
  const usrId = await getSessionUsrId()
  if (!usrId) throwHttp(401, '로그인이 필요합니다.')
  return usrId
}

function cell(v: unknown): string {
  return String(v ?? '').trim()
}

function landArchiveRootDir(): string {
  return path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.landArchive)
}

function joinRel(pathName: string, fileName: string): string {
  const p = pathName.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  const f = fileName.trim()
  if (!p) return f
  if (!f) return p
  if (p.toLowerCase().endsWith(`/${f.toLowerCase()}`)) return p
  return `${p}/${f}`
}

function normRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
}

function sqlCol(col: string, alias = ''): string {
  return alias ? `${alias}.${col}` : col
}

/** PATH_NAME + FILE_NAME 을 자료 폴더 상대 경로(소문자, /)로 */
function sqlRelExpr(alias = ''): string {
  const pathName = sqlCol('"PATH_NAME"', alias)
  const fileName = sqlCol('"FILE_NAME"', alias)
  return `lower(
    CASE
      WHEN COALESCE(BTRIM(${fileName}), '') = '' THEN
        trim(both '/' from replace(BTRIM(${pathName}), CHR(92), '/'))
      WHEN lower(trim(both '/' from replace(BTRIM(${pathName}), CHR(92), '/')))
           LIKE '%/' || lower(BTRIM(${fileName})) THEN
        trim(both '/' from replace(BTRIM(${pathName}), CHR(92), '/'))
      ELSE
        trim(both '/' from replace(BTRIM(${pathName}), CHR(92), '/'))
        || '/' || BTRIM(${fileName})
    END
  )`
}

function sqlPathNormExpr(alias = ''): string {
  return `lower(trim(both '/' from replace(BTRIM(${sqlCol('"PATH_NAME"', alias)}), CHR(92), '/')))`
}

function fileMatchByPath(table: string): boolean {
  return table === 'dj_cadamap'
}

/** 파일명 또는 정규화 경로 일치. OR 없이 한 쪽만 써서 인덱스를 탄다. */
function existingFileSql(
  p: unknown[],
  rels: string[],
  alias = '',
  table = ''
): string {
  if (rels.length === 0) return 'FALSE'
  if (fileMatchByPath(table)) {
    p.push(rels)
    return `${sqlPathNormExpr(alias)} = ANY($${p.length}::text[])`
  }
  const names = [
    ...new Set(rels.map((r) => (r.split('/').pop() ?? '').toLowerCase()).filter(Boolean)),
  ]
  if (names.length === 0) return 'FALSE'
  p.push(names)
  return `lower(BTRIM(${sqlCol('"FILE_NAME"', alias)})) = ANY($${p.length}::text[])`
}

function relsForTable(rels: string[], table: string): string[] {
  return rels.filter((rel) => (FOLDER_TABLES[rel.split('/')[0] ?? ''] ?? []).includes(table))
}

async function walkImages(dir: string, rel = ''): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkImages(abs, nextRel)))
      continue
    }
    if (!entry.isFile()) continue
    if (!IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) continue
    out.push(normRel(nextRel))
  }
  return out
}

async function loadExistingFiles(): Promise<ExistingFiles> {
  const root = path.resolve(landArchiveRootDir())
  const now = Date.now()
  if (
    existingCache &&
    existingCache.root === root &&
    now - existingCache.at < EXISTING_TTL_MS
  ) {
    return existingCache.data
  }
  const rels = [...new Set(await walkImages(root))]
  const data: ExistingFiles = { rels, set: new Set(rels) }
  existingCache = { root, data, at: now }
  return data
}

function tablesForExisting(rels: string[]): Set<string> | null {
  const tables = new Set<string>()
  let unknown = false
  for (const rel of rels) {
    const top = rel.split('/')[0] ?? ''
    const mapped = FOLDER_TABLES[top]
    if (!mapped) {
      unknown = true
      break
    }
    for (const t of mapped) tables.add(t)
  }
  return unknown ? null : tables
}

function keepExisting(rows: FileRow[], set: Set<string>): FileRow[] {
  return rows.filter((r) => set.has(r.rel))
}

function qIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throwHttp(500, '잘못된 식별자입니다.')
  return `"${name}"`
}

function splitHjdon(name: string): { emd: string; ri: string } {
  const s = name.replace(/\s+/g, ' ').trim()
  const i = s.indexOf(' ')
  if (i < 0) return { emd: s, ri: '' }
  return { emd: s.slice(0, i), ri: s.slice(i + 1) }
}

function isLotQuery(kw: string): boolean {
  return /^산?\d/u.test(kw.replace(/\s+/g, ''))
}

function encodeFileId(table: string, pk: number): string {
  return `f:${table}:${pk}`
}

function parseFileId(id: string): { table: string; pk: number } | null {
  const m = /^f:([a-z0-9_]+):(\d+)$/.exec(id)
  if (!m) return null
  const table = m[1] ?? ''
  const pk = Number(m[2])
  if (!ALL_TABLE_PK.has(table) || !Number.isFinite(pk) || pk <= 0) return null
  return { table, pk }
}

/** 이동지결의서 장 구분(조서·집계표 등) — 종류 칸에는 대장 이름을 쓴다. */
const LANDMOVE_PAGE_KINDS = new Set(['조서', '결의서', '집계표', '구비서류'])

function mapKindToCode(kind: string, fallback: LandArchiveDocType): LandArchiveDocType {
  if (kind.includes('공유지')) return 'shared'
  if (kind.includes('폐쇄지적') || kind.includes('폐쇄임야') || kind.includes('폐쇄토지')) return 'closed'
  if (kind.includes('지적도') || kind.includes('임야도') || kind.includes('원도') || kind.includes('일람') || kind.includes('색인'))
    return 'map'
  if (kind.includes('측량결과')) return 'survey'
  if (kind.includes('환지')) return 'hwanji'
  if (kind.includes('토지조사')) return 'landjosa'
  if (kind.includes('측량성과검사')) return 'survchk'
  if (kind.includes('면적측정')) return 'area'
  if (kind.includes('이동지') || LANDMOVE_PAGE_KINDS.has(kind)) return fallback
  return fallback
}

function mapLedgerType(kind: string, jibun: string, san: string): LandArchiveLedgerType {
  if (kind.includes('임야')) return 'forest'
  if (/^산/.test(jibun.replace(/\s+/g, ''))) return 'forest'
  if (san === '1' || san === '01') return 'forest'
  return 'land'
}

function displayKind(kind: string, fallback: string): string {
  if (!kind || LANDMOVE_PAGE_KINDS.has(kind)) return fallback
  return kind
}

function volumeLabel(raw: string): string {
  const n = Number(raw.replace(/^0+/, '') || raw)
  return Number.isFinite(n) && n > 0 ? `권 ${n}` : raw ? `권 ${raw}` : ''
}

function hjdonFilterSql(col: string, emdParam: string): string {
  return `(${col} = ${emdParam} OR ${col} LIKE ${emdParam} || ' %')`
}

function addrFilterSql(hjdonCol: string, jibunCol: string, emd: string, kw: string, p: unknown[]): string {
  const parts: string[] = []
  if (emd) {
    p.push(emd)
    parts.push(hjdonFilterSql(hjdonCol, `$${p.length}`))
  }
  if (kw) {
    if (isLotQuery(kw)) {
      p.push(kw.replace(/\s+/g, ''))
      parts.push(`replace(COALESCE(${jibunCol}, ''), ' ', '') ILIKE $${p.length} || '%'`)
    } else {
      p.push(`%${kw.replace(/\s+/g, '')}%`)
      parts.push(
        `replace(COALESCE(${hjdonCol}, '') || COALESCE(${jibunCol}, ''), ' ', '') ILIKE $${p.length}`
      )
    }
  }
  return parts.length ? parts.join(' AND ') : 'TRUE'
}

function dualHjdonExpr(): string {
  return `COALESCE(NULLIF(BTRIM("AF_HJDON_NAME"), ''), NULLIF(BTRIM("BF_HJDON_NAME"), ''))`
}

function dualJibunExpr(): string {
  return `COALESCE(NULLIF(BTRIM("AF_JIBUN_DSP"), ''), NULLIF(BTRIM("BF_JIBUN_DSP"), ''))`
}

function measureSubHjdonExpr(alias = 's'): string {
  return `COALESCE(NULLIF(BTRIM(${alias}."AF_HJDON_NAME"), ''), NULLIF(BTRIM(${alias}."BF_HJDON_NAME"), ''))`
}

function measureSubJibunExpr(alias = 's'): string {
  return `COALESCE(NULLIF(BTRIM(${alias}."AF_JIBUN_DSP"), ''), NULLIF(BTRIM(${alias}."BF_JIBUN_DSP"), ''))`
}

function measureSubSanExpr(alias = 's'): string {
  return `COALESCE(NULLIF(BTRIM(${alias}."AF_SAN_CODE"), ''), NULLIF(BTRIM(${alias}."BF_SAN_CODE"), ''))`
}

function measureJoinSql(mainAlias = 'm', subAlias = 's'): string {
  return `${subAlias}."ROLL_NO" = ${mainAlias}."ROLL_NO"
      AND ${subAlias}."FRAME_NO" = ${mainAlias}."FRAME_NO"
      AND ${subAlias}."SR_NO" = ${mainAlias}."SR_NO"`
}

async function query(sql: string, params: unknown[]): Promise<QueryRow[]> {
  const res = await pool.query(sql, params)
  return (res.rows ?? []) as QueryRow[]
}

function asInt(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function fileNameOf(pathName: string, fileName: string): string {
  if (fileName) return fileName
  const parts = pathName.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

function stripLeadZero(raw: string): string {
  return raw.replace(/^0+/, '') || raw
}

function isVolumeLike(row: FileRow): boolean {
  return VOLUME_SOURCES.some((s) => s.table === row.table)
}

function parcelRefFromRow(row: FileRow): LandArchiveParcelRef | null {
  if (isVolumeLike(row)) return null
  if (ORG_SOURCES.some((s) => s.table === row.table)) {
    if (!row.hjdon) return null
    return { emd: row.hjdon, ri: '', jibun: '' }
  }
  if (!row.hjdon || !row.jibun) return null
  const loc = splitHjdon(row.hjdon)
  return { emd: loc.emd, ri: loc.ri, jibun: row.jibun }
}

function toFileItem(row: FileRow, parcels?: LandArchiveParcelRef[], total?: number): LandArchiveFile {
  const ledger = getLandArchiveLedgerType(row.ledgerType)
  const first = parcels?.[0] ?? parcelRefFromRow(row)
  const parcelCount = total ?? row.parcelCount ?? (first ? 1 : 0)
  return {
    id: encodeFileId(row.table, row.pk),
    docType: row.code,
    docTypeLabel: row.kind || row.label,
    ledgerType: row.ledgerType,
    ledgerTypeLabel: ledger.label,
    volumeNo: stripLeadZero(row.volumeNo),
    pageNo: stripLeadZero(row.pageNo),
    fileName: row.fileName,
    previewUrl: `/api/land-archive/image?t=${encodeURIComponent(row.table)}&n=${row.pk}`,
    parcelCount,
    firstParcel: first,
    ...(parcels ? { parcels } : {}),
  }
}

function parseFileRow(srcLabel: string, srcCode: LandArchiveDocType, r: QueryRow, table: string, pkCol: string): FileRow {
  const kind = cell(r.kind)
  const jibun = cell(r.jibun)
  const code = mapKindToCode(kind, srcCode)
  const pathName = cell(r.path_name)
  const rawFile = cell(r.file_name)
  const fileName = fileNameOf(pathName, rawFile)
  return {
    table,
    pk: asInt(r[pkCol] ?? r.pk),
    hjdon: cell(r.hjdon),
    jibun,
    kind: displayKind(kind, srcLabel),
    code,
    label: srcLabel,
    volumeNo: cell(r.kown),
    pageNo: cell(r.page),
    fileName,
    ledgerType: mapLedgerType(kind, jibun, cell(r.san)),
    rel: normRel(joinRel(pathName, rawFile)),
    parcelCount: r.parcel_n == null || r.parcel_n === '' ? 1 : Math.max(0, asInt(r.parcel_n)),
  }
}

async function listParcelSource(
  src: ParcelSrc,
  emd: string,
  kw: string,
  rels: string[]
): Promise<FileRow[]> {
  if (rels.length === 0) return []
  const p: unknown[] = []
  const hj = qIdent(src.hjdon)
  const jb = qIdent(src.jibun)
  const where = addrFilterSql(hj, jb, emd, kw, p)
  const exist = existingFileSql(p, rels, '', src.table)
  const kindCol = src.kind ? qIdent(src.kind) : `''`
  const kownCol = src.kown ? qIdent(src.kown) : `''`
  const pageCol = src.page ? qIdent(src.page) : `''`
  const sanCol = src.san ? qIdent(src.san) : `''`
  const relExpr = sqlRelExpr()
  const sql = `
    SELECT MIN(${qIdent(src.pk)})::int AS pk,
           MIN(${hj}) AS hjdon,
           MIN(${jb}) AS jibun,
           MIN(${kindCol}) AS kind,
           MIN(${kownCol}) AS kown,
           MIN(${pageCol}) AS page,
           MIN(${sanCol}) AS san,
           MIN("PATH_NAME") AS path_name,
           MIN("FILE_NAME") AS file_name,
           COUNT(DISTINCT (${hj} || E'\\t' || ${jb}))::int AS parcel_n
    FROM layer.${qIdent(src.table)}
    WHERE COALESCE(${hj}, '') <> '' AND COALESCE(${jb}, '') <> ''
      AND ${where}
      AND ${exist}
    GROUP BY ${relExpr}
    LIMIT ${LIST_FILE_MAX}`
  const rows = await query(sql, p)
  return rows.map((r) => parseFileRow(src.label, src.code, r, src.table, 'pk'))
}

async function listDualSource(
  src: DualSrc,
  emd: string,
  kw: string,
  rels: string[]
): Promise<FileRow[]> {
  if (rels.length === 0) return []
  const p: unknown[] = []
  const hj = dualHjdonExpr()
  const jb = dualJibunExpr()
  const where = addrFilterSql(hj, jb, emd, kw, p)
  const exist = existingFileSql(p, rels, '', src.table)
  const kindCol = src.kind ? qIdent(src.kind) : `''`
  const kownCol = src.kown ? qIdent(src.kown) : `''`
  const pageCol = src.page ? qIdent(src.page) : `''`
  const relExpr = sqlRelExpr()
  const parcelKey = `CASE
           WHEN COALESCE(${hj}, '') <> '' AND COALESCE(${jb}, '') <> '' THEN ${hj} || E'\\t' || ${jb}
           ELSE NULL
         END`
  const sql = `
    SELECT MIN(${qIdent(src.pk)})::int AS pk,
           MIN(NULLIF(${hj}, '')) AS hjdon,
           MIN(NULLIF(${jb}, '')) AS jibun,
           MIN(${kindCol}) AS kind,
           MIN(${kownCol}) AS kown,
           MIN(${pageCol}) AS page,
           '' AS san,
           MIN("PATH_NAME") AS path_name,
           MIN("FILE_NAME") AS file_name,
           COUNT(DISTINCT ${parcelKey})::int AS parcel_n
    FROM layer.${qIdent(src.table)}
    WHERE ${exist}
      AND ${where}
    GROUP BY ${relExpr}
    LIMIT ${LIST_FILE_MAX}`
  const rows = await query(sql, p)
  return rows.map((r) => parseFileRow(src.label, src.code, r, src.table, 'pk'))
}

async function listVolumeSource(src: VolumeSrc, kw: string, rels: string[]): Promise<FileRow[]> {
  if (rels.length === 0) return []
  const p: unknown[] = []
  const exist = existingFileSql(p, rels, '', src.table)
  const keyCol = qIdent(src.key)
  const kwSql = kw
    ? (() => {
        p.push(kw.replace(/\s+/g, ''))
        return `(BTRIM(${keyCol}) ILIKE '%' || $${p.length} || '%' OR LTRIM(BTRIM(${keyCol}), '0') = LTRIM($${p.length}, '0'))`
      })()
    : 'TRUE'
  const kindCol = src.kind ? qIdent(src.kind) : `''`
  const pageCol = src.page ? qIdent(src.page) : `''`
  const relExpr = sqlRelExpr()
  const sql = `
    SELECT MIN(${qIdent(src.pk)})::int AS pk,
           '' AS hjdon,
           MIN(BTRIM(${keyCol})) AS jibun,
           MIN(${kindCol}) AS kind,
           MIN(BTRIM(${keyCol})) AS kown,
           MIN(${pageCol}) AS page,
           '' AS san,
           MIN("PATH_NAME") AS path_name,
           MIN("FILE_NAME") AS file_name,
           0 AS parcel_n
    FROM layer.${qIdent(src.table)}
    WHERE ${exist}
      AND ${kwSql}
    GROUP BY ${relExpr}
    LIMIT ${LIST_FILE_MAX}`
  const rows = await query(sql, p)
  return rows.map((r) => {
    const row = parseFileRow(src.label, src.code, r, src.table, 'pk')
    row.jibun = volumeLabel(cell(r.jibun) || cell(r.kown))
    row.hjdon = src.label
    row.parcelCount = 0
    return row
  })
}

async function listOrgSource(src: OrgSrc, kw: string, rels: string[]): Promise<FileRow[]> {
  if (rels.length === 0) return []
  const p: unknown[] = []
  const exist = existingFileSql(p, rels, '', src.table)
  const keyCol = qIdent(src.key)
  const kwSql = kw
    ? (() => {
        p.push(`%${kw}%`)
        return `COALESCE(${keyCol}, '') ILIKE $${p.length}`
      })()
    : 'TRUE'
  const kindCol = src.kind ? qIdent(src.kind) : `''`
  const kownCol = src.kown ? qIdent(src.kown) : `''`
  const pageCol = src.page ? qIdent(src.page) : `''`
  const relExpr = sqlRelExpr()
  const sql = `
    SELECT MIN(${qIdent(src.pk)})::int AS pk,
           MIN(BTRIM(${keyCol})) AS hjdon,
           '' AS jibun,
           MIN(${kindCol}) AS kind,
           MIN(${kownCol}) AS kown,
           MIN(${pageCol}) AS page,
           '' AS san,
           MIN("PATH_NAME") AS path_name,
           MIN("FILE_NAME") AS file_name,
           1 AS parcel_n
    FROM layer.${qIdent(src.table)}
    WHERE ${exist}
      AND ${kwSql}
    GROUP BY ${relExpr}
    LIMIT ${LIST_FILE_MAX}`
  const rows = await query(sql, p)
  return rows.map((r) => parseFileRow(src.label, src.code, r, src.table, 'pk'))
}

async function listMeasureSource(emd: string, kw: string, rels: string[]): Promise<FileRow[]> {
  if (rels.length === 0) return []
  const p: unknown[] = []
  const hj = measureSubHjdonExpr('s')
  const jb = measureSubJibunExpr('s')
  const parcelWhere = addrFilterSql(hj, jb, emd, kw, p)
  const kownCol = qIdent(MEASURE_SOURCE.kown)
  let where = parcelWhere
  if (kw && !emd) {
    p.push(kw.replace(/\s+/g, ''))
    const kownSql = `(BTRIM(m.${kownCol}) ILIKE '%' || $${p.length} || '%' OR LTRIM(BTRIM(m.${kownCol}), '0') = LTRIM($${p.length}, '0'))`
    where = `(${parcelWhere} OR ${kownSql})`
  }
  const exist = existingFileSql(p, rels, 'm', MEASURE_SOURCE.table)
  const kindCol = qIdent(MEASURE_SOURCE.kind)
  const pageCol = qIdent(MEASURE_SOURCE.page)
  const san = measureSubSanExpr('s')
  const relExpr = sqlRelExpr('m')
  const joinOn = measureJoinSql('m', 's')
  const parcelKey = `CASE
           WHEN COALESCE(${hj}, '') <> '' AND COALESCE(${jb}, '') <> '' THEN ${hj} || E'\\t' || ${jb}
           ELSE NULL
         END`
  const sql = `
    WITH m AS MATERIALIZED (
      SELECT m.*
      FROM layer.${qIdent(MEASURE_SOURCE.table)} m
      WHERE ${exist}
    )
    SELECT MIN(m.${qIdent(MEASURE_SOURCE.pk)})::int AS pk,
           MIN(NULLIF(${hj}, '')) AS hjdon,
           MIN(NULLIF(${jb}, '')) AS jibun,
           MIN(m.${kindCol}) AS kind,
           MIN(m.${kownCol}) AS kown,
           MIN(m.${pageCol}) AS page,
           MIN(${san}) AS san,
           MIN(m."PATH_NAME") AS path_name,
           MIN(m."FILE_NAME") AS file_name,
           COUNT(DISTINCT ${parcelKey})::int AS parcel_n
    FROM m
    LEFT JOIN layer.${qIdent(MEASURE_SOURCE.subTable)} s
      ON ${joinOn}
    WHERE ${where}
    GROUP BY ${relExpr}
    LIMIT ${LIST_FILE_MAX}`
  const rows = await query(sql, p)
  return rows.map((r) => parseFileRow(MEASURE_SOURCE.label, MEASURE_SOURCE.code, r, MEASURE_SOURCE.table, 'pk'))
}

async function collectListRows(emd: string, kw: string, existing: ExistingFiles): Promise<FileRow[]> {
  const { rels, set } = existing
  if (rels.length === 0) return []
  const tables = tablesForExisting(rels)
  const use = (table: string) => !tables || tables.has(table)
  const parcelJobs = PARCEL_SOURCES.filter((s) => use(s.table)).map((s) =>
    listParcelSource(s, emd, kw, relsForTable(rels, s.table))
  )
  const dualJobs = DUAL_SOURCES.filter((s) => use(s.table)).map((s) =>
    listDualSource(s, emd, kw, relsForTable(rels, s.table))
  )
  const volumeJobs = emd
    ? []
    : VOLUME_SOURCES.filter((s) => use(s.table)).map((s) =>
        listVolumeSource(s, kw, relsForTable(rels, s.table))
      )
  const measureJobs = use(MEASURE_SOURCE.table)
    ? [listMeasureSource(emd, kw, relsForTable(rels, MEASURE_SOURCE.table))]
    : []
  const orgJobs = emd
    ? []
    : ORG_SOURCES.filter((s) => use(s.table)).map((s) =>
        listOrgSource(s, kw, relsForTable(rels, s.table))
      )
  const settled = await Promise.allSettled([
    ...parcelJobs,
    ...dualJobs,
    ...volumeJobs,
    ...measureJobs,
    ...orgJobs,
  ])
  const rows: FileRow[] = []
  for (const item of settled) {
    if (item.status === 'fulfilled') rows.push(...item.value)
  }
  return keepExisting(rows, set)
}

function groupList(rows: FileRow[]): LandArchiveFile[] {
  const items = rows.map((row) => toFileItem(row))
  items.sort((a, b) => {
    const t = a.docTypeLabel.localeCompare(b.docTypeLabel, 'ko')
    if (t !== 0) return t
    return a.fileName.localeCompare(b.fileName, 'ko', { numeric: true })
  })
  return items.slice(0, LIST_FILE_MAX)
}

export async function listEmd(_params: Params = {}): Promise<{ emd: LandArchiveEmd[] }> {
  await requireUsr()
  try {
    const rows = await query(
      `SELECT emd_cd AS code, emd_nm AS name
       FROM public_layer.emd
       WHERE emd_nm IS NOT NULL AND BTRIM(emd_nm::text) <> ''
       ORDER BY emd_cd`,
      []
    )
    const seen = new Set<string>()
    const emd: LandArchiveEmd[] = []
    for (const r of rows) {
      const code = cell(r.code)
      const name = cell(r.name)
      if (!code || !name || seen.has(code)) continue
      seen.add(code)
      emd.push({ code, name })
    }
    return { emd }
  } catch {
    return { emd: [] }
  }
}

export async function list(params: Params = {}): Promise<{ items: LandArchiveFile[] }> {
  await requireUsr()
  const emd = cell(params.emd)
  const kw = cell(params.keyword).replace(/\s+/g, ' ')
  const existing = await loadExistingFiles()
  if (existing.rels.length === 0) return { items: [] }
  const rows = await collectListRows(emd, kw, existing)
  return { items: groupList(rows) }
}

function normLot(jibun: string): string {
  return jibun.replace(/\s+/g, '')
}

function extentFromRow(r: QueryRow | undefined): [number, number, number, number] | null {
  const xmin = Number(r?.xmin)
  const ymin = Number(r?.ymin)
  const xmax = Number(r?.xmax)
  const ymax = Number(r?.ymax)
  if (![xmin, ymin, xmax, ymax].every((n) => Number.isFinite(n))) return null
  return [xmin, ymin, xmax, ymax]
}

function geomJson(v: unknown): Record<string, unknown> | null {
  let raw: unknown = v
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  if (!raw || typeof raw !== 'object') return null
  const g = raw as { type?: unknown; coordinates?: unknown }
  if (typeof g.type !== 'string' || g.coordinates == null) return null
  return raw as Record<string, unknown>
}

async function resolveParcelPrefix(emd: string, ri: string, cache: Map<string, string | null>): Promise<string | null> {
  const cacheKey = `${emd}\t${ri}`
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null
  const emdRows = await query(
    `SELECT emd_cd AS code FROM public_layer.emd WHERE emd_nm = $1 LIMIT 1`,
    [emd]
  )
  const emdCd = cell(emdRows[0]?.code)
  if (!emdCd) {
    cache.set(cacheKey, null)
    return null
  }
  let prefix = emdCd
  if (ri) {
    const riRows = await query(
      `SELECT ri_cd AS code
       FROM public_layer.ri
       WHERE ri_cd LIKE $1 AND ri_nm = $2
       LIMIT 1`,
      [`${emdCd}%`, ri]
    )
    const riCd = cell(riRows[0]?.code)
    if (riCd) prefix = riCd
  }
  cache.set(cacheKey, prefix)
  return prefix
}

export async function locateParcel(
  params: Params = {}
): Promise<{ extent: [number, number, number, number] | null }> {
  const found = await locateParcels({
    parcels: [{ emd: params.emd, ri: params.ri, jibun: params.jibun }],
  })
  return { extent: found.items[0]?.extent ?? null }
}

export async function locateParcels(
  params: Params = {}
): Promise<{ items: LandArchiveParcelGeom[] }> {
  await requireUsr()
  const raw = Array.isArray(params.parcels) ? params.parcels : []
  const wanted: LandArchiveParcelRef[] = []
  const seen = new Set<string>()
  for (const row of raw.slice(0, DETAIL_PARCEL_MAX)) {
    const rec = row && typeof row === 'object' ? (row as Record<string, unknown>) : null
    if (!rec) continue
    const emd = cell(rec.emd)
    const ri = cell(rec.ri)
    const jibun = normLot(cell(rec.jibun))
    if (!emd || !jibun) continue
    const key = `${emd}\t${ri}\t${jibun}`
    if (seen.has(key)) continue
    seen.add(key)
    wanted.push({ emd, ri, jibun })
  }
  if (wanted.length === 0) return { items: [] }

  const cache = new Map<string, string | null>()
  const emds: string[] = []
  const ris: string[] = []
  const prefixes: string[] = []
  const jibuns: string[] = []
  for (const p of wanted) {
    const prefix = await resolveParcelPrefix(p.emd, p.ri, cache)
    if (!prefix) continue
    emds.push(p.emd)
    ris.push(p.ri)
    prefixes.push(prefix)
    jibuns.push(p.jibun)
  }
  if (prefixes.length === 0) return { items: [] }

  const rows = await query(
    `SELECT k.emd, k.ri, k.jibun,
            ST_AsGeoJSON(ST_UnaryUnion(ST_Collect(g.geom)))::json AS geom,
            ST_XMin(ST_Extent(g.geom)) AS xmin,
            ST_YMin(ST_Extent(g.geom)) AS ymin,
            ST_XMax(ST_Extent(g.geom)) AS xmax,
            ST_YMax(ST_Extent(g.geom)) AS ymax
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS k(emd, ri, prefix, jibun)
     JOIN public_layer.jijuk j
       ON j.pnu LIKE k.prefix || '%'
      AND regexp_replace(replace(j.jibun, ' ', ''), '[가-힣]+$', '') = k.jibun
     CROSS JOIN LATERAL (
       SELECT ST_Transform(ST_SetSRID(j.geom, 5181), 3857) AS geom
     ) g
     GROUP BY k.emd, k.ri, k.jibun`,
    [emds, ris, prefixes, jibuns]
  )

  const items: LandArchiveParcelGeom[] = []
  for (const r of rows) {
    const extent = extentFromRow(r)
    const geom3857 = geomJson(r.geom)
    const emd = cell(r.emd)
    const jibun = cell(r.jibun)
    if (!extent || !geom3857 || !emd || !jibun) continue
    items.push({ emd, ri: cell(r.ri), jibun, extent, geom3857 })
  }
  return { items }
}

function findSource(table: string): {
  label: string
  code: LandArchiveDocType
  pk: string
  hjdonSql: string
  jibunSql: string
  kindSql: string
  kownSql: string
  pageSql: string
  sanSql: string
  volume: boolean
  measureSub: boolean
} | null {
  const parcel = PARCEL_SOURCES.find((s) => s.table === table)
  if (parcel) {
    return {
      label: parcel.label,
      code: parcel.code,
      pk: parcel.pk,
      hjdonSql: qIdent(parcel.hjdon),
      jibunSql: qIdent(parcel.jibun),
      kindSql: parcel.kind ? qIdent(parcel.kind) : `''`,
      kownSql: parcel.kown ? qIdent(parcel.kown) : `''`,
      pageSql: parcel.page ? qIdent(parcel.page) : `''`,
      sanSql: parcel.san ? qIdent(parcel.san) : `''`,
      volume: false,
      measureSub: false,
    }
  }
  const dual = DUAL_SOURCES.find((s) => s.table === table)
  if (dual) {
    return {
      label: dual.label,
      code: dual.code,
      pk: dual.pk,
      hjdonSql: dualHjdonExpr(),
      jibunSql: dualJibunExpr(),
      kindSql: dual.kind ? qIdent(dual.kind) : `''`,
      kownSql: dual.kown ? qIdent(dual.kown) : `''`,
      pageSql: dual.page ? qIdent(dual.page) : `''`,
      sanSql: `''`,
      volume: false,
      measureSub: false,
    }
  }
  if (table === MEASURE_SOURCE.table) {
    return {
      label: MEASURE_SOURCE.label,
      code: MEASURE_SOURCE.code,
      pk: MEASURE_SOURCE.pk,
      hjdonSql: `''`,
      jibunSql: `''`,
      kindSql: MEASURE_SOURCE.kind ? qIdent(MEASURE_SOURCE.kind) : `''`,
      kownSql: MEASURE_SOURCE.kown ? qIdent(MEASURE_SOURCE.kown) : `''`,
      pageSql: MEASURE_SOURCE.page ? qIdent(MEASURE_SOURCE.page) : `''`,
      sanSql: `''`,
      volume: false,
      measureSub: true,
    }
  }
  const volume = VOLUME_SOURCES.find((s) => s.table === table)
  if (volume) {
    const keyCol = qIdent(volume.key)
    return {
      label: volume.label,
      code: volume.code,
      pk: volume.pk,
      hjdonSql: `''`,
      jibunSql: `BTRIM(${keyCol})`,
      kindSql: volume.kind ? qIdent(volume.kind) : `''`,
      kownSql: `BTRIM(${keyCol})`,
      pageSql: volume.page ? qIdent(volume.page) : `''`,
      sanSql: `''`,
      volume: true,
      measureSub: false,
    }
  }
  const org = ORG_SOURCES.find((s) => s.table === table)
  if (org) {
    return {
      label: org.label,
      code: org.code,
      pk: org.pk,
      hjdonSql: `BTRIM(${qIdent(org.key)})`,
      jibunSql: `''`,
      kindSql: org.kind ? qIdent(org.kind) : `''`,
      kownSql: org.kown ? qIdent(org.kown) : `''`,
      pageSql: org.page ? qIdent(org.page) : `''`,
      sanSql: `''`,
      volume: false,
      measureSub: false,
    }
  }
  return null
}

function selectFileCols(src: NonNullable<ReturnType<typeof findSource>>): string {
  return `${qIdent(src.pk)} AS pk,
           ${src.hjdonSql} AS hjdon,
           ${src.jibunSql} AS jibun,
           ${src.kindSql} AS kind,
           ${src.kownSql} AS kown,
           ${src.pageSql} AS page,
           ${src.sanSql} AS san,
           "PATH_NAME" AS path_name,
           "FILE_NAME" AS file_name`
}

export async function getById(params: Params = {}): Promise<LandArchiveFile | null> {
  await requireUsr()
  const parsed = parseFileId(cell(params.id))
  if (!parsed) return null
  const src = findSource(parsed.table)
  if (!src) return null
  const existing = await loadExistingFiles()
  if (existing.rels.length === 0) return null

  const headRows = await query(
    `SELECT ${selectFileCols(src)}
     FROM layer.${qIdent(parsed.table)}
     WHERE ${qIdent(src.pk)} = $1
     LIMIT 1`,
    [parsed.pk]
  )
  const headRaw = headRows[0]
  if (!headRaw) return null
  const head = parseFileRow(src.label, src.code, headRaw, parsed.table, 'pk')
  if (src.volume) {
    head.jibun = volumeLabel(head.jibun || head.volumeNo)
    head.hjdon = src.label
    head.parcelCount = 0
  }
  if (!existing.set.has(head.rel)) return null

  if (src.volume) return toFileItem(head, [], 0)

  const p: unknown[] = []
  const fileSql = existingFileSql(p, [head.rel], src.measureSub ? 'm' : '', parsed.table)
  p.push(head.rel)
  const relParam = `$${p.length}`
  const parcelSelect = src.measureSub
    ? `WITH m AS MATERIALIZED (
         SELECT m.*
         FROM layer.${qIdent(MEASURE_SOURCE.table)} m
         WHERE ${fileSql}
           AND ${sqlRelExpr('m')} = ${relParam}
       )
       SELECT ${measureSubHjdonExpr('s')} AS hjdon, ${measureSubJibunExpr('s')} AS jibun
       FROM m
       JOIN layer.${qIdent(MEASURE_SOURCE.subTable)} s
         ON ${measureJoinSql('m', 's')}
       WHERE COALESCE(${measureSubHjdonExpr('s')}, '') <> ''
         AND COALESCE(${measureSubJibunExpr('s')}, '') <> ''`
    : `SELECT ${src.hjdonSql} AS hjdon, ${src.jibunSql} AS jibun
       FROM layer.${qIdent(parsed.table)}
       WHERE ${fileSql}
         AND ${sqlRelExpr()} = ${relParam}`
  const parcelRows = await query(
    `${parcelSelect}
     ORDER BY 1, 2
     LIMIT ${DETAIL_PARCEL_MAX}`,
    p
  )
  const seen = new Set<string>()
  const parcels: LandArchiveParcelRef[] = []
  for (const r of parcelRows) {
    const fake: FileRow = {
      ...head,
      hjdon: cell(r.hjdon),
      jibun: cell(r.jibun),
    }
    const ref = parcelRefFromRow(fake)
    if (!ref) continue
    const key = `${ref.emd}\t${ref.ri}\t${ref.jibun}`
    if (seen.has(key)) continue
    seen.add(key)
    parcels.push(ref)
  }
  const countSql = src.measureSub
    ? `WITH m AS MATERIALIZED (
         SELECT m.*
         FROM layer.${qIdent(MEASURE_SOURCE.table)} m
         WHERE ${fileSql}
           AND ${sqlRelExpr('m')} = ${relParam}
       )
       SELECT COUNT(DISTINCT (${measureSubHjdonExpr('s')} || E'\\t' || ${measureSubJibunExpr('s')}))::int AS n
       FROM m
       JOIN layer.${qIdent(MEASURE_SOURCE.subTable)} s
         ON ${measureJoinSql('m', 's')}
       WHERE COALESCE(${measureSubHjdonExpr('s')}, '') <> ''
         AND COALESCE(${measureSubJibunExpr('s')}, '') <> ''`
    : `SELECT COUNT(DISTINCT (${src.hjdonSql} || E'\\t' || ${src.jibunSql}))::int AS n
       FROM layer.${qIdent(parsed.table)}
       WHERE ${fileSql}
         AND ${sqlRelExpr()} = ${relParam}`
  const countRows = await query(countSql, p)
  const total = Math.max(parcels.length, asInt(countRows[0]?.n))
  return toFileItem(head, parcels, total)
}

/**
 * 이미지 라우트 전용 — 표에 있는 행의 경로만 실제 파일로 바꾼다.
 */
export async function resolveImagePath(input: {
  t?: unknown
  n?: unknown
  rel?: unknown
}): Promise<string | null> {
  await requireUsr()
  const table = cell(input.t)
  const n = asInt(input.n)
  const pk = ALL_TABLE_PK.get(table)
  if (!pk || n <= 0) return null
  const sql = `
    SELECT "PATH_NAME" AS path_name, "FILE_NAME" AS file_name
    FROM layer.${qIdent(table)}
    WHERE ${qIdent(pk)} = $1
    LIMIT 1`
  const rows = await query(sql, [n])
  const row = rows[0]
  if (!row) return null
  const rel = joinRel(cell(row.path_name), cell(row.file_name))
  if (!rel || rel.includes('..')) return null
  const root = path.resolve(landArchiveRootDir())
  const abs = path.resolve(root, ...rel.split('/').filter(Boolean))
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (abs !== root && !abs.toLowerCase().startsWith(prefix.toLowerCase())) return null
  return abs
}
