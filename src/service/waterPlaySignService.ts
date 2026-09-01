/**
 * 물놀이 표지판 — layer.water_play_sign 목록·상세
 */
import { pool } from '@/database/db';

type Params = Record<string, unknown>;

export type WaterPlaySignListItem = {
  id: number;
  signNm: string;
  addr: string;
  signType: string;
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
    signNm: tx(row.sign_nm ?? row.signNm) || '-',
    addr: tx(row.addr) || '-',
    signType: tx(row.sign_type ?? row.signType) || '-',
    remark: tx(row.remark) || '-',
    geomJson,
  };
}

const LIST_SELECT_SQL = `
  SELECT
    wps.id,
    wps.sign_nm,
    wps.addr,
    wps.sign_type,
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
    whereParts.push(
      `(wps.sign_nm ILIKE $${i} OR wps.addr ILIKE $${i} OR wps.sign_type ILIKE $${i})`
    );
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const countSql = `SELECT count(*)::int AS c FROM layer.water_play_sign wps ${whereClause}`;
  const dataSql = `${LIST_SELECT_SQL} ${whereClause} ORDER BY wps.sign_nm ASC NULLS LAST, wps.id ASC LIMIT $${params.length + 1}`;

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
