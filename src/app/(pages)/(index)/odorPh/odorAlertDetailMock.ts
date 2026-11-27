import type { OdorAlertItem, OdorGrade } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'

export type TrendRange = '24h' | 'week' | 'month'

export type TrendPoint = {
  label: string
  ppm: number
  /** 저감설비 가동 여부 (해당 시점) */
  running: boolean
}

export type MaintenanceRow = {
  id: string
  /** 일자 (YYYY-MM-DD) */
  date: string
  /** 구분 */
  category: string
  /** 점검자 */
  inspector: string
  /** 내용 */
  content: string
}

/** 환경부 표7 스타일 — 정상·주의·경보 ppm 구간 */
export type PpmZoneBounds = {
  /** 정상 상한 */
  normalMax: number
  /** 주의 상한 (= 경보 시작) */
  cautionMax: number
  /** 차트 y/x 최대 */
  chartMax: number
}

export type OdorAlertDetailMock = {
  alert: OdorAlertItem
  zones: PpmZoneBounds
  abatement: {
    running: boolean
    thresholdPpm: number
  }
  device: {
    sensorKorNm: string
    sensorNm: string
    agency: string
    emdNm: string
    model: string
    /** 기기 종류 */
    kind: string
    /** 전원 상태 */
    power: '정상' | '이상'
    /** 고장 여부 */
    fault: boolean
  }
  comm: {
    online: boolean
    rate: number
    /** 통신 안내(목업) */
    statusNote: string
  }
  trends: Record<TrendRange, TrendPoint[]>
  maintenance: MaintenanceRow[]
}

/** 목업 등급 구간 상한 (ppm) — 1·2=정상, 3=주의, 4·5=경보 */
export const GRADE_MAX_PPM: Record<OdorGrade, number> = {
  1: 1.5,
  2: 3.0,
  3: 5.0,
  4: 8.0,
  5: 12.0,
}

export const DEFAULT_PPM_ZONES: PpmZoneBounds = {
  normalMax: GRADE_MAX_PPM[2],
  cautionMax: GRADE_MAX_PPM[3],
  chartMax: GRADE_MAX_PPM[5],
}

function hashSeed(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h || 1
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function buildSeries(
  rand: () => number,
  basePpm: number,
  thresholdPpm: number,
  count: number,
  labelAt: (i: number) => string
): TrendPoint[] {
  const out: TrendPoint[] = []
  let v = basePpm
  let running = basePpm >= thresholdPpm
  for (let i = 0; i < count; i++) {
    v = Math.max(0.2, Math.min(12, v + (rand() - 0.48) * 1.2))
    if (v >= thresholdPpm) running = true
    else if (v < thresholdPpm * 0.85) running = false
    out.push({
      label: labelAt(i),
      ppm: Math.round(v * 10) / 10,
      running,
    })
  }
  return out
}

/** 경보 행 기준 상세 목업 */
export function buildOdorAlertDetailMock(alert: OdorAlertItem): OdorAlertDetailMock {
  const rand = mulberry32(hashSeed(alert.id))
  const thresholdPpm = Math.round((2.5 + rand() * 2.5) * 10) / 10
  const rate = Math.round((78 + rand() * 20) * 10) / 10
  const online = rate >= 85
  const zones = DEFAULT_PPM_ZONES

  const pad = (n: number) => String(n).padStart(2, '0')
  const trends24h = buildSeries(rand, alert.ppm, thresholdPpm, 24, (i) => `${pad(i)}:00`)
  const trendsWeek = buildSeries(rand, alert.ppm, thresholdPpm, 7, (i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return `${d.getMonth() + 1}/${d.getDate()}`
  })
  const trendsMonth = buildSeries(rand, alert.ppm, thresholdPpm, 30, (i) => {
    const d = new Date()
    d.setDate(d.getDate() - (29 - i))
    return `${d.getMonth() + 1}/${d.getDate()}`
  })

  const inspectors = ['김점검', '이현장', '박설비', '최통신']
  const categories = ['정기점검', '교정', '수리', '교체', '청소']
  const maintenanceSeeds: Array<{ date: string; category: string; content: string }> = [
    { date: '2026-11-10', category: '교정', content: '센서 교정 및 필터 교체' },
    { date: '2026-10-22', category: '정기점검', content: '통신 모듈 점검' },
    { date: '2026-09-05', category: '정기점검', content: '저감설비 정기 점검' },
    { date: '2026-08-18', category: '교체', content: '펌웨어 업데이트' },
    { date: '2026-07-29', category: '수리', content: '전원부 이상 점검' },
    { date: '2026-06-12', category: '교정', content: '현장 교정 작업' },
    { date: '2026-05-03', category: '청소', content: '하우징 청소 및 방수 점검' },
    { date: '2026-04-17', category: '교체', content: '안테나·통신 케이블 교체' },
    { date: '2026-03-08', category: '청소', content: '저감설비 노즐 청소' },
    { date: '2026-02-21', category: '정기점검', content: '연간 정기 유지보수' },
  ]
  const maintenance: MaintenanceRow[] = maintenanceSeeds.map((row, i) => ({
    id: `${alert.id}-m${i + 1}`,
    date: row.date,
    category: row.category || categories[i % categories.length],
    inspector: inspectors[i % inspectors.length],
    content: row.content,
  }))

  return {
    alert,
    zones,
    abatement: {
      running: alert.abatementRunning,
      thresholdPpm,
    },
    device: {
      sensorKorNm: alert.sensorKorNm,
      sensorNm: alert.sensorNm,
      agency: alert.agency,
      emdNm: alert.emdNm,
      model: alert.agency === '디오솔류션' ? 'ODOR-D200' : 'ODOR-G100',
      kind: alert.agency === '디오솔류션' ? '복합악취센서' : '황화수소센서',
      power: rand() > 0.12 ? '정상' : '이상',
      fault: rand() > 0.9,
    },
    comm: {
      online,
      rate,
      statusNote: '서버~통신 경보 상태 보기',
    },
    trends: {
      '24h': trends24h,
      week: trendsWeek,
      month: trendsMonth,
    },
    maintenance,
  }
}
