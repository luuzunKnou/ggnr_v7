/**
 * 물놀이 표지판 — layer.water_play_sign 목록·상세
 */
import { pool } from '@/database/db';

type Params = Record<string, unknown>;

export type WaterPlaySignListItem = {
  id: number;
  sido: string;
  sgg: string;
  addr: string;
  addrDetail: string;
  gubun: string;
  isWarnig: string;
  safeboxCnt: number | null;
  signCnt: number | null;
  remark: string;
  geomJson: unknown | null;
};

function tx(v: unknown): string {
  return String(v ?? '').trim();
}

function parseId(v: unknown): number | null {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseOptionalInt(v: unknown): number | null {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function mapRow(row: Record<string, unknown>): WaterPlaySignListItem {
  let geomJson: unknown = row.geom_json ?? row.geomJson ?? null;
  if (typeof geomJson === 'string') {
    try {
      geomJson = JSON.parse(geomJson) as unknown;
    } catch {
      geomJson = null;
    }
  }
  return {
    id: Number(row.id),
    sido: tx(row.sido) || '-',
    sgg: tx(row.sgg) || '-',
    addr: tx(row.addr) || '-',
    addrDetail: tx(row.addr_detail ?? row.addrDetail) || '-',
    gubun: tx(row.gubun) || '-',
    isWarnig: tx(row.is_warnig ?? row.isWarnig) || '-',
    safeboxCnt: parseOptionalInt(row.safebox_cnt ?? row.safeboxCnt),
    signCnt: parseOptionalInt(row.sign_cnt ?? row.signCnt),
    remark: tx(row.remark) || '-',
    geomJson,
  };
}

const LIST_SELECT_SQL = `
  SELECT
    wps.id,
    wps.sido,
    wps.sgg,
    wps.addr,
    wps.addr_detail,
    wps.gubun,
    wps.is_warnig,
    wps.safebox_cnt,
    wps.sign_cnt,
    wps.remark,
    CASE
      WHEN wps.geom IS NOT NULL THEN ST_AsGeoJSON(ST_Transform(wps.geom, 4326))::json
      ELSE NULL
    END AS geom_json
  FROM layer.water_play_sign wps
`;

export async function list(p: Params): Promise<{ items: WaterPlaySignListItem[]; total: number }> {
  const keyword = tx(p.keyword);
  const limit = Math.min(500, Math.max(1, Number(p.limit ?? 200)));

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    const i = params.length;
    whereParts.push(`(
      wps.sido ILIKE $${i}
      OR wps.sgg ILIKE $${i}
      OR wps.addr ILIKE $${i}
      OR wps.addr_detail ILIKE $${i}
      OR wps.gubun ILIKE $${i}
      OR wps.remark ILIKE $${i}
    )`);
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const countSql = `SELECT count(*)::int AS c FROM layer.water_play_sign wps ${whereClause}`;
  const dataSql = `${LIST_SELECT_SQL} ${whereClause} ORDER BY wps.addr ASC NULLS LAST, wps.id ASC LIMIT $${params.length + 1}`;

  const countRes = await pool.query<{ c: number }>(countSql, params);
  const total = Number(countRes.rows[0]?.c ?? 0);

  const dataRes = await pool.query<Record<string, unknown>>(dataSql, [...params, limit]);
  const items = dataRes.rows.map((r) => mapRow(r));
  return { items, total };
}

export async function get(p: Params): Promise<{ item: WaterPlaySignListItem | null }> {
  const id = parseId(p.id);
  if (!id) return { item: null };

  const dataSql = `${LIST_SELECT_SQL} WHERE wps.id = $1 LIMIT 1`;
  const dataRes = await pool.query<Record<string, unknown>>(dataSql, [id]);
  const row = dataRes.rows[0];
  if (!row) return { item: null };
  return { item: mapRow(row) };
}
