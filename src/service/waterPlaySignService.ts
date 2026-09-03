/**
 * 물놀이 표지판 — layer.water_play_sign 목록·상세·CRUD
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

function toInt(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function toCoord(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
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
    sido: tx(row.sido) || '-',
    sgg: tx(row.sgg) || '-',
    addr: tx(row.addr) || '-',
    addrDetail: tx(row.addr_detail ?? row.addrDetail) || '-',
    gubun: tx(row.gubun) || '-',
    isWarnig: tx(row.is_warnig ?? row.isWarnig) || '-',
    safeboxCnt: toInt(row.safebox_cnt ?? row.safeboxCnt),
    signCnt: toInt(row.sign_cnt ?? row.signCnt),
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
  const emdNm = tx(p.emdNm ?? p.emd_nm);
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
  if (emdNm) {
    params.push(`%${emdNm}%`);
    const i = params.length;
    whereParts.push(`wps.addr ILIKE $${i}`);
  }
  const gubun = tx(p.gubun);
  if (gubun) {
    params.push(gubun);
    const i = params.length;
    whereParts.push(`wps.gubun = $${i}`);
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const countSql = `SELECT count(*)::int AS c FROM layer.water_play_sign wps ${whereClause}`;
  const dataSql = `${LIST_SELECT_SQL} ${whereClause} ORDER BY wps.id DESC LIMIT $${params.length + 1}`;

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

/** 구분(gubun) distinct 목록 — 필터 칩용 */
export async function listGubunOptions(_p: Params = {}): Promise<{ gubun: string[] }> {
  const res = await pool.query<{ gubun: string }>(
    `SELECT DISTINCT trim(gubun::text) AS gubun
     FROM layer.water_play_sign
     WHERE gubun IS NOT NULL
       AND trim(gubun::text) <> ''
       AND trim(gubun::text) <> '-'
     ORDER BY gubun`
  );
  const gubun = res.rows
    .map((r) => tx(r.gubun))
    .filter(Boolean);
  return { gubun };
}

export async function create(
  p: Params
): Promise<{ ok: boolean; id?: number; error?: string; item?: WaterPlaySignListItem }> {
  const sido = tx(p.sido);
  const sgg = tx(p.sgg);
  const addr = tx(p.addr);
  const addrDetail = tx(p.addr_detail ?? p.addrDetail);
  const gubun = tx(p.gubun);
  const isWarnig = tx(p.is_warnig ?? p.isWarnig);
  const remark = tx(p.remark);
  const safeboxCnt = toInt(p.safebox_cnt ?? p.safeboxCnt);
  const signCnt = toInt(p.sign_cnt ?? p.signCnt);
  const lon = toCoord(p.lon);
  const lat = toCoord(p.lat);

  if (!addr) {
    return { ok: false, error: '주소를 입력하세요.' };
  }
  if (lon == null || lat == null) {
    return { ok: false, error: '주소 검색 또는 지도에서 위치를 지정하세요.' };
  }

  const insertSql = `
    INSERT INTO layer.water_play_sign (
      sido, sgg, addr, addr_detail, gubun, is_warnig, safebox_cnt, sign_cnt, remark, geom
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      ST_Transform(ST_SetSRID(ST_MakePoint($10, $11), 4326), 5181)
    )
    RETURNING id
  `;
  const res = await pool.query<{ id: number }>(insertSql, [
    sido || null,
    sgg || null,
    addr,
    addrDetail || null,
    gubun || null,
    isWarnig || null,
    safeboxCnt,
    signCnt,
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
): Promise<{ ok: boolean; error?: string; item?: WaterPlaySignListItem }> {
  const id = parseId(p.id);
  if (!id) return { ok: false, error: '항목을 찾을 수 없습니다.' };

  const sido = tx(p.sido);
  const sgg = tx(p.sgg);
  const addr = tx(p.addr);
  const addrDetail = tx(p.addr_detail ?? p.addrDetail);
  const gubun = tx(p.gubun);
  const isWarnig = tx(p.is_warnig ?? p.isWarnig);
  const remark = tx(p.remark);
  const safeboxCnt = toInt(p.safebox_cnt ?? p.safeboxCnt);
  const signCnt = toInt(p.sign_cnt ?? p.signCnt);
  const lon = toCoord(p.lon);
  const lat = toCoord(p.lat);

  if (!addr) {
    return { ok: false, error: '주소를 입력하세요.' };
  }
  if (lon == null || lat == null) {
    return { ok: false, error: '주소 검색 또는 지도에서 위치를 지정하세요.' };
  }

  const updateSql = `
    UPDATE layer.water_play_sign
    SET
      sido = $1,
      sgg = $2,
      addr = $3,
      addr_detail = $4,
      gubun = $5,
      is_warnig = $6,
      safebox_cnt = $7,
      sign_cnt = $8,
      remark = $9,
      geom = ST_Transform(ST_SetSRID(ST_MakePoint($10, $11), 4326), 5181)
    WHERE id = $12
  `;
  const res = await pool.query(updateSql, [
    sido || null,
    sgg || null,
    addr,
    addrDetail || null,
    gubun || null,
    isWarnig || null,
    safeboxCnt,
    signCnt,
    remark || null,
    lon,
    lat,
    id,
  ]);
  if ((res.rowCount ?? 0) === 0) {
    return { ok: false, error: '항목을 찾을 수 없습니다.' };
  }
  const got = await get({ id });
  return { ok: true, item: got.item ?? undefined };
}

export async function remove(p: Params): Promise<{ ok: boolean; error?: string }> {
  const id = parseId(p.id);
  if (!id) return { ok: false, error: '항목을 찾을 수 없습니다.' };

  const res = await pool.query('DELETE FROM layer.water_play_sign WHERE id = $1', [id]);
  if ((res.rowCount ?? 0) === 0) {
    return { ok: false, error: '항목을 찾을 수 없습니다.' };
  }
  return { ok: true };
}
