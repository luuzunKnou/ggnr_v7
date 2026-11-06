/**
 * 메인(대시보드) 통계·현황 위젯용 집계 API
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import {
  formatRoadLedgerRoadRankForTitle,
  normalizeRoadRankCodeKey,
  ROAD_RANK_CODE_KO,
} from '@/app/(pages)/map/_mapContents/road/roadLedger/roadLedgerFormat';
import { db } from '@/database/db';
import { loginLog } from '@/database/schema/login_log';
import { usr } from '@/database/schema/usr';
import { riverBasicPlanAsDefineTable, type RiverBasicPlanTab } from '@/lib/riverBasicPlanMapAttachmentLayers';
import { getRoadLedgerList } from '@/service/roadLedgerService';

type Params = Record<string, unknown>;

type ChartPoint = { label: string; count: number };

export type LoginAccessRankRow = {
  loginUser: string;
  usrName: string | null;
  ugName: string | null;
  count: number;
};

function seoulYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

function parseDayBound(raw: unknown, endOfDay: boolean): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/-/g, '');
  if (!/^\d{8}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  if (endOfDay) return new Date(y, m, d, 23, 59, 59, 999);
  return new Date(y, m, d, 0, 0, 0, 0);
}

function defaultLoginRange(): { startDate: string; endDate: string } {
  const end = seoulYmd(new Date());
  const [y, m, d] = end.split('-').map(Number);
  const startDt = new Date(y, m - 1, d);
  startDt.setDate(startDt.getDate() - 6);
  return { startDate: seoulYmd(startDt), endDate: end };
}

function escIdent(value: string): string {
  return value.replace(/'/g, "''");
}

async function resolveLayerTableName(wantedLower: string): Promise<string | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'layer' AND lower(table_name) = '${escIdent(wantedLower)}'
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_name?: string } | undefined;
  const name = String(row?.table_name ?? '').trim();
  return name || null;
}

function parsePlanLenKm(raw: unknown): number {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function riverNameMaxPlanLenKm(tab: RiverBasicPlanTab): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const tableName = await resolveLayerTableName(riverBasicPlanAsDefineTable(tab));
  if (!tableName) return out;
  const safeTbl = tableName.replace(/"/g, '""');
  const res = await db.execute(
    sql.raw(
      `SELECT
         TRIM(river_name::text) AS river_name,
         MAX(
           NULLIF(regexp_replace(TRIM(BOTH FROM plan_len::text), '[^0-9.\\-]', '', 'g'), '')::float8
         ) AS plan_len
       FROM layer."${safeTbl}"
       WHERE COALESCE(TRIM(river_name::text), '') <> ''
       GROUP BY TRIM(river_name::text)`
    )
  );
  for (const r of res.rows ?? []) {
    const row = r as { river_name?: string; plan_len?: unknown };
    const name = String(row.river_name ?? '').trim();
    const len = parsePlanLenKm(row.plan_len);
    if (!name || len <= 0) continue;
    out.set(name, len);
  }
  return out;
}

function parseRoadLedgerLengthM(raw: string): number {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function roadRankGroupLabel(rawCode: string, groupKey: string): string {
  if (groupKey === '__empty__') return '미분류';
  if (ROAD_RANK_CODE_KO[groupKey]?.label) return ROAD_RANK_CODE_KO[groupKey].label;
  const fromTitle = formatRoadLedgerRoadRankForTitle(rawCode);
  return fromTitle || rawCode || '미분류';
}

/** ROAD_RANK(도로종류)별 연장 합계 — 도로대장 UI 코드표와 동일 정규화 */
function mergeRoadRankLengthRows(
  rows: Array<{ roadRank: string; roadLedgerLenth: string }>
): ChartPoint[] {
  const merged = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const rawCode = String(row.roadRank ?? '').trim();
    const groupKey = rawCode ? normalizeRoadRankCodeKey(rawCode) || rawCode : '__empty__';
    const len = parseRoadLedgerLengthM(row.roadLedgerLenth);
    if (!Number.isFinite(len) || len <= 0) continue;
    const label = roadRankGroupLabel(rawCode, groupKey);
    const prev = merged.get(groupKey);
    if (prev) prev.count += len;
    else merged.set(groupKey, { label, count: len });
  }
  const knownOrder = Object.keys(ROAD_RANK_CODE_KO);
  return [...merged.entries()]
    .sort((a, b) => {
      const diff = b[1].count - a[1].count;
      if (diff !== 0) return diff;
      const ai = knownOrder.indexOf(a[0]);
      const bi = knownOrder.indexOf(b[0]);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    })
    .map(([, v]) => v);
}

/** 도로대장 — 도로종류(ROAD_RANK)별 연장 합계(m) */
export async function getRoadLedgerStatusSummary(_p: Params = {}) {
  const { rows } = await getRoadLedgerList({});
  let totalLengthM = 0;
  for (const row of rows) {
    totalLengthM += parseRoadLedgerLengthM(row.roadLedgerLenth);
  }
  const items = mergeRoadRankLengthRows(rows);
  return { totalCount: rows.length, totalLengthM, items };
}

/** 하천기본계획 — 하천명별 기본계획연장(km) 상위 6개 */
export async function getRiverBasicPlanStatusSummary(_p: Params = {}) {
  const empty = {
    totalRiverCount: 0,
    totalLengthKm: 0,
    items: [] as ChartPoint[],
  };

  try {
    const [river, small] = await Promise.all([
      riverNameMaxPlanLenKm('river'),
      riverNameMaxPlanLenKm('smallRiver'),
    ]);

    const merged = new Map<string, number>();
    for (const src of [river, small]) {
      for (const [name, len] of src) {
        merged.set(name, Math.max(merged.get(name) ?? 0, len));
      }
    }

    const ranked = [...merged.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));

    const totalLengthKm = ranked.reduce((sum, d) => sum + d.count, 0);
    return {
      totalRiverCount: ranked.length,
      totalLengthKm,
      items: ranked.slice(0, 6),
    };
  } catch {
    return empty;
  }
}

/** 메인 대시보드용 로그인 추이 — 사용자 상세 없이 기간별 합계만 */
export async function getLoginLogChartSummary(p: Params = {}) {
  const fallback = defaultLoginRange();
  const startDate = String(p.startDate ?? fallback.startDate).trim();
  const endDate = String(p.endDate ?? fallback.endDate).trim();
  const start = parseDayBound(startDate, false);
  const end = parseDayBound(endDate, true);
  if (!start || !end) {
    return { startDate, endDate, chartData: [] as ChartPoint[], total: 0, topUsers: [] as LoginAccessRankRow[] };
  }

  const bucket = sql`to_char(date_trunc('day', (${loginLog.loginTime} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')), 'MM-DD')`;
  const rangeConds = and(
    gte(loginLog.loginTime, start.toISOString()),
    lte(loginLog.loginTime, end.toISOString())
  );

  const chartRows = await db
    .select({
      label: sql<string>`${bucket}`,
      count: sql<number>`count(*)::int`,
    })
    .from(loginLog)
    .where(rangeConds)
    .groupBy(sql`${bucket}`)
    .orderBy(sql`${bucket}`);

  const chartMap = new Map<string, number>();
  for (const r of chartRows) {
    const label = String(r.label ?? '').trim();
    if (!label) continue;
    chartMap.set(label, Number(r.count ?? 0));
  }

  const dateList: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dateList.push(
      `${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    );
    cursor.setDate(cursor.getDate() + 1);
  }

  const chartData = dateList.map((label) => ({
    label,
    count: chartMap.get(label) ?? 0,
  }));
  const total = chartData.reduce((s, d) => s + d.count, 0);

  const rankRows = await db
    .select({
      loginUser: loginLog.loginUser,
      usrName: sql<string | null>`max(${usr.usrName})`,
      ugName: sql<string | null>`max(${usr.ugName})`,
      count: sql<number>`count(*)::int`,
    })
    .from(loginLog)
    .leftJoin(usr, eq(loginLog.loginUser, usr.usrId))
    .where(rangeConds)
    .groupBy(loginLog.loginUser)
    .orderBy(sql`count(*) desc`, loginLog.loginUser)
    .limit(3);

  const topUsers: LoginAccessRankRow[] = rankRows
    .map((r) => ({
      loginUser: String(r.loginUser ?? '').trim(),
      usrName: r.usrName ?? null,
      ugName: r.ugName ?? null,
      count: Number(r.count ?? 0),
    }))
    .filter((r) => r.loginUser && r.count > 0);

  return { startDate, endDate, chartData, total, topUsers };
}
