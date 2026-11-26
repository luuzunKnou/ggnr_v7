/**
 * 소규모 공공시설 — 정비계획 명세서(layer.spf_plan·spf_plan_fac).
 * 시설명·위치는 관리번호로 유형별 테이블을 조회하고, 소교량은 묶음 관리번호(spf_bridge_group)와 리로 조회한다.
 */
import { pool } from '@/database/db'
import { SPF_TYPE_TABLES, parseSpfFacilityUiId } from '@/lib/smallPublicTypeTables'
import {
  PLAN_DB_YEARS,
  planRate,
  planSheetMid,
  type PlanDbPeriod,
  type PlanDbRow,
  type PlanSaveEntry,
  type PlanSheetPayload,
} from '@/app/(pages)/map/_mapContents/smallPublic/plan/smallPublicPlanDb'
import { registerBridgeGroupMembers } from './smallPublicService'

type Fail = { success: false; error: string }

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 유형별 시설 테이블 → 관리번호·시설명·읍면·리·유형 (exceptTable 은 제외) */
function facUnionSql(exceptTable?: string): string {
  return SPF_TYPE_TABLES.filter((t) => t.table !== exceptTable)
    .map(
      (t) =>
        `SELECT cons_code, sisul_name, emd, ri, '${t.type}'::text AS type FROM layer.${t.table} WHERE cons_code IS NOT NULL`
    )
    .join('\nUNION ALL\n')
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** 부동소수 오차 정리(소수 3자리) */
const r3 = (n: number): number => Math.round(n * 1000) / 1000

/** 0·빈 값은 NULL 로 저장(빈 칸 유지) */
const nz = (n: number): number | null => (n ? n : null)

async function listPlans(): Promise<PlanDbPeriod[]> {
  const r = await pool.query<{ id: string; start_year: number; end_year: number }>(
    `SELECT id, start_year, end_year FROM layer.spf_plan ORDER BY start_year, end_year`
  )
  return r.rows.map((x) => ({ id: Number(x.id), startYear: Number(x.start_year), endYear: Number(x.end_year) }))
}

/** 지정이 없으면 올해가 속한 구간, 없으면 가장 나중 구간 */
function pickPlanId(plans: PlanDbPeriod[], requested?: number): number | null {
  if (requested && plans.some((p) => p.id === requested)) return requested
  const year = new Date().getFullYear()
  const current = plans.find((p) => p.startYear <= year && year <= p.endYear)
  return (current ?? plans[plans.length - 1])?.id ?? null
}

type PlanFacDbRow = {
  id: string
  plan_id: string
  cons_code: string | null
  final_rank: number | null
  workload_m: number | null
  cost_mil: number | null
  after5_qty: number | null
  after5_cost_mil: number | null
  y1_qty: number | null
  y1_cost_mil: number | null
  y2_qty: number | null
  y2_cost_mil: number | null
  y3_qty: number | null
  y3_cost_mil: number | null
  y4_qty: number | null
  y4_cost_mil: number | null
  y5_qty: number | null
  y5_cost_mil: number | null
  effect_people: string | null
  effect_farm_ha: string | null
  effect_building: string | null
  fac_name: string | null
  fac_type: string | null
  fac_emd: string | null
  fac_ri: string | null
  grp_code: string | null
  grp_emd: string | null
  grp_ri: string | null
}

function mapPlanRow(r: PlanFacDbRow): PlanDbRow {
  const consCode = String(r.cons_code ?? '').trim()
  const isBridgeGroup = Boolean(r.grp_code)
  const years = Array.from({ length: PLAN_DB_YEARS }, (_, i) => {
    const n = i + 1
    const row = r as unknown as Record<string, number | null>
    return { qty: num(row[`y${n}_qty`]), costMil: num(row[`y${n}_cost_mil`]) }
  })
  return {
    id: Number(r.id),
    planId: Number(r.plan_id),
    consCode,
    isBridgeGroup,
    name: isBridgeGroup ? String(r.grp_code) : String(r.fac_name ?? '').trim() || consCode,
    type: isBridgeGroup ? '소교량' : String(r.fac_type ?? ''),
    emd: String((isBridgeGroup ? r.grp_emd : r.fac_emd) ?? '').trim(),
    ri: String((isBridgeGroup ? r.grp_ri : r.fac_ri) ?? '').trim(),
    finalRank: r.final_rank == null ? null : Number(r.final_rank),
    workloadM: num(r.workload_m),
    costMil: num(r.cost_mil),
    after: { qty: num(r.after5_qty), costMil: num(r.after5_cost_mil) },
    years,
    people: num(r.effect_people),
    farmHa: num(r.effect_farm_ha),
    buildings: num(r.effect_building),
  }
}

/** 정비계획 명세서 — 연도구간 목록 + 선택 구간의 목록(시설명·위치 조회 포함) */
export async function getPlanSheet(params: {
  planId?: number
}): Promise<({ success: true } & PlanSheetPayload) | Fail> {
  try {
    const plans = await listPlans()
    const planId = pickPlanId(plans, params?.planId ? Number(params.planId) : undefined)
    if (planId == null) return { success: true, plans, planId: null, rows: [] }
    const res = await pool.query<PlanFacDbRow>(
      `
      WITH fac AS (
        ${facUnionSql()}
      ),
      grp AS (
        SELECT g.group_code, min(g.ri) AS ri, min(b.emd) AS emd
        FROM layer.spf_bridge_group g
        LEFT JOIN layer.spf_bridge b ON b.cons_code = g.cons_code
        GROUP BY g.group_code
      )
      SELECT p.*,
             f.sisul_name AS fac_name, f.type AS fac_type, f.emd AS fac_emd, f.ri AS fac_ri,
             grp.group_code AS grp_code, grp.emd AS grp_emd, grp.ri AS grp_ri
      FROM layer.spf_plan_fac p
      LEFT JOIN fac f ON f.cons_code = p.cons_code
      LEFT JOIN grp ON grp.group_code = p.cons_code
      WHERE p.plan_id = $1
      ORDER BY p.final_rank NULLS LAST, p.id
      `,
      [planId]
    )
    return { success: true, plans, planId, rows: res.rows.map(mapPlanRow) }
  } catch (e: unknown) {
    return { success: false, error: errMsg(e) }
  }
}

/** 명세서 저장 — 전체 = 정비된 + 중기 + 5개년 후로 계산해 넣고, 정비율은 정비된 사업량 기준으로 계산 */
export async function savePlanRows(params: {
  planId?: number
  entries?: PlanSaveEntry[]
}): Promise<{ success: true; updated: number } | Fail> {
  const planId = Number(params?.planId)
  const entries = Array.isArray(params?.entries) ? params.entries : []
  if (!Number.isFinite(planId)) return { success: false, error: '정비연도가 필요합니다.' }
  if (entries.length === 0) return { success: true, updated: 0 }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let updated = 0
    for (const e of entries) {
      const id = Number(e.id)
      if (!Number.isFinite(id)) continue
      const years = Array.from({ length: PLAN_DB_YEARS }, (_, i) => ({
        qty: num(e.midYears?.[i]?.qty),
        costMil: num(e.midYears?.[i]?.costMil),
      }))
      const done = { qty: num(e.done?.qty), costMil: num(e.done?.costMil) }
      const after = { qty: num(e.after?.qty), costMil: num(e.after?.costMil) }
      const mid = planSheetMid(years)
      const totalQty = r3(done.qty + mid.qty + after.qty)
      const totalCost = r3(done.costMil + mid.costMil + after.costMil)
      const values: (number | string | null)[] = [
        nz(totalQty),
        nz(totalCost),
        planRate(done.qty, totalQty),
        nz(after.qty),
        nz(after.costMil),
        ...years.flatMap((y) => [nz(y.qty), nz(y.costMil)]),
        nz(num(e.effect?.people)) == null ? null : String(num(e.effect?.people)),
        nz(num(e.effect?.farmHa)) == null ? null : String(num(e.effect?.farmHa)),
        nz(num(e.effect?.buildings)) == null ? null : String(num(e.effect?.buildings)),
      ]
      const res = await client.query(
        `UPDATE layer.spf_plan_fac SET
           workload_m = $3, cost_mil = $4, done_rate = $5,
           after5_qty = $6, after5_cost_mil = $7,
           y1_qty = $8, y1_cost_mil = $9, y2_qty = $10, y2_cost_mil = $11,
           y3_qty = $12, y3_cost_mil = $13, y4_qty = $14, y4_cost_mil = $15,
           y5_qty = $16, y5_cost_mil = $17,
           effect_people = $18, effect_farm_ha = $19, effect_building = $20
         WHERE id = $1 AND plan_id = $2`,
        [id, planId, ...values]
      )
      updated += res.rowCount ?? 0
    }
    await client.query('COMMIT')
    return { success: true, updated }
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => undefined)
    return { success: false, error: errMsg(e) }
  } finally {
    client.release()
  }
}

/** 중기 연도구간 등록 — 이미 있는 구간이면 그 구간을 돌려준다 */
export async function createPlanPeriod(params: {
  startYear?: number
  endYear?: number
}): Promise<{ success: true; planId: number } | Fail> {
  const start = Number(params?.startYear)
  const end = Number(params?.endYear)
  if (!Number.isFinite(start) || start < 2000 || start > 2100) return { success: false, error: '시작연도가 올바르지 않습니다.' }
  if (!Number.isFinite(end) || end < start || end > 2100) return { success: false, error: '종료연도가 올바르지 않습니다.' }
  try {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO layer.spf_plan (start_year, end_year) VALUES ($1, $2)
       ON CONFLICT (start_year, end_year) DO NOTHING RETURNING id`,
      [start, end]
    )
    if (ins.rows[0]) return { success: true, planId: Number(ins.rows[0].id) }
    const cur = await pool.query<{ id: string }>(
      `SELECT id FROM layer.spf_plan WHERE start_year = $1 AND end_year = $2`,
      [start, end]
    )
    return { success: true, planId: Number(cur.rows[0]!.id) }
  } catch (e: unknown) {
    return { success: false, error: errMsg(e) }
  }
}

/** 정비계획에 들어 있는 관리번호(소교량은 묶음 관리번호) 전체 — 이관 목록의 «포함됨» 표시용 */
export async function getPlannedCodes(): Promise<{ success: true; codes: string[] } | Fail> {
  try {
    const r = await pool.query<{ cons_code: string }>(
      `SELECT DISTINCT cons_code FROM layer.spf_plan_fac WHERE cons_code IS NOT NULL`
    )
    return { success: true, codes: r.rows.map((x) => x.cons_code) }
  } catch (e: unknown) {
    return { success: false, error: errMsg(e) }
  }
}

/**
 * 안전점검 이관 — 선택한 시설을 정비계획에 추가한다.
 * 소교량은 리 묶음 매핑에 등록한 뒤 묶음 관리번호로 한 건만 넣고, 이미 정비계획에 있는 건은 건너뛴다.
 * planId 가 없으면 올해가 속한 연도구간에 넣는다.
 */
export async function transferToPlan(params: {
  facilityIds?: string[]
  planId?: number
}): Promise<
  | {
      success: true
      planId: number
      addedFacilities: number
      addedGroups: number
      alreadyCount: number
      skipped: number
    }
  | Fail
> {
  const ids = [...new Set((params?.facilityIds ?? []).map((x) => String(x).trim()).filter(Boolean))]
  const consCodes = ids.filter((id) => parseSpfFacilityUiId(id)?.kind === 'cons')
  const skipped = ids.length - consCodes.length
  try {
    const plans = await listPlans()
    const planId = pickPlanId(plans, params?.planId ? Number(params.planId) : undefined)
    if (planId == null) return { success: false, error: '등록된 정비연도가 없습니다.' }
    if (consCodes.length === 0) {
      return { success: true, planId, addedFacilities: 0, addedGroups: 0, alreadyCount: 0, skipped }
    }

    const bridgeRes = await pool.query<{ cons_code: string }>(
      `SELECT cons_code FROM layer.spf_bridge WHERE cons_code = ANY($1::text[])`,
      [consCodes]
    )
    const bridgeCodes = new Set(bridgeRes.rows.map((r) => r.cons_code))
    const reg = await registerBridgeGroupMembers({ facilityIds: [...bridgeCodes] })
    if (!reg.success) return { success: false, error: reg.error }
    const groupCodes = reg.groups.map((g) => g.groupCode)

    const otherRes = await pool.query<{ cons_code: string }>(
      `SELECT cons_code FROM (${facUnionSql('spf_bridge')}) f WHERE cons_code = ANY($1::text[])`,
      [consCodes.filter((c) => !bridgeCodes.has(c))]
    )
    const facilityCodes = otherRes.rows.map((r) => r.cons_code)

    const targets = [...new Set([...facilityCodes, ...groupCodes])]
    const exist = await pool.query<{ cons_code: string }>(
      `SELECT DISTINCT cons_code FROM layer.spf_plan_fac WHERE cons_code = ANY($1::text[])`,
      [targets]
    )
    const existSet = new Set(exist.rows.map((r) => r.cons_code))
    const toAdd = targets.filter((c) => !existSet.has(c))
    for (const code of toAdd) {
      await pool.query(`INSERT INTO layer.spf_plan_fac (plan_id, cons_code, status) VALUES ($1, $2, '작성중')`, [
        planId,
        code,
      ])
    }
    const groupSet = new Set(groupCodes)
    return {
      success: true,
      planId,
      addedFacilities: toAdd.filter((c) => !groupSet.has(c)).length,
      addedGroups: toAdd.filter((c) => groupSet.has(c)).length,
      alreadyCount: targets.length - toAdd.length,
      skipped,
    }
  } catch (e: unknown) {
    return { success: false, error: errMsg(e) }
  }
}
