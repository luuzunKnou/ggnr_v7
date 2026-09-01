/**
 * 방사선 대피소 — layer.radiation_shelter 목록·상세
 */
import { pool } from '@/database/db';

type Params = Record<string, unknown>;

export type RadiationShelterListItem = {
  id: number;
  ftnNm: string;
  addr: string;
  actcTnop: number | null;
  remark: string;
  geomJson: unknown | null;
};

function tx(v: unknown): string {
  return String(v ?? '').trim();
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function parseId(v: unknown): number | null {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function mapRow(row: Record<string, unknown>): RadiationShelterListItem {
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
    ftnNm: tx(row.ftn_nm ?? row.ftnNm) || '-',
    addr: tx(row.addr) || '-',
    actcTnop: toNum(row.actc_tnop ?? row.actcTnop),
    remark: tx(row.remark) || '-',
    geomJson,
  };
}

const LIST_SELECT_SQL = `
  SELECT
    rs.id,
    rs.ftn_nm,
    rs.addr,
    rs.actc_tnop,
    rs.remark,
    CASE
      WHEN rs.geom IS NOT NULL THEN ST_AsGeoJSON(ST_Transform(rs.geom, 4326))::json
      ELSE NULL
    END AS geom_json
  FROM layer.radiation_shelter rs
`;

export async function list(p: Params): Promise<{ items: RadiationShelterListItem[]; total: number }> {
  const keyword = tx(p.keyword);
  const limit = Math.min(500, Math.max(1, Number(p.limit ?? 200)));

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    const i = params.length;
    whereParts.push(`(rs.ftn_nm ILIKE $${i} OR rs.addr ILIKE $${i})`);
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const countSql = `SELECT count(*)::int AS c FROM layer.radiation_shelter rs ${whereClause}`;
  const dataSql = `${LIST_SELECT_SQL} ${whereClause} ORDER BY rs.ftn_nm ASC NULLS LAST, rs.id ASC LIMIT $${params.length + 1}`;

  const countRes = await pool.query<{ c: number }>(countSql, params);
  const total = Number(countRes.rows[0]?.c ?? 0);

  const dataRes = await pool.query<Record<string, unknown>>(dataSql, [...params, limit]);
  const items = dataRes.rows.map((r) => mapRow(r));
  return { items, total };
}

export async function get(p: Params): Promise<{ item: RadiationShelterListItem | null }> {
  const id = parseId(p.id);
  if (!id) return { item: null };

  const dataSql = `${LIST_SELECT_SQL} WHERE rs.id = $1 LIMIT 1`;
  const dataRes = await pool.query<Record<string, unknown>>(dataSql, [id]);
  const row = dataRes.rows[0];
  if (!row) return { item: null };
  return { item: mapRow(row) };
}
