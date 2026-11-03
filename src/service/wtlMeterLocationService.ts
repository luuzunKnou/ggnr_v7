/**
 * 계량기위치 — 계량기번호(met_num)로 위치 조회
 */
import { sql } from 'drizzle-orm';
import db from '@/database/db';
import { getEmdGeometry, getRiGeometry } from './devTestService';
import { getWtlSupplyBlockGeometry } from './wtlNetworkService';

export type WtlMeterByNumberDto = {
  input: string;
  meterNo: string;
  address: string;
  point: [number, number] | null;
  found: boolean;
};

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function parseLonLat(raw: unknown): [number, number] | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as { type?: string; coordinates?: unknown };
  if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const lon = Number(g.coordinates[0]);
    const lat = Number(g.coordinates[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, lat];
  }
  return null;
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const res = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = '${esc(schema)}' AND lower(table_name) = '${esc(table.toLowerCase())}'
       LIMIT 1`
    )
  );
  return (res.rows?.length ?? 0) > 0;
}

/**
 * 계량기번호를 한 줄씩 받아 급수전계량기 위치(4326)를 조회한다.
 */
export async function locateMetersByNumbers(params: {
  numbers?: string[] | null;
}): Promise<{ rows: WtlMeterByNumberDto[] }> {
  const numbers = (params.numbers ?? [])
    .map((n) => String(n ?? '').trim())
    .filter(Boolean);
  if (numbers.length === 0) return { rows: [] };
  if (!(await tableExists('layer', 'wtl_meta_ps'))) {
    return {
      rows: numbers.map((input) => ({
        input,
        meterNo: input,
        address: '',
        point: null,
        found: false,
      })),
    };
  }

  const unique = [...new Set(numbers)];
  const inList = unique.map((n) => `'${esc(n)}'`).join(',');
  const res = await db.execute(
    sql.raw(
      `SELECT DISTINCT ON (trim(t.met_num))
         trim(t.met_num) AS "meterNo",
         COALESCE(NULLIF(trim(t.hom_adr),''), '') AS address,
         ST_AsGeoJSON(ST_Transform(ST_Centroid(t.geom), 4326))::json AS geom
       FROM layer.wtl_meta_ps t
       WHERE t.geom IS NOT NULL
         AND NULLIF(trim(t.met_num),'') IS NOT NULL
         AND trim(t.met_num) IN (${inList})
       ORDER BY trim(t.met_num), t.ogc_fid`
    )
  );

  const byNo = new Map<string, { meterNo: string; address: string; point: [number, number] | null }>();
  for (const row of res.rows ?? []) {
    const r = row as Record<string, unknown>;
    const meterNo = asStr(r.meterNo);
    if (!meterNo) continue;
    byNo.set(meterNo, {
      meterNo,
      address: asStr(r.address),
      point: parseLonLat(r.geom),
    });
  }

  return {
    rows: numbers.map((input) => {
      const hit = byNo.get(input);
      if (!hit || !hit.point) {
        return {
          input,
          meterNo: input,
          address: hit?.address ?? '',
          point: null,
          found: false,
        };
      }
      return {
        input,
        meterNo: hit.meterNo,
        address: hit.address,
        point: hit.point,
        found: true,
      };
    }),
  };
}

export type WtlMeterSuggestDto = {
  meterNo: string;
  address: string;
};

/**
 * 계량기번호(met_num) 자동완성 — prefix ILIKE.
 */
export async function suggestMeterNumbers(params: {
  keyword?: string | null;
  limit?: number | null;
}): Promise<{ rows: WtlMeterSuggestDto[] }> {
  const keyword = String(params.keyword ?? '').trim();
  if (!keyword) return { rows: [] };
  if (!(await tableExists('layer', 'wtl_meta_ps'))) return { rows: [] };

  const lim = Math.min(50, Math.max(1, Number(params.limit) || 30));
  const res = await db.execute(
    sql.raw(
      `SELECT DISTINCT trim(t.met_num) AS "meterNo",
         COALESCE(NULLIF(trim(t.hom_adr),''), '') AS address
       FROM layer.wtl_meta_ps t
       WHERE NULLIF(trim(t.met_num),'') IS NOT NULL
         AND trim(t.met_num) ILIKE '${esc(keyword)}%'
       ORDER BY 1
       LIMIT ${lim}`
    )
  );

  const rows: WtlMeterSuggestDto[] = [];
  for (const row of res.rows ?? []) {
    const r = row as Record<string, unknown>;
    const meterNo = asStr(r.meterNo);
    if (!meterNo) continue;
    rows.push({ meterNo, address: asStr(r.address) });
  }
  return { rows };
}

export type WtlMeterAreaRowDto = {
  meterNo: string;
  address: string;
  point: [number, number] | null;
};

/**
 * 읍면동·리·급수블록 경계(5181)와 교차하는 급수전계량기 목록.
 * 리 > 읍면동 우선, 급수블록은 AND.
 */
export async function listMetersByArea(params: {
  emdCode?: string | null;
  riCode?: string | null;
  block?: string | null;
  limit?: number | null;
}): Promise<{ rows: WtlMeterAreaRowDto[]; error?: string }> {
  const emdCode = String(params.emdCode ?? '').trim();
  const riCode = String(params.riCode ?? '').trim();
  const block = String(params.block ?? '').trim();
  if (!emdCode && !riCode && !block) {
    return { rows: [], error: '읍면동·리·급수블록 중 하나 이상 선택하세요.' };
  }
  if (!(await tableExists('layer', 'wtl_meta_ps'))) {
    return { rows: [], error: '급수전계량기 테이블이 없습니다.' };
  }

  const wkts: string[] = [];
  if (riCode) {
    const geo = await getRiGeometry({ riCode });
    const w = asStr(geo.wkt);
    if (!w) return { rows: [], error: geo.error || '리 경계를 찾지 못했습니다.' };
    wkts.push(w);
  } else if (emdCode) {
    const geo = await getEmdGeometry({ emdCode });
    const w = asStr(geo.wkt);
    if (!w) return { rows: [], error: geo.error || '읍면동 경계를 찾지 못했습니다.' };
    wkts.push(w);
  }
  if (block) {
    const geo = await getWtlSupplyBlockGeometry({ block });
    const w = asStr(geo.wkt);
    if (!w) return { rows: [], error: geo.error || '급수블록 경계를 찾지 못했습니다.' };
    wkts.push(w);
  }
  if (wkts.length === 0) return { rows: [] };

  const lim = Math.min(5000, Math.max(1, Number(params.limit) || 3000));
  const spatial = wkts
    .map(
      (w) =>
        `ST_Intersects(ST_Transform(t.geom, 5181), ST_GeomFromText('${esc(w)}', 5181))`
    )
    .join(' AND ');

  const res = await db.execute(
    sql.raw(
      `SELECT DISTINCT ON (trim(t.met_num))
         trim(t.met_num) AS "meterNo",
         COALESCE(NULLIF(trim(t.hom_adr),''), '') AS address,
         ST_AsGeoJSON(ST_Transform(ST_Centroid(t.geom), 4326))::json AS geom
       FROM layer.wtl_meta_ps t
       WHERE t.geom IS NOT NULL
         AND NULLIF(trim(t.met_num),'') IS NOT NULL
         AND (${spatial})
       ORDER BY trim(t.met_num), t.ogc_fid
       LIMIT ${lim}`
    )
  );

  const rows: WtlMeterAreaRowDto[] = [];
  for (const row of res.rows ?? []) {
    const r = row as Record<string, unknown>;
    const meterNo = asStr(r.meterNo);
    if (!meterNo) continue;
    rows.push({
      meterNo,
      address: asStr(r.address),
      point: parseLonLat(r.geom),
    });
  }
  return { rows };
}

export type WtlJijukParcelResolveDto = {
  index: number;
  pnu: string | null;
  geometry4326: Record<string, unknown> | null;
};

/**
 * 계량기 좌표(4326) 목록 → public_layer.jijuk 교차 필지(고유 PNU·도형) 일괄 조회.
 * 클라이언트 N회 getParcelHighlightGeom 대신 청크 단위 1쿼리.
 */
export async function resolveJijukParcelsByLonLat(params: {
  points?: Array<{ lon?: number; lat?: number } | null> | null;
}): Promise<{ rows: WtlJijukParcelResolveDto[] }> {
  const raw = params.points ?? [];
  const pts: Array<{ index: number; lon: number; lat: number }> = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const lon = Number(p?.lon);
    const lat = Number(p?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    pts.push({ index: i, lon, lat });
  }
  if (pts.length === 0) return { rows: [] };

  const jijukExists = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public_layer' AND lower(table_name) = 'jijuk'
       LIMIT 1`
    )
  );
  if ((jijukExists.rows?.length ?? 0) === 0) {
    return {
      rows: pts.map((p) => ({ index: p.index, pnu: null, geometry4326: null })),
    };
  }

  const valuesSql = pts
    .map((p) => `(${p.index}::int, ${p.lon}::float8, ${p.lat}::float8)`)
    .join(',');
  const jijukGeom5181 = `ST_SetSRID(j.geom, COALESCE(NULLIF(ST_SRID(j.geom), 0), 5181))`;

  try {
    const res = await db.execute(
      sql.raw(
        `WITH pts(idx, lon, lat) AS (VALUES ${valuesSql})
         SELECT pts.idx AS "index",
           NULLIF(trim(j.pnu::text), '') AS pnu,
           CASE WHEN j.geom IS NULL THEN NULL
             ELSE ST_AsGeoJSON(ST_Transform(${jijukGeom5181}, 4326))::json
           END AS geom
         FROM pts
         LEFT JOIN LATERAL (
           SELECT j.pnu, j.geom
           FROM public_layer.jijuk j
           WHERE j.geom IS NOT NULL
             AND ST_Intersects(
               ${jijukGeom5181},
               ST_Transform(ST_SetSRID(ST_MakePoint(pts.lon, pts.lat), 4326), 5181)
             )
           LIMIT 1
         ) j ON true`
      )
    );

    const byIndex = new Map<number, WtlJijukParcelResolveDto>();
    for (const row of res.rows ?? []) {
      const r = row as Record<string, unknown>;
      const index = Number(r.index);
      if (!Number.isFinite(index)) continue;
      const pnuRaw = asStr(r.pnu).replace(/\D/g, '').slice(0, 19);
      const geom = r.geom;
      const geometry4326 =
        geom && typeof geom === 'object' && 'type' in (geom as object)
          ? (geom as Record<string, unknown>)
          : null;
      byIndex.set(index, {
        index,
        pnu: pnuRaw || null,
        geometry4326,
      });
    }

    return {
      rows: pts.map(
        (p) =>
          byIndex.get(p.index) ?? {
            index: p.index,
            pnu: null,
            geometry4326: null,
          }
      ),
    };
  } catch {
    return {
      rows: pts.map((p) => ({ index: p.index, pnu: null, geometry4326: null })),
    };
  }
}
