/**
 * 소규모 공공시설 — file_data/small_public/{관리번호} 첨부 + shp/*.dbf·shp 로 화면 시드 생성.
 * 첨부 폴더가 있는 관리번호만 포함한다.
 * 일상 로딩은 seed.json(데이터 폴더 또는 저장소 smallPublicSeed.json)을 우선하고,
 * 없을 때만 디스크를 스캔한다. 갱신: npx tsx scripts/dump-small-public-seed.ts
 */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import iconv from 'iconv-lite'
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths'
import { withBasePath } from '@/lib/basePath'
import { resolveGgnrDataDir, turbopackOpaquePath } from '@/lib/turbopackFsPath'
import {
  SMALL_PUBLIC_CANDIDATES,
  SMALL_PUBLIC_FAC_TYPES,
  type SmallPublicCandidate,
  type SmallPublicClass,
  type SmallPublicFacType,
} from '@/app/(pages)/map/_mapContents/smallPublic/smallPublicConfig'
import {
  smallPublicCheckFormFor,
  smallPublicCheckGradeOf,
  smallPublicMockCheckValues,
} from '@/app/(pages)/map/_mapContents/smallPublic/smallPublicCheckForms'
import {
  smallPublicClassFormFor,
  smallPublicClassOf,
  smallPublicClassTotal,
  smallPublicMockClassValues,
} from '@/app/(pages)/map/_mapContents/smallPublic/smallPublicClassForms'
import type {
  SmallPublicCandidateEval,
  SmallPublicDamageEvent,
  SmallPublicFacility,
  SmallPublicFile,
  SmallPublicFileKind,
  SmallPublicInspection,
  SmallPublicSafetyDoc,
} from '@/app/(pages)/map/_mapContents/smallPublic/smallPublicMock'

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

function fileUrl(mngNo: string, fileName: string): string {
  const qs = new URLSearchParams({ mngNo, name: fileName })
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

function makeFile(mngNo: string, fileName: string, kind: SmallPublicFileKind, idSuffix: string): SmallPublicFile {
  return {
    id: `${mngNo}-${idSuffix}-${fileName}`,
    name: fileName,
    url: fileUrl(mngNo, fileName),
    kind,
  }
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
  const dir = path.join(root, mngNo)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isFile() && !e.name.startsWith('.') && !e.name.toLowerCase().endsWith('.tmp'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'ko'))
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

function mapAttachments(mngNo: string, fileNames: string[]): Attached {
  const planFiles: SmallPublicFile[] = []
  const safetyFiles: SmallPublicFile[] = []
  let candidateFile: SmallPublicFile | null = null
  let riskFile: SmallPublicFile | null = null
  let classFile: SmallPublicFile | null = null
  let fieldFile: SmallPublicFile | null = null
  fileNames.forEach((name, i) => {
    const { role, kind } = classifyAttachment(name)
    const f = makeFile(mngNo, name, kind, String(i))
    if (role === 'candidate') candidateFile = f
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
    if (idx % 2 === 0) {
      push(`2025-03-${String(10 + (idx % 15)).padStart(2, '0')}`, base + ((idx % 5) - 1), '울진군 건설과', true)
    }
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

export type SmallPublicSeedPayload = {
  facilities: SmallPublicFacility[]
  inspections: SmallPublicInspection[]
  candidateEvals: SmallPublicCandidateEval[]
  safetyDocs: SmallPublicSafetyDoc[]
  source: {
    root: string
    shpDir: string
    dbfFiles: string[]
    attachmentDirs: number
    matched: number
    fromJson?: string
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

      const fileNames = await listAttachmentFiles(root, mngNo)
      const att = mapAttachments(mngNo, fileNames)
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
        coords,
        planFiles: att.planFiles,
        damageEvents: [],
        inspectionTarget: candidate === '위험',
        _att: att,
      })
    }
  }

  seedFacilities.sort((a, b) => a.mngNo.localeCompare(b.mngNo, 'en'))

  const baseInspections = buildInspections(seedFacilities)
  const baseCandidateEvals = buildCandidateEvals(seedFacilities)
  const baseSafetyDocs = buildSafetyDocs(seedFacilities)
  const demo = applyDemoScenarios(seedFacilities, baseInspections, baseCandidateEvals, baseSafetyDocs)

  const facilities: SmallPublicFacility[] = demo.facilities.map(({ _att: _a, ...rest }) => rest)
  const inspections = demo.inspections
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
 * 시드 반환 — seed.json(데이터 폴더 → 저장소) 우선, 없거나 rebuild 면 디스크 스캔.
 * params.rebuild === true 이면 다시 스캔 후 JSON 갱신.
 */
export async function loadSeed(params?: Record<string, unknown>): Promise<SmallPublicSeedPayload> {
  const rebuild = Boolean(params?.rebuild)
  const root = smallPublicRoot()
  if (!rebuild) {
    const fromData = await readSeedJsonFile(smallPublicSeedJsonDataPath(root))
    if (fromData) return fromData
    const fromRepo = await readSeedJsonFile(smallPublicSeedJsonRepoPath())
    if (fromRepo) return fromRepo
  }
  const payload = await buildSeedFromDisk(root, smallPublicShpDir())
  if (rebuild) {
    try {
      await writeSeedJson(payload, { dataRoot: root })
    } catch {
      /* 쓰기 실패해도 시드 응답은 유지 */
    }
  }
  return payload
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

/** 첨부 파일 절대경로 해석 (API 라우트용) */
export async function resolveAttachmentPath(params: {
  mngNo?: string
  name?: string
}): Promise<string | null> {
  const mngNo = String(params.mngNo ?? '').trim()
  const name = String(params.name ?? '').trim()
  if (!MNG_DIR_RE.test(mngNo)) return null
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return null
  const abs = turbopackOpaquePath(path.join(smallPublicRoot(), mngNo, name))
  try {
    const st = await fs.stat(abs)
    if (!st.isFile()) return null
    return abs
  } catch {
    return null
  }
}
