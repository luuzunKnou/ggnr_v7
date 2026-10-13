/**
 * 방사선 대피소 — layer.radiation_shelter 목록·상세
 */
import { pool } from '@/database/db';
import {
  resolveBoundaryWkt5181,
  sqlIntersectsBoundaryWkt,
} from './publicLayerBoundaryGeom';

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
  const emdCode = tx(p.emdCode ?? p.emd_cd);
  const limit = Math.min(5000, Math.max(1, Number(p.limit ?? 200)));

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    const i = params.length;
    whereParts.push(
      `(rs.ftn_nm ILIKE $${i} OR rs.addr ILIKE $${i} OR rs.remark ILIKE $${i} OR rs.actc_tnop::text ILIKE $${i})`
    );
  }
  const boundaryWkt = await resolveBoundaryWkt5181({ emdCode });
  if (boundaryWkt) {
    params.push(boundaryWkt);
    whereParts.push(sqlIntersectsBoundaryWkt('rs.geom', params.length));
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const countSql = `SELECT count(*)::int AS c FROM layer.radiation_shelter rs ${whereClause}`;
  const dataSql = `${LIST_SELECT_SQL} ${whereClause} ORDER BY rs.id DESC LIMIT $${params.length + 1}`;

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

export async function create(
  p: Params
): Promise<{ ok: boolean; id?: number; error?: string; item?: RadiationShelterListItem }> {
  const ftnNm = tx(p.ftnNm ?? p.ftn_nm);
  const addr = tx(p.addr);
  const remark = tx(p.remark);
  const actcTnop = toNum(p.actcTnop ?? p.actc_tnop);
  const lon = toNum(p.lon);
  const lat = toNum(p.lat);

  if (!ftnNm) {
    return { ok: false, error: '시설명을 입력하세요.' };
  }
  if (!addr) {
    return { ok: false, error: '주소를 입력하세요.' };
  }
  if (lon == null || lat == null) {
    return { ok: false, error: '주소 검색 또는 지도에서 위치를 지정하세요.' };
  }

  const insertSql = `
    INSERT INTO layer.radiation_shelter (ftn_nm, addr, actc_tnop, remark, geom)
    VALUES (
      $1,
      $2,
      $3,
      $4,
      ST_Transform(ST_SetSRID(ST_MakePoint($5, $6), 4326), 5181)
    )
    RETURNING id
  `;
  const res = await pool.query<{ id: number }>(insertSql, [
    ftnNm,
    addr,
    actcTnop,
    remark || null,
    lon,
    lat,
  ]);
  const id = res.rows[0]?.id;
  if (!id) return { ok: false, error: '등록에 실패했습니다.' };
  const got = await get({ id });
  return { ok: true, id, item: got.item ?? undefined };
}

export async function update(
  p: Params
): Promise<{ ok: boolean; error?: string; item?: RadiationShelterListItem }> {
  const id = parseId(p.id);
  if (!id) return { ok: false, error: '항목을 찾을 수 없습니다.' };

  const ftnNm = tx(p.ftnNm ?? p.ftn_nm);
  const addr = tx(p.addr);
  const remark = tx(p.remark);
  const actcTnop = toNum(p.actcTnop ?? p.actc_tnop);
  const lon = toNum(p.lon);
  const lat = toNum(p.lat);

  if (!ftnNm) {
    return { ok: false, error: '시설명을 입력하세요.' };
  }
  if (!addr) {
    return { ok: false, error: '주소를 입력하세요.' };
  }
  if (lon == null || lat == null) {
    return { ok: false, error: '주소 검색 또는 지도에서 위치를 지정하세요.' };
  }

  const updateSql = `
    UPDATE layer.radiation_shelter
    SET
      ftn_nm = $1,
      addr = $2,
      actc_tnop = $3,
      remark = $4,
      geom = ST_Transform(ST_SetSRID(ST_MakePoint($5, $6), 4326), 5181)
    WHERE id = $7
  `;
  const res = await pool.query(updateSql, [ftnNm, addr, actcTnop, remark || null, lon, lat, id]);
  if ((res.rowCount ?? 0) === 0) {
    return { ok: false, error: '항목을 찾을 수 없습니다.' };
  }
  const got = await get({ id });
  return { ok: true, item: got.item ?? undefined };
}

export async function remove(p: Params): Promise<{ ok: boolean; error?: string }> {
  const id = parseId(p.id);
  if (!id) return { ok: false, error: '항목을 찾을 수 없습니다.' };

  const res = await pool.query('DELETE FROM layer.radiation_shelter WHERE id = $1', [id]);
  if ((res.rowCount ?? 0) === 0) {
    return { ok: false, error: '항목을 찾을 수 없습니다.' };
  }
  return { ok: true };
}
