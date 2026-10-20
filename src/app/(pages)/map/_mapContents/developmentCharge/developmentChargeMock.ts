/**
 * 개발부담금 대상 지역 — UI 확인용 임시 자료 (안동시 일원, 실제 부과와 무관).
 */
import { fromLonLat } from 'ol/proj'
import {
  getDevelopmentChargeStatus,
  type DevelopmentChargeStatus,
} from './developmentChargeConfig'

export type Ring3857 = [number, number][]

export type DevelopmentChargeArea = {
  id: string
  name: string
  year: number
  emd: string
  address: string
  /** ㎡ */
  area: number
  status: DevelopmentChargeStatus
  statusLabel: string
  projectType: string
  baseDate: string
  dueDate: string
  /** 원 (임시) */
  chargeWon: number | null
  obligor: string
  remark: string
  rings3857: Ring3857[]
}

type SeedRow = {
  id: string
  name: string
  year: number
  emd: string
  address: string
  area: number
  status: DevelopmentChargeStatus
  projectType: string
  baseDate: string
  dueDate: string
  chargeWon: number | null
  obligor: string
  remark: string
  /** [lon, lat] 링 (닫힌 링) */
  ringLonLat: [number, number][]
}

/** 안동시 일원 임시 사각형 경계 */
const SEED: SeedRow[] = [
  {
    id: 'dc-1',
    name: '명륜지구 주택단지',
    year: 2025,
    emd: '명륜동',
    address: '경상북도 안동시 명륜동 일원',
    area: 18420,
    status: 'target',
    projectType: '택지개발',
    baseDate: '2025-03-15',
    dueDate: '2025-09-30',
    chargeWon: 412_500_000,
    obligor: '(주)안동주택개발',
    remark: '임시 자료',
    ringLonLat: [
      [128.724, 36.572],
      [128.732, 36.572],
      [128.732, 36.566],
      [128.724, 36.566],
      [128.724, 36.572],
    ],
  },
  {
    id: 'dc-2',
    name: '옥동 근린생활시설',
    year: 2024,
    emd: '옥동',
    address: '경상북도 안동시 옥동 일원',
    area: 5230,
    status: 'assessed',
    projectType: '건축허가',
    baseDate: '2024-07-01',
    dueDate: '2024-12-31',
    chargeWon: 98_700_000,
    obligor: '김○○',
    remark: '임시 자료',
    ringLonLat: [
      [128.708, 36.562],
      [128.714, 36.562],
      [128.714, 36.558],
      [128.708, 36.558],
      [128.708, 36.562],
    ],
  },
  {
    id: 'dc-3',
    name: '풍산읍 산업단지 확장',
    year: 2025,
    emd: '풍산읍',
    address: '경상북도 안동시 풍산읍 안교리 일원',
    area: 95600,
    status: 'target',
    projectType: '산업단지',
    baseDate: '2025-01-20',
    dueDate: '2026-01-19',
    chargeWon: 1_850_000_000,
    obligor: '안동시 도시개발공사',
    remark: '임시 자료',
    ringLonLat: [
      [128.572, 36.588],
      [128.592, 36.588],
      [128.592, 36.574],
      [128.572, 36.574],
      [128.572, 36.588],
    ],
  },
  {
    id: 'dc-4',
    name: '송천동 공동주택',
    year: 2023,
    emd: '송천동',
    address: '경상북도 안동시 송천동 일원',
    area: 12680,
    status: 'paid',
    projectType: '택지개발',
    baseDate: '2023-05-10',
    dueDate: '2023-11-30',
    chargeWon: 276_400_000,
    obligor: '(주)송천개발',
    remark: '임시 자료 · 납부 완료',
    ringLonLat: [
      [128.745, 36.552],
      [128.754, 36.552],
      [128.754, 36.546],
      [128.745, 36.546],
      [128.745, 36.552],
    ],
  },
  {
    id: 'dc-5',
    name: '임하면 임하리 관광시설',
    year: 2024,
    emd: '임하면',
    address: '경상북도 안동시 임하면 임하리 일원',
    area: 34100,
    status: 'reduced',
    projectType: '관광단지',
    baseDate: '2024-09-01',
    dueDate: '2025-03-01',
    chargeWon: 155_000_000,
    obligor: '(주)임하관광',
    remark: '임시 자료 · 감면 적용',
    ringLonLat: [
      [128.878, 36.538],
      [128.892, 36.538],
      [128.892, 36.528],
      [128.878, 36.528],
      [128.878, 36.538],
    ],
  },
  {
    id: 'dc-6',
    name: '법흥동 공공청사',
    year: 2022,
    emd: '법흥동',
    address: '경상북도 안동시 법흥동 일원',
    area: 8900,
    status: 'exempt',
    projectType: '공공시설',
    baseDate: '2022-11-01',
    dueDate: '',
    chargeWon: null,
    obligor: '안동시',
    remark: '임시 자료 · 공공시설 면제',
    ringLonLat: [
      [128.718, 36.578],
      [128.724, 36.578],
      [128.724, 36.574],
      [128.718, 36.574],
      [128.718, 36.578],
    ],
  },
  {
    id: 'dc-7',
    name: '정상동 근린공원 주변 개발',
    year: 2025,
    emd: '정상동',
    address: '경상북도 안동시 정상동 일원',
    area: 7420,
    status: 'assessed',
    projectType: '건축허가',
    baseDate: '2025-06-01',
    dueDate: '2025-12-31',
    chargeWon: 132_800_000,
    obligor: '이○○',
    remark: '임시 자료',
    ringLonLat: [
      [128.735, 36.565],
      [128.741, 36.565],
      [128.741, 36.561],
      [128.735, 36.561],
      [128.735, 36.565],
    ],
  },
  {
    id: 'dc-8',
    name: '와룡면 가구리 공장증설',
    year: 2024,
    emd: '와룡면',
    address: '경상북도 안동시 와룡면 가구리 일원',
    area: 21500,
    status: 'target',
    projectType: '공장설립',
    baseDate: '2024-11-15',
    dueDate: '2025-05-15',
    chargeWon: 387_200_000,
    obligor: '(주)와룡산업',
    remark: '임시 자료',
    ringLonLat: [
      [128.802, 36.602],
      [128.816, 36.602],
      [128.816, 36.592],
      [128.802, 36.592],
      [128.802, 36.602],
    ],
  },
]

function toArea(row: SeedRow): DevelopmentChargeArea {
  return {
    id: row.id,
    name: row.name,
    year: row.year,
    emd: row.emd,
    address: row.address,
    area: row.area,
    status: row.status,
    statusLabel: getDevelopmentChargeStatus(row.status).label,
    projectType: row.projectType,
    baseDate: row.baseDate,
    dueDate: row.dueDate,
    chargeWon: row.chargeWon,
    obligor: row.obligor,
    remark: row.remark,
    rings3857: [row.ringLonLat.map((p) => fromLonLat(p) as [number, number])],
  }
}

const AREAS: DevelopmentChargeArea[] = SEED.map(toArea)

export function getDevelopmentChargeAreas(): DevelopmentChargeArea[] {
  return AREAS
}

export function getDevelopmentChargeAreaById(id: string): DevelopmentChargeArea | undefined {
  return AREAS.find((a) => a.id === id)
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

export function formatChargeWon(won: number | null): string {
  if (won == null) return '—'
  return `${won.toLocaleString('ko-KR')}원`
}

export function formatAreaM2(area: number): string {
  return `${area.toLocaleString('ko-KR')}㎡`
}
