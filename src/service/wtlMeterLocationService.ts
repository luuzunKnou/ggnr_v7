/**
 * 계량기위치 — 계량기번호(met_num)로 위치 조회
 */
import { sql } from 'drizzle-orm';
import db from '@/database/db';

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
