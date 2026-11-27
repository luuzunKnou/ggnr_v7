import type { OdorGrade } from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'

/** 관제 지도 — 지도/목록에서 선택한 측정지점 간략 정보 */
export type OdorControlMapPointInfo = {
  sensorKey: string
  label: string
  grade: OdorGrade
  emdNm: string
  agency: string
  lon: number
  lat: number
}
