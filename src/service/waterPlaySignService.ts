/**
 * 물놀이 표지판 — layer.water_play_sign 목록·상세·CRUD
 * 구조함·표지판 위치는 water_play_box_list / water_play_sign_list (1:N)
 */
import { pool } from '@/database/db';
import {
  resolveBoundaryWkt5181,
  sqlIntersectsBoundaryWkt,
} from './publicLayerBoundaryGeom';
import { resolveJijukParcelGeomsByAddresses } from './layerRowService';
import {
  getJijukGeomByPnu,
  getPnuFromAddress,
  resolvePnuFromParsedParts,
} from './excelUploadService';
import {
  parseOccupPlacePartsForJijuk,
  splitOccupPlaceSegments,
  normalizeOccupPlaceForJijuk,
} from '@/lib/occupationLedgerOccupPlaceGeom';

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

export type WaterPlayChildKind = 'box' | 'sign';

export type WaterPlayChildPoint = {
  fid: number;
  id: number;
  addr: string;
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

function parseGeomJson(raw: unknown): unknown | null {
  let geomJson: unknown = raw ?? null;
  if (typeof geomJson === 'string') {
    try {
      geomJson = JSON.parse(geomJson) as unknown;
    } catch {
      geomJson = null;
    }
  }
  return geomJson;
}

function mapRow(row: Record<string, unknown>): WaterPlaySignListItem {
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
    geomJson: parseGeomJson(row.geom_json ?? row.geomJson),
  };
}

function mapChildRow(row: Record<string, unknown>): WaterPlayChildPoint {
  return {
    fid: Number(row.fid),
    id: Number(row.id),
    addr: tx(row.addr) || '-',
    geomJson: parseGeomJson(row.geom_json ?? row.geomJson),
  };
}

function childTable(kind: WaterPlayChildKind): string {
  return kind === 'box' ? 'layer.water_play_box_list' : 'layer.water_play_sign_list';
}

function parseKind(v: unknown): WaterPlayChildKind | null {
  const s = tx(v);
  if (s === 'box' || s === 'sign') return s;
  return null;
}

function splitAddrParts(addr: string): string[] {
  const stripped = String(addr ?? '')
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .replace(/\([^)]*\)/g, ' ');
  return splitOccupPlaceSegments(stripped)
    .map((s) => normalizeOccupPlaceForJijuk(s))
    .filter(Boolean);
}

function geoJsonGeomString(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const geom = o.type === 'Feature' ? o.geometry : o;
  if (!geom || typeof geom !== 'object' || !('type' in (geom as object))) return null;
  try {
    return JSON.stringify(geom);
  } catch {
    return null;
  }
}

async function unionWkts5181(wkts: string[]): Promise<string | null> {
  if (wkts.length === 0) return null;
  const pieces = wkts.map(
    (_, i) => `ST_MakeValid(ST_SetSRID(ST_GeomFromText($${i + 1}), 5181))`
  );
  const unionSql = `
    SELECT ST_AsText(
      ST_Multi(
        ST_CollectionExtract(
          ST_MakeValid(ST_UnaryUnion(ST_Collect(ARRAY[${pieces.join(', ')}]))),
          3
        )
      )
    ) AS wkt
  `;
  const res = await pool.query<{ wkt: string | null }>(unionSql, wkts);
  return tx(res.rows[0]?.wkt) || null;
}

async function resolveMultiPolygonWkt5181(
  addr: string
): Promise<{ wkt: string | null; error?: string }> {
  const raw = tx(addr);
  if (!raw) return { wkt: null, error: '주소를 입력하세요.' };

  const occupParts = parseOccupPlacePartsForJijuk(raw);
  const wkts: string[] = [];
  for (const parsed of occupParts) {
    if (!parsed.emdName && !parsed.riName) continue;
    const pnuRes = await resolvePnuFromParsedParts(parsed);
    let pnu = tx(pnuRes.pnu);
    if (!pnu) {
      const lot =
        `${parsed.isMountain ? '산' : ''}${Number(parsed.bonbun)}` +
        (Number(parsed.bubun) ? `-${Number(parsed.bubun)}` : '');
      const rebuilt = [parsed.emdName, parsed.riName, lot].filter(Boolean).join(' ');
      pnu = tx(await getPnuFromAddress(rebuilt));
    }
    if (!pnu) continue;
    const wkt = tx(await getJijukGeomByPnu(pnu, 5181));
    if (wkt) wkts.push(wkt);
  }
  if (wkts.length > 0) {
    const unioned = await unionWkts5181(wkts);
    if (unioned) return { wkt: unioned };
  }

  const parts = splitAddrParts(raw);
  if (parts.length === 0) return { wkt: null, error: '주소를 입력하세요.' };
  const resolved = await resolveJijukParcelGeomsByAddresses({
    items: parts.map((address) => ({ address })),
  });
  const jsons = resolved.parcels
    .map((p) => geoJsonGeomString(p.geometry3857))
    .filter((s): s is string => Boolean(s));
  if (jsons.length === 0) {
    return { wkt: null, error: '주소에 해당하는 필지 면을 찾을 수 없습니다.' };
  }
  const pieces = jsons.map((_, i) => `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($${i + 1}), 3857), 5181)`);
  const unionSql = `
    SELECT ST_AsText(ST_Multi(ST_MakeValid(ST_UnaryUnion(ST_Collect(ARRAY[${pieces.join(', ')}]))))) AS wkt
  `;
  const res = await pool.query<{ wkt: string | null }>(unionSql, jsons);
  const wkt = tx(res.rows[0]?.wkt);
  if (!wkt) return { wkt: null, error: '필지 면을 합치지 못했습니다.' };
  return { wkt };
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

const CHILD_SELECT_SQL = (table: string) => `
  SELECT
    c.fid,
    c.id,
    c.addr,
    CASE
      WHEN c.geom IS NOT NULL THEN ST_AsGeoJSON(ST_Transform(c.geom, 4326))::json
      ELSE NULL
    END AS geom_json
  FROM ${table} c
`;

export async function list(p: Params): Promise<{ items: WaterPlaySignListItem[]; total: number }> {
  const keyword = tx(p.keyword);
  const emdCode = tx(p.emdCode ?? p.emd_cd);
  const riCode = tx(p.riCode ?? p.ri_cd);
  const limit = Math.min(5000, Math.max(1, Number(p.limit ?? 200)));

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    const i = params.length;
    // 통합검색: 시도·시군구·주소·상세주소·구분·비고 (+ 주소+상세주소 이어붙인 문구)
    whereParts.push(`(
      wps.sido ILIKE $${i}
      OR wps.sgg ILIKE $${i}
      OR wps.addr ILIKE $${i}
      OR wps.addr_detail ILIKE $${i}
      OR concat_ws(' ', nullif(trim(coalesce(wps.addr, '')), ''), nullif(trim(coalesce(wps.addr_detail, '')), '')) ILIKE $${i}
      OR wps.gubun ILIKE $${i}
      OR wps.remark ILIKE $${i}
    )`);
  }
  const boundaryWkt = await resolveBoundaryWkt5181({ emdCode, riCode });
  if (boundaryWkt) {
    params.push(boundaryWkt);
    whereParts.push(sqlIntersectsBoundaryWkt('wps.geom', params.length));
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

async function listChildrenByParent(
  kind: WaterPlayChildKind,
  parentId: number
): Promise<WaterPlayChildPoint[]> {
  const dataSql = `${CHILD_SELECT_SQL(childTable(kind))} WHERE c.id = $1 ORDER BY c.fid`;
  const dataRes = await pool.query<Record<string, unknown>>(dataSql, [parentId]);
  return dataRes.rows.map((r) => mapChildRow(r));
}

export async function get(p: Params): Promise<{
  item: WaterPlaySignListItem | null;
  boxItems?: WaterPlayChildPoint[];
  signItems?: WaterPlayChildPoint[];
}> {
  const id = parseId(p.id);
  if (!id) return { item: null };

  const dataSql = `${LIST_SELECT_SQL} WHERE wps.id = $1 LIMIT 1`;
  const dataRes = await pool.query<Record<string, unknown>>(dataSql, [id]);
  const row = dataRes.rows[0];
  if (!row) return { item: null };
  const [boxItems, signItems] = await Promise.all([
    listChildrenByParent('box', id),
    listChildrenByParent('sign', id),
  ]);
  return { item: mapRow(row), boxItems, signItems };
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
  const gubun = res.rows.map((r) => tx(r.gubun)).filter(Boolean);
  return { gubun };
}

export async function listChildren(p: Params): Promise<{ items: WaterPlayChildPoint[] }> {
  const kind = parseKind(p.kind);
  const parentId = parseId(p.id ?? p.parentId);
  if (!kind || !parentId) return { items: [] };
  return { items: await listChildrenByParent(kind, parentId) };
}

export async function addChild(
  p: Params
): Promise<{ ok: boolean; error?: string; item?: WaterPlayChildPoint }> {
  const kind = parseKind(p.kind);
  const parentId = parseId(p.id ?? p.parentId);
  const addr = tx(p.addr);
  const lon = toCoord(p.lon);
  const lat = toCoord(p.lat);
  if (!kind) return { ok: false, error: '구분을 확인할 수 없습니다.' };
  if (!parentId) return { ok: false, error: '관리 구간을 확인할 수 없습니다.' };
  if (lon == null || lat == null) {
    return { ok: false, error: '지도에서 위치를 지정하세요.' };
  }

  const insertSql = `
    INSERT INTO ${childTable(kind)} (id, addr, geom)
    VALUES ($1, $2, ST_Transform(ST_SetSRID(ST_MakePoint($3, $4), 4326), 5181))
    RETURNING fid
  `;
  const res = await pool.query<{ fid: number }>(insertSql, [
    parentId,
    addr || null,
    lon,
    lat,
  ]);
  const fid = res.rows[0]?.fid;
  if (!fid) return { ok: false, error: '등록에 실패했습니다.' };
  const dataSql = `${CHILD_SELECT_SQL(childTable(kind))} WHERE c.fid = $1 LIMIT 1`;
  const dataRes = await pool.query<Record<string, unknown>>(dataSql, [fid]);
  const row = dataRes.rows[0];
  if (!row) return { ok: false, error: '등록에 실패했습니다.' };
  return { ok: true, item: mapChildRow(row) };
}

export async function removeChild(p: Params): Promise<{ ok: boolean; error?: string }> {
  const kind = parseKind(p.kind);
  const fid = parseId(p.fid);
  if (!kind || !fid) return { ok: false, error: '항목을 찾을 수 없습니다.' };
  const res = await pool.query(`DELETE FROM ${childTable(kind)} WHERE fid = $1`, [fid]);
  if ((res.rowCount ?? 0) === 0) {
    return { ok: false, error: '항목을 찾을 수 없습니다.' };
  }
  return { ok: true };
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

  if (!addr) {
    return { ok: false, error: '주소를 입력하세요.' };
  }

  const insertSql = `
    INSERT INTO layer.water_play_sign (
      sido, sgg, addr, addr_detail, gubun, is_warnig, safebox_cnt, sign_cnt, remark, geom
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL
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

  if (!addr) {
    return { ok: false, error: '주소를 입력하세요.' };
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
      remark = $9
    WHERE id = $10
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

/** 주소로 지적 면을 찾아 목록 이동용 도형을 넣는다. 못 찾으면 비운다. */
export async function fillGeomFromAddr(
  _p: Params = {}
): Promise<{ filled: number; cleared: number; skipped: number; total: number; error?: string }> {
  const empty = { filled: 0, cleared: 0, skipped: 0, total: 0 };
  try {
    const dataRes = await pool.query<{ id: number; addr: string | null }>(
      `SELECT id, addr FROM layer.water_play_sign ORDER BY id`
    );
    const rows = dataRes.rows;
    let filled = 0;
    let cleared = 0;
    let skipped = 0;
    for (const row of rows) {
      const id = Number(row.id);
      const addr = tx(row.addr);
      if (!Number.isFinite(id) || id <= 0) {
        skipped += 1;
        continue;
      }
      if (!addr) {
        await pool.query(`UPDATE layer.water_play_sign SET geom = NULL WHERE id = $1`, [id]);
        cleared += 1;
        continue;
      }
      const geom = await resolveMultiPolygonWkt5181(addr);
      if (!geom.wkt) {
        await pool.query(`UPDATE layer.water_play_sign SET geom = NULL WHERE id = $1`, [id]);
        cleared += 1;
        continue;
      }
      await pool.query(
        `UPDATE layer.water_play_sign
         SET geom = ST_SetSRID(ST_GeomFromText($1), 5181)
         WHERE id = $2`,
        [geom.wkt, id]
      );
      filled += 1;
    }
    return { filled, cleared, skipped, total: rows.length };
  } catch (e: unknown) {
    return {
      ...empty,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
