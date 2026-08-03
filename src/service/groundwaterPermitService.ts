/**
 * 지하수 개발허가 — layer.SOINN00001 목록·상세 조회
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/database/db'
import { soinn00001, type Soinn00001 } from '@/database/schema/soinn00001'
import {
  formatGroundwaterPermitDate,
  resolveGroundwaterPermitStatus,
  type GroundwaterPermitStatusCode,
  type GroundwaterPermitStatusLabel,
} from '@/lib/groundwaterPermitStatus'

export type GroundwaterPermitListRow = {
  id: string
  nameOrTrade: string
  developLocation: string
  permitStartDate: string
  permitEndDate: string
  statusCode: GroundwaterPermitStatusCode
  statusLabel: GroundwaterPermitStatusLabel
}

/** 상세 섹션 키(snake_case) — UI 필드 정의와 동일 */
export type GroundwaterPermitDetailFields = {
  permit_report_no: string
  manage_no: string
  facility_type: string
  permit_report_date: string
  category: string
  biz_reg_no: string
  name_or_trade: string
  rep_or_trade: string
  address: string
  phone: string
  zip_code: string
  sido: string
  sigungu: string
  eupmyeondong: string
  ri: string
  san: string
  bunji: string
  ho: string
  tong: string
  ban: string
  special_address: string
  special_dong: string
  special_ho: string
  develop_location: string
  lon_deg: string
  lon_min: string
  lon_sec: string
  lat_deg: string
  lat_min: string
  lat_sec: string
  groundwater_use: string
  use_type: string
  use_detail: string
  drinking_yn: string
  permit_start_date: string
  permit_end_date: string
  contractor_reg_no: string
  contractor_name: string
  contractor_rep: string
  contractor_addr: string
  license_cert_no: string
  completion_date: string
  completion_cert_date: string
  elevation: string
  dig_depth: string
  dig_diameter: string
  intake_plan_qty: string
  required_qty: string
  power_hp: string
  discharge_pipe_dia: string
  install_depth: string
  pump_capacity: string
  daily_use_qty: string
  use_period: string
  bond_pay_date: string
  bond_amount: string
  bond_pay_detail: string
  water_test_exempt_yn: string
  water_test_type: string
  water_test_date: string
  water_test_result: string
  end_report_date: string
  end_reason: string
  abandon_date: string
  abandon_cause: string
  restore_order_date: string
  restore_done_date: string
  abandon_method: string
  restore_method: string
  dig_restore_method: string
  abandon_handler: string
  aftercare_plan_start: string
  aftercare_plan_end: string
  complaint_withdraw: string
  permit_cancel: string
  remark: string
  completion_process_yn: string
}

const DATE_KEYS = new Set([
  'permit_report_date',
  'permit_start_date',
  'permit_end_date',
  'completion_date',
  'completion_cert_date',
  'bond_pay_date',
  'water_test_date',
  'end_report_date',
  'abandon_date',
  'restore_order_date',
  'restore_done_date',
  'aftercare_plan_start',
  'aftercare_plan_end',
])

function text(v: unknown): string {
  if (v == null) return ''
  const s = String(v).trim()
  return s === '-' ? '' : s
}

function mapDetailFields(row: Soinn00001): GroundwaterPermitDetailFields {
  const raw: Record<string, string> = {
    permit_report_no: text(row.permitReportNo),
    manage_no: text(row.manageNo),
    facility_type: text(row.facilityType),
    permit_report_date: text(row.permitReportDate),
    category: text(row.category),
    biz_reg_no: text(row.bizRegNo),
    name_or_trade: text(row.nameOrTrade),
    rep_or_trade: text(row.repOrTrade),
    address: text(row.address),
    phone: text(row.phone),
    zip_code: text(row.zipCode),
    sido: text(row.sido),
    sigungu: text(row.sigungu),
    eupmyeondong: text(row.eupmyeondong),
    ri: text(row.ri),
    san: text(row.san),
    bunji: text(row.bunji),
    ho: text(row.ho),
    tong: text(row.tong),
    ban: text(row.ban),
    special_address: text(row.specialAddress),
    special_dong: text(row.specialDong),
    special_ho: text(row.specialHo),
    develop_location: text(row.developLocation),
    lon_deg: text(row.lonDeg),
    lon_min: text(row.lonMin),
    lon_sec: text(row.lonSec),
    lat_deg: text(row.latDeg),
    lat_min: text(row.latMin),
    lat_sec: text(row.latSec),
    groundwater_use: text(row.groundwaterUse),
    use_type: text(row.useType),
    use_detail: text(row.useDetail),
    drinking_yn: text(row.drinkingYn),
    permit_start_date: text(row.permitStartDate),
    permit_end_date: text(row.permitEndDate),
    contractor_reg_no: text(row.contractorRegNo),
    contractor_name: text(row.contractorName),
    contractor_rep: text(row.contractorRep),
    contractor_addr: text(row.contractorAddr),
    license_cert_no: text(row.licenseCertNo),
    completion_date: text(row.completionDate),
    completion_cert_date: text(row.completionCertDate),
    elevation: text(row.elevation),
    dig_depth: text(row.digDepth),
    dig_diameter: text(row.digDiameter),
    intake_plan_qty: text(row.intakePlanQty),
    required_qty: text(row.requiredQty),
    power_hp: text(row.powerHp),
    discharge_pipe_dia: text(row.dischargePipeDia),
    install_depth: text(row.installDepth),
    pump_capacity: text(row.pumpCapacity),
    daily_use_qty: text(row.dailyUseQty),
    use_period: text(row.usePeriod),
    bond_pay_date: text(row.bondPayDate),
    bond_amount: text(row.bondAmount),
    bond_pay_detail: text(row.bondPayDetail),
    water_test_exempt_yn: text(row.waterTestExemptYn),
    water_test_type: text(row.waterTestType),
    water_test_date: text(row.waterTestDate),
    water_test_result: text(row.waterTestResult),
    end_report_date: text(row.endReportDate),
    end_reason: text(row.endReason),
    abandon_date: text(row.abandonDate),
    abandon_cause: text(row.abandonCause),
    restore_order_date: text(row.restoreOrderDate),
    restore_done_date: text(row.restoreDoneDate),
    abandon_method: text(row.abandonMethod),
    restore_method: text(row.restoreMethod),
    dig_restore_method: text(row.digRestoreMethod),
    abandon_handler: text(row.abandonHandler),
    aftercare_plan_start: text(row.aftercarePlanStart),
    aftercare_plan_end: text(row.aftercarePlanEnd),
    complaint_withdraw: text(row.complaintWithdraw),
    permit_cancel: text(row.permitCancel),
    remark: text(row.remark),
    completion_process_yn: text(row.completionProcessYn),
  }
  for (const key of DATE_KEYS) {
    if (raw[key]) raw[key] = formatGroundwaterPermitDate(raw[key])
  }
  return raw as GroundwaterPermitDetailFields
}

function toListRow(row: Soinn00001): GroundwaterPermitListRow {
  const status = resolveGroundwaterPermitStatus({
    permit_cancel: row.permitCancel,
    abandon_date: row.abandonDate,
    end_report_date: row.endReportDate,
    completion_process_yn: row.completionProcessYn,
    permit_end_date: row.permitEndDate,
  })
  return {
    id: String(row.soinnKey),
    nameOrTrade: text(row.nameOrTrade),
    developLocation: text(row.developLocation),
    permitStartDate: formatGroundwaterPermitDate(row.permitStartDate),
    permitEndDate: formatGroundwaterPermitDate(row.permitEndDate),
    statusCode: status.code,
    statusLabel: status.label,
  }
}

export async function getGroundwaterPermitList(params?: {
  keyword?: string
  limit?: number
}) {
  const limit = Math.min(Math.max(Number(params?.limit) || 5000, 1), 10000)
  const keyword = String(params?.keyword ?? '').trim().toLowerCase()

  /** 건수 소수 → 상태(계산값) 검색까지 메모리 필터 */
  const rows = await db
    .select()
    .from(soinn00001)
    .where(eq(soinn00001.soinnIsDel, false))
    .orderBy(asc(soinn00001.soinnKey))
    .limit(limit)

  let list = rows.map(toListRow)
  if (keyword) {
    list = list.filter((r) => {
      const hay = [
        r.nameOrTrade,
        r.developLocation,
        r.permitStartDate,
        r.permitEndDate,
        r.statusLabel,
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(keyword)
    })
  }

  return { rows: list, total: list.length }
}

export async function getGroundwaterPermitDetail(params: { id?: string | number }) {
  const idNum = Number(params?.id)
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return { error: '잘못된 식별자입니다.', row: null as null, fields: null as null }
  }

  const rows = await db
    .select()
    .from(soinn00001)
    .where(and(eq(soinn00001.soinnKey, idNum), eq(soinn00001.soinnIsDel, false)))
    .limit(1)

  const row = rows[0]
  if (!row) {
    return { error: '항목을 찾을 수 없습니다.', row: null as null, fields: null as null }
  }

  const list = toListRow(row)
  const fields = mapDetailFields(row)
  return {
    row: {
      id: list.id,
      nameOrTrade: list.nameOrTrade,
      developLocation: list.developLocation,
      statusCode: list.statusCode,
      statusLabel: list.statusLabel,
    },
    fields,
  }
}

/** 테이블 존재·건수 스모크 (선택) */
export async function getGroundwaterPermitCount() {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(soinn00001)
    .where(eq(soinn00001.soinnIsDel, false))
  return { total: Number(r?.n ?? 0) }
}

/**
 * 선택 행 지도 이동용 — geom(5181) → EPSG:3857 중심점
 */
export async function getGroundwaterPermitMapById(params: { id?: string | number }) {
  const idNum = Number(params?.id)
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return { error: '잘못된 식별자입니다.', center3857: null as null, hasGeom: false }
  }

  const res = await db.execute(sql`
    SELECT
      ST_X(ST_Transform(geom, 3857))::float8 AS x,
      ST_Y(ST_Transform(geom, 3857))::float8 AS y
    FROM layer."SOINN00001"
    WHERE soinn_key = ${idNum}
      AND soinn_is_del = false
      AND geom IS NOT NULL
    LIMIT 1
  `)
  const row = (res.rows as { x?: number; y?: number }[])[0]
  const x = Number(row?.x)
  const y = Number(row?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { error: '위치 정보가 없습니다.', center3857: null as null, hasGeom: false }
  }
  return {
    hasGeom: true,
    center3857: [x, y] as [number, number],
  }
}
