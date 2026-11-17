/**
 * 지적재조사 지구 데이터.
 * 지구 속성·경계는 바른땅 공개 지도(안동시 25개 지구, 2026-10 기준) 값을 단순화해 담았다.
 * 필지 도형·지번·지목·면적은 지구 경계와 겹치는 실제 지적(public_layer.jijuk)을 조회해 채우며,
 * 소유구분·확정여부는 지적에 없어 생성값을 쓴다.
 */
import { fromLonLat } from 'ol/proj'
import proj4 from 'proj4'
import { call } from '@/lib/api'
import {
  getResurveyStageGroupByCd,
  getResurveyStageGroupIndex,
  type ResurveyStageGroup,
} from './cadastralResurveyConfig'
import sampleRows from './cadastralResurveyAndongSample.json'

export type Ring3857 = [number, number][]

export type ResurveyDistrict = {
  id: string
  name: string
  year: number
  loc: string
  emd: string
  ri: string
  parcelCount: number
  /** ㎡ */
  area: number
  stageCd: number
  stageName: string
  stageGroup: ResurveyStageGroup
  agent: string
  /** 지정상태 (지정고시 등) */
  designateStatus: string
  ownAgreeRto: number | null
  areaAgreeRto: number | null
  /** 원 */
  budgetWon: number | null
  budgetType: string
  periodStart: string
  periodEnd: string
  tel: string
  mgrCardNum: string
  appointYmd: string
  zoneType: string
  mapType: string
  rings3857: Ring3857[]
}

export type ResurveyOwnerType = '개인' | '국유지' | '시유지' | '법인' | '종중'

export type ResurveyParcel = {
  id: string
  districtId: string
  seq: number
  ri: string
  jibun: string
  jimok: string
  /** ㎡ */
  area: number
  ownerType: ResurveyOwnerType
  /** 경계 확정 여부 */
  confirmed: boolean
  /** 실제 지적 도형 (GeoJSON, EPSG:3857) */
  geom3857: Record<string, unknown>
  extent3857: [number, number, number, number]
}

type SampleRow = {
  seq: number
  name: string
  year: number
  loc: string
  parcelCnt: number | null
  area: number | null
  stageCd: number
  stageNm: string
  agent: string
  docCls: string
  ownAgreeRto: number | null
  areaAgreeRto: number | null
  budgetWon: number | null
  budgetType: string
  periodStart: string
  periodEnd: string
  tel: string
  mgrCardNum: string
  appointYmd: string
  zoneType: string
  mapType: string
  rings: [number, number][][]
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** «경상북도 안동시 임하면 임하리 273번지 일원» → 읍면동·리 */
function parseLoc(loc: string): { emd: string; ri: string } {
  const tail = loc.split('안동시')[1]?.trim() ?? ''
  const tokens = tail.split(/[\s,]+/).filter(Boolean)
  const emd = tokens[0] ?? ''
  const ri = tokens[1] && /리$/.test(tokens[1]) ? tokens[1] : ''
  return { emd, ri }
}

function toDistrict(row: SampleRow): ResurveyDistrict {
  const { emd, ri } = parseLoc(row.loc)
  return {
    id: String(row.seq),
    name: row.name,
    year: row.year,
    loc: row.loc,
    emd,
    ri,
    parcelCount: row.parcelCnt ?? 0,
    area: row.area ?? 0,
    stageCd: row.stageCd,
    stageName: row.stageNm,
    stageGroup: getResurveyStageGroupByCd(row.stageCd).code,
    agent: row.agent,
    designateStatus: row.docCls,
    ownAgreeRto: row.ownAgreeRto,
    areaAgreeRto: row.areaAgreeRto,
    budgetWon: row.budgetWon,
    budgetType: row.budgetType,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    tel: row.tel,
    mgrCardNum: row.mgrCardNum,
    appointYmd: row.appointYmd,
    zoneType: row.zoneType,
    mapType: row.mapType,
    rings3857: row.rings.map((r) => r.map((p) => fromLonLat(p) as [number, number])),
  }
}

export function ringsExtent(rings: Ring3857[]): [number, number, number, number] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return [minX, minY, maxX, maxY]
}

function ownerTypeFor(jimok: string, rand: () => number): ResurveyOwnerType {
  if (jimok === '도' || jimok === '구') return rand() < 0.6 ? '국유지' : '시유지'
  const r = rand()
  if (r < 0.78) return '개인'
  if (r < 0.86) return '종중'
  if (r < 0.92) return '법인'
  if (r < 0.96) return '시유지'
  return '국유지'
}

function confirmedFor(district: ResurveyDistrict, rand: () => number): boolean {
  const idx = getResurveyStageGroupIndex(district.stageGroup)
  const boundaryIdx = getResurveyStageGroupIndex('boundary')
  if (idx > boundaryIdx) return true
  if (idx === boundaryIdx) return rand() < 0.65
  return false
}

const PROJ_3857 =
  '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs'
const PROJ_5181 =
  '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs'

/** 지구 경계(EPSG:3857) → 지적 조회용 WKT (EPSG:5181) */
function districtWkt5181(district: ResurveyDistrict): string {
  const polys = district.rings3857.map((ring) => {
    const pts = ring
      .map((p) => {
        const xy = proj4(PROJ_3857, PROJ_5181, p)
        return `${xy[0].toFixed(3)} ${xy[1].toFixed(3)}`
      })
      .join(',')
    return `((${pts}))`
  })
  return polys.length > 1 ? `MULTIPOLYGON(${polys.join(',')})` : `POLYGON${polys[0]}`
}

/** «용상동 1203-20» → { ri: '용상동', lot: '1203-20' } */
function splitAddress(address: string): { ri: string; lot: string } {
  const t = String(address ?? '').trim()
  const m = t.match(/^(.*?)\s*(산?\d+(?:-\d+)?)\s*$/)
  if (m) return { ri: m[1].trim(), lot: m[2] }
  return { ri: t, lot: '' }
}

type JijukParcelDto = {
  address?: string
  pnu?: string
  jimok?: string
  areaSqm?: number
  extent3857?: [number, number, number, number] | null
  geometry3857?: Record<string, unknown> | null
}

function pnuSeed(pnu: string): number {
  let h = 2166136261
  for (let i = 0; i < pnu.length; i++) {
    h ^= pnu.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 지구 경계와 겹치는 실제 지적 필지를 조회한다. 소유구분·확정여부는 생성값. */
export async function fetchResurveyParcels(district: ResurveyDistrict): Promise<ResurveyParcel[]> {
  if (district.rings3857.length === 0) return []
  const wkt5181 = districtWkt5181(district)
  const res = await call('', 'POST', {
    service: 'layerRowService',
    action: 'listJijukParcelsByGeomWkt5181',
    params: { wkt5181, limit: 5000, minInsideRatio: 0.5 },
  })
  const data = (res?.data ?? res) as { parcels?: JijukParcelDto[] } | undefined
  const rows = Array.isArray(data?.parcels) ? data.parcels : []
  const parcels: ResurveyParcel[] = []
  rows.forEach((row, i) => {
    const geom = row.geometry3857
    const extent = row.extent3857
    if (!geom || !extent) return
    const pnu = String(row.pnu ?? '')
    const { ri, lot } = splitAddress(row.address ?? '')
    const jimok = row.jimok ?? ''
    const rand = mulberry32(pnuSeed(pnu || `${district.id}-${i}`))
    parcels.push({
      id: pnu || `${district.id}-${i}`,
      districtId: district.id,
      seq: i + 1,
      ri: ri || district.ri || district.emd,
      jibun: lot,
      jimok,
      area: row.areaSqm != null ? Math.round(row.areaSqm) : 0,
      ownerType: ownerTypeFor(jimok, rand),
      confirmed: confirmedFor(district, rand),
      geom3857: geom,
      extent3857: extent,
    })
  })
  return parcels
}

let districtCache: ResurveyDistrict[] | null = null

function ensureDistricts(): ResurveyDistrict[] {
  if (districtCache) return districtCache
  const rows = sampleRows as unknown as SampleRow[]
  districtCache = rows.map((row) => toDistrict(row))
  return districtCache
}

export function getResurveyDistricts(): ResurveyDistrict[] {
  return ensureDistricts()
}

export function getResurveyDistrictById(id: string): ResurveyDistrict | null {
  return ensureDistricts().find((d) => d.id === id) ?? null
}
