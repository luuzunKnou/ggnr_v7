import {
  gradeToStatus,
  type OdorAlertItem,
  type OdorGrade,
  type OdorGradePointMock,
  type OdorGradeStatus,
} from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { GRADE_MAX_PPM } from '@/app/(pages)/(index)/odorPh/odorAlertDetailMock'
import type { OdorSensorListItem } from '@/service/odorSensorService'

export type OdorStationRow = {
  id: string
  sensorKey: number
  sensorKorNm: string
  sensorNm: string
  agency: string
  emdNm: string
  lon: number
  lat: number
  grade: OdorGrade
  status: OdorGradeStatus
  ppm: number
  abatementRunning: boolean
  online: boolean
}

const STATUS_LABEL: Record<OdorGradeStatus, string> = {
  normal: '정상',
  caution: '주의',
  warning: '경보',
}

export function odorStatusLabel(status: OdorGradeStatus): string {
  return STATUS_LABEL[status]
}

function hashSeed(n: number): number {
  let h = (n * 2654435761) >>> 0
  return h || 1
}

function mockPpmForGrade(grade: OdorGrade, sensorKey: number): number {
  const hi = GRADE_MAX_PPM[grade]
  const lo = grade <= 1 ? 0 : GRADE_MAX_PPM[(grade - 1) as OdorGrade]
  const t = (hashSeed(sensorKey) % 1000) / 1000
  return Math.round((lo + (hi - lo) * (0.2 + t * 0.7)) * 10) / 10
}

function mockAbatement(sensorKey: number, grade: OdorGrade): boolean {
  if (grade >= 4) return hashSeed(sensorKey) % 3 !== 0
  if (grade === 3) return hashSeed(sensorKey) % 2 === 0
  return hashSeed(sensorKey) % 5 === 0
}

function mockOnline(sensorKey: number): boolean {
  return hashSeed(sensorKey) % 100 < 85
}

/** 센서·등급 포인트 → 지점 목록 행 */
export function buildOdorStationRows(
  sensors: OdorSensorListItem[],
  points: OdorGradePointMock[]
): OdorStationRow[] {
  const byKey = new Map(
    points.map((p) => {
      const key = p.id.startsWith('pt-') ? p.id.slice(3) : p.id
      return [key, p] as const
    })
  )

  return sensors
    .map((s) => {
      const id = String(s.sensorKey)
      const pt = byKey.get(id)
      const grade = (pt?.grade ?? 1) as OdorGrade
      const status = pt?.status ?? gradeToStatus(grade)
      const lon =
        s.lon != null && Number.isFinite(s.lon)
          ? s.lon
          : (pt?.lon ?? 129.365)
      const lat =
        s.lat != null && Number.isFinite(s.lat)
          ? s.lat
          : (pt?.lat ?? 36.032)
      const sensorKorNm = (s.sensorKorNm ?? '').trim() || pt?.label || `센서 ${id}`
      const sensorNm = (s.sensorNm ?? '').trim() || id
      return {
        id,
        sensorKey: s.sensorKey,
        sensorKorNm,
        sensorNm,
        agency: (s.agency ?? '').trim() || pt?.agency || '미지정',
        emdNm: pt?.emdNm ?? '—',
        lon,
        lat,
        grade,
        status,
        ppm: mockPpmForGrade(grade, s.sensorKey),
        abatementRunning: mockAbatement(s.sensorKey, grade),
        online: mockOnline(s.sensorKey),
      } satisfies OdorStationRow
    })
    .sort((a, b) => a.sensorKorNm.localeCompare(b.sensorKorNm, 'ko'))
}

/** 지점 행 → 상세 모달용 경보 스냅샷 */
export function stationRowToAlertItem(row: OdorStationRow): OdorAlertItem {
  return {
    id: `st-${row.id}`,
    sensorKorNm: row.sensorKorNm,
    sensorNm: row.sensorNm,
    agency: row.agency,
    grade: row.grade,
    occurredAt: new Date().toISOString(),
    confirmed: row.status !== 'warning',
    ppm: row.ppm,
    abatementRunning: row.abatementRunning,
    emdNm: row.emdNm,
  }
}
