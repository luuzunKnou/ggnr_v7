import type { OdorAlertItem, OdorGrade } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import type { OdorAlertRow } from '../odorAlert/odorAlertMock'

/** store 행 → 기존 경보목록2 표·상세 시트용 표시 모델 */
export function odorAlertRowToViewItem(row: OdorAlertRow): OdorAlertItem & {
  kind: OdorAlertRow['kind']
  recovered: boolean
  lastRecvAt: string | null
  sensorKey: number | null
  lon: number | null
  lat: number | null
} {
  const grade = (row.grade ?? 3) as OdorGrade
  const seed = row.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const ppm =
    row.kind === 'fault' ? 0 : Math.round((0.3 + (seed % 70) / 100) * 10) / 10
  return {
    id: row.id,
    sensorKorNm: row.sensorLabel,
    sensorNm: row.sensorNm || row.sensorLabel,
    agency: row.agency,
    grade,
    occurredAt: row.occurredAt,
    confirmed: row.acked,
    ppm,
    abatementRunning: row.scrubberAutoOn === true,
    emdNm: row.emdNm,
    kind: row.kind,
    recovered: row.recovered,
    lastRecvAt: row.lastRecvAt,
    sensorKey: row.sensorKey,
    lon: row.lon,
    lat: row.lat,
  }
}
