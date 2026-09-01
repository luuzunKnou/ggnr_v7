/**
 * 변동이력분석 — sync_log / excel_sync_log 본체 조회 (회차 테이블 미사용)
 * - 타임라인·전후 비교: append/remove + conflict(표 속성·도형 종류·좌표 변경)
 *   (kept·Multi 단일 포장만·CRS 표기만 다른 conflict는 숨김)
 * - 시점 도형: 선택일까지 append/conflict/kept 반영 후 remove 제거 + sync_log_geom
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';

export type ChangeHistoryTimelineEvent = {
  date: string;
  changeCount: number;
  kind: 'shape';
  layers: string[];
  tableNames: string[];
  orthoYear: number;
  hasShp: true;
  source: 'syncLog';
};

export type ChangeHistoryAsOfFeature = {
  tableName: string;
  keyField: string;
  keyValue: string;
  geom: { type: string; coordinates?: unknown };
  lastOp: 'append' | 'remove' | 'conflict' | 'kept';
  lastAt: string;
};

/** 선택일 당일 변경분 — 전(old)·후(new) 도형 겹침용 */
export type ChangeHistoryDayDiffFeature = {
  tableName: string;
  keyField: string;
  keyValue: string;
  op: 'append' | 'remove' | 'conflict' | 'kept';
  side: 'old' | 'new';
  geom: { type: string; coordinates?: unknown };
  appliedAt: string;
};

type SyncRow = {
  log_key: number;
  table_name: string;
  key_field: string;
  key_value: string;
  operation: string;
  applied_at: string;
  new_gj: string | Record<string, unknown> | null;
  old_gj: string | Record<string, unknown> | null;
  old_data?: unknown;
  new_data?: unknown;
};

const ATTR_SKIP_KEYS = new Set([
  'geom',
  'geometry',
  'the_geom',
  'wkb_geometry',
  'shape',
  'gid',
]);

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function dateKey(isoOrDate: string): string {
  return String(isoOrDate ?? '').slice(0, 10);
}

function sanitizeTableNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const t = String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '');
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  // 표시 레이어 전부 조회(임의 개수 상한 없음) — 느리면 로딩으로 대기
  return out;
}

function sanitizeWkt(raw: unknown): string | null {
  const w = String(raw ?? '').trim();
  if (!w) return null;
  if (w.length > 200_000) return null;
  if (!/^(MULTI)?POLYGON\s*\(/i.test(w) && !/^GEOMETRYCOLLECTION/i.test(w)) {
    // 원·사각형도 WKT로 올 수 있음 — POLYGON/MULTIPOLYGON 외 허용하되 따옴표 차단
    if (/[;'"]|--/.test(w)) return null;
  }
  if (/[;'"]|--/.test(w)) return null;
  return w;
}

/** 사업 시군 읍면 합집합 — 관할 밖은 그리지 않음 */
const PROJECT_EMD_SCHEMA = 'public_layer';
let projectEmdUnionSqlCache: string | null | undefined;

async function getProjectEmdUnionSql(): Promise<string | null> {
  if (projectEmdUnionSqlCache !== undefined) return projectEmdUnionSqlCache;
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, srid FROM geometry_columns
         WHERE f_table_schema = '${PROJECT_EMD_SCHEMA}' AND f_table_name = 'emd' LIMIT 1`
      )
    );
    const gc = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
    if (!gc?.name) {
      projectEmdUnionSqlCache = null;
      return null;
    }
    const col = `"${String(gc.name).replace(/"/g, '""')}"`;
    const srid = Number(gc.srid);
    const safeSrid = Number.isFinite(srid) && srid > 0 ? srid : 5181;
    const unionExpr =
      safeSrid === 5181
        ? `ST_MakeValid(ST_Union(${col}))`
        : `ST_MakeValid(ST_Transform(ST_SetSRID(ST_Union(${col}), ${safeSrid}), 5181))`;
    projectEmdUnionSqlCache = `(SELECT ${unionExpr} FROM "${PROJECT_EMD_SCHEMA}"."emd")`;
    return projectEmdUnionSqlCache;
  } catch {
    projectEmdUnionSqlCache = null;
    return null;
  }
}

function parseGeoJson(gj: unknown): { type: string; coordinates?: unknown } | null {
  if (gj == null) return null;
  if (typeof gj === 'object' && !Array.isArray(gj)) {
    const o = gj as { type?: string; coordinates?: unknown };
    if (!o?.type) return null;
    return { type: String(o.type), coordinates: o.coordinates };
  }
  if (typeof gj !== 'string' || !gj.trim()) return null;
  try {
    const o = JSON.parse(gj) as { type?: string; coordinates?: unknown };
    if (!o?.type) return null;
    return { type: String(o.type), coordinates: o.coordinates };
  } catch {
    return null;
  }
}

function geomAsSqlValue(idx: number, geom: { type: string; coordinates?: unknown }): string | null {
  try {
    const gj = JSON.stringify(geom).replace(/'/g, "''");
    return `(${idx}, '${gj}'::json)`;
  } catch {
    return null;
  }
}

/** 영역 상자로 1차 자른 뒤 영역과 교집합. 실패 행은 결과에 없음(원본 전체 유지 금지). */
function clipIntersectSql(valuesSql: string, wkt: string): string {
  const area = `ST_MakeValid(ST_GeomFromText('${esc(wkt)}', 5181))`;
  return `
    WITH raw AS (
      SELECT
        v.idx,
        ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(v.gj::text), 5181)) AS fg,
        ${area} AS ag
      FROM (VALUES ${valuesSql}) AS v(idx, gj)
    ),
    boxed AS (
      SELECT
        idx,
        ST_ClipByBox2D(fg, ST_Envelope(ag)) AS boxg,
        ag
      FROM raw
    ),
    cut AS (
      SELECT
        idx,
        CASE
          WHEN boxg IS NULL OR ST_IsEmpty(boxg) THEN NULL
          ELSE ST_Intersection(ST_MakeValid(boxg), ag)
        END AS g
      FROM boxed
    ),
    pick AS (
      SELECT
        idx,
        CASE
          WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL
          WHEN GeometryType(g) LIKE 'GEOMETRYCOLLECTION%' THEN
            CASE
              WHEN NOT ST_IsEmpty(ST_CollectionExtract(g, 3)) THEN ST_CollectionExtract(g, 3)
              WHEN NOT ST_IsEmpty(ST_CollectionExtract(g, 2)) THEN ST_CollectionExtract(g, 2)
              WHEN NOT ST_IsEmpty(ST_CollectionExtract(g, 1)) THEN ST_CollectionExtract(g, 1)
              ELSE NULL
            END
          ELSE g
        END AS g2
      FROM cut
    )
    SELECT idx, ST_AsGeoJSON(g2) AS clipped_gj
    FROM pick
    WHERE g2 IS NOT NULL AND NOT ST_IsEmpty(g2)
  `;
}

/**
 * 영역과 교차하는 도형만 남기고, 교집합으로 자른 geom 으로 교체.
 * 자르기 실패 시 원본 전체를 쓰지 않는다(영역 밖 표시 방지).
 */
async function clipFeatureGeomsToAreaWkt<T extends { geom: { type: string; coordinates?: unknown } }>(
  features: T[],
  wkt: string
): Promise<T[]> {
  if (features.length === 0) return features;

  const CHUNK = 80;
  const clippedByIdx = new Map<number, { type: string; coordinates?: unknown }>();

  const applyRows = (rows: { idx?: number; clipped_gj?: string | null }[]) => {
    for (const row of rows) {
      const idx = Number(row.idx);
      if (!Number.isFinite(idx)) continue;
      const g = parseGeoJson(row.clipped_gj);
      if (g?.type && g.coordinates != null) clippedByIdx.set(idx, g);
    }
  };

  const runClip = async (values: string[]): Promise<boolean> => {
    if (values.length === 0) return true;
    const joined = values.join(', ');
    try {
      const res = await db.execute(sql.raw(clipIntersectSql(joined, wkt)));
      applyRows((res.rows as { idx?: number; clipped_gj?: string | null }[]) ?? []);
      return true;
    } catch {
      // ClipByBox2D 미지원·오류 시 교집합만. 원본 전체는 쓰지 않음.
      try {
        const area = `ST_MakeValid(ST_GeomFromText('${esc(wkt)}', 5181))`;
        const q = `
          WITH raw AS (
            SELECT
              v.idx,
              ST_Intersection(
                ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(v.gj::text), 5181)),
                ${area}
              ) AS g
            FROM (VALUES ${joined}) AS v(idx, gj)
          ),
          pick AS (
            SELECT
              idx,
              CASE
                WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL
                WHEN GeometryType(g) LIKE 'GEOMETRYCOLLECTION%' THEN
                  CASE
                    WHEN NOT ST_IsEmpty(ST_CollectionExtract(g, 3)) THEN ST_CollectionExtract(g, 3)
                    WHEN NOT ST_IsEmpty(ST_CollectionExtract(g, 2)) THEN ST_CollectionExtract(g, 2)
                    WHEN NOT ST_IsEmpty(ST_CollectionExtract(g, 1)) THEN ST_CollectionExtract(g, 1)
                    ELSE NULL
                  END
                ELSE g
              END AS g2
            FROM raw
          )
          SELECT idx, ST_AsGeoJSON(g2) AS clipped_gj
          FROM pick
          WHERE g2 IS NOT NULL AND NOT ST_IsEmpty(g2)
        `;
        const res = await db.execute(sql.raw(q));
        applyRows((res.rows as { idx?: number; clipped_gj?: string | null }[]) ?? []);
        return true;
      } catch {
        return false;
      }
    }
  };

  for (let start = 0; start < features.length; start += CHUNK) {
    const slice = features.slice(start, start + CHUNK);
    const values = slice
      .map((f, j) => geomAsSqlValue(start + j, f.geom))
      .filter((v): v is string => Boolean(v));
    if (values.length === 0) continue;

    const ok = await runClip(values);
    if (ok) continue;

    // 청크 실패 → 건별 재시도. 그래도 실패하면 해당 도형은 제외(원본 전체 금지).
    for (const one of values) {
      await runClip([one]);
    }
  }

  const out: T[] = [];
  for (let i = 0; i < features.length; i++) {
    const g = clippedByIdx.get(i);
    if (!g) continue;
    out.push({ ...features[i], geom: g });
  }
  return out;
}

function asAttrRecord(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function stableJson(v: unknown): string {
  try {
    return JSON.stringify(v ?? null);
  } catch {
    return String(v);
  }
}

/** 표 필드(geom 제외) 값이 하나라도 다르면 true */
function hasAttributeChange(row: SyncRow): boolean {
  const oldD = asAttrRecord(row.old_data);
  const newD = asAttrRecord(row.new_data);
  const keys = new Set([...Object.keys(oldD), ...Object.keys(newD)]);
  for (const k of keys) {
    if (ATTR_SKIP_KEYS.has(k.toLowerCase())) continue;
    if (stableJson(oldD[k]) !== stableJson(newD[k])) return true;
  }
  return false;
}

/**
 * 도형 파싱 — sync_log_geom(ST_AsGeoJSON) 우선, 없으면 old/new_data 의 geom 필드.
 */
function pickSideGeom(
  row: SyncRow,
  side: 'old' | 'new'
): { type: string; coordinates?: unknown } | null {
  const fromCol = side === 'old' ? row.old_gj : row.new_gj;
  let g = parseGeoJson(fromCol);
  if (!g?.type) {
    const data = asAttrRecord(side === 'old' ? row.old_data : row.new_data);
    for (const k of ['geom', 'geometry', 'the_geom', 'wkb_geometry', 'shape']) {
      if (data[k] == null) continue;
      g = parseGeoJson(data[k]);
      if (g?.type) break;
    }
  }
  if (!g?.type || g.coordinates == null) return null;
  return g;
}

/** Multi 단일 요소는 기본형으로 펼쳐 CRS·포장 노이즈 완화 */
function canonicalizeGeom(g: { type: string; coordinates?: unknown }): {
  type: string;
  coordinates: unknown;
} {
  const type = g.type;
  const coords = g.coordinates;
  if (!Array.isArray(coords)) return { type, coordinates: coords };
  if (type === 'MultiPoint' && coords.length === 1) {
    return { type: 'Point', coordinates: coords[0] };
  }
  if (type === 'MultiLineString' && coords.length === 1) {
    return { type: 'LineString', coordinates: coords[0] };
  }
  if (type === 'MultiPolygon' && coords.length === 1) {
    return { type: 'Polygon', coordinates: coords[0] };
  }
  return { type, coordinates: coords };
}

function geomFingerprint(g: { type: string; coordinates?: unknown }): string {
  const c = canonicalizeGeom(g);
  return stableJson({ type: c.type, coordinates: c.coordinates });
}

/**
 * 도형 종류·좌표가 바뀌면 true (면↔점·선 포함 — 지도에 모양이 다름).
 * 노이즈(제외): Multi 단일 포장만, CRS 표기만 (canonicalize 후 동일).
 */
function hasGeomChange(row: SyncRow): boolean {
  const oldG = pickSideGeom(row, 'old');
  const newG = pickSideGeom(row, 'new');
  if (oldG == null && newG == null) return false;
  if (oldG == null || newG == null) return true;
  return geomFingerprint(oldG) !== geomFingerprint(newG);
}

/** 타임라인·당일 전후 — conflict 는 표 속성 또는 도형(종류·좌표) 변경 */
function isVisibleTimelineChange(row: SyncRow): boolean {
  const op = String(row.operation ?? '').toLowerCase();
  if (op === 'append' || op === 'remove') return true;
  if (op === 'conflict') return hasAttributeChange(row) || hasGeomChange(row);
  return false;
}

function tableInListSql(column: string, tables: string[]): string {
  if (tables.length === 0) return 'FALSE';
  return `lower(${column}) IN (${tables.map((t) => `'${esc(t)}'`).join(',')})`;
}

function areaIntersectsSql(geomExpr: string, wkt: string | null): string {
  if (!wkt) return 'TRUE';
  return `ST_Intersects(${geomExpr}, ST_GeomFromText('${esc(wkt)}', 5181))`;
}

/** 영역·시군과 겹친 부분만 GeoJSON. 원본 면을 그대로 내보내면 관할 밖으로 그려짐. */
function stAsGeoJsonClippedSql(
  geomExpr: string,
  clipWkt: string | null,
  cityUnionSql: string | null
): string {
  const areaSql = clipWkt
    ? `ST_MakeValid(ST_GeomFromText('${esc(clipWkt)}', 5181))`
    : null;
  const citySql = cityUnionSql ? `ST_MakeValid(${cityUnionSql})` : null;
  const clipParts = [areaSql, citySql].filter(Boolean) as string[];
  if (clipParts.length === 0) return `ST_AsGeoJSON(${geomExpr})`;
  const clip = clipParts.length === 1 ? clipParts[0] : `ST_Intersection(${clipParts[0]}, ${clipParts[1]})`;
  const g = `ST_MakeValid(${geomExpr})`;
  return `ST_AsGeoJSON((
    SELECT CASE
      WHEN ix IS NULL OR ST_IsEmpty(ix) THEN NULL
      WHEN GeometryType(ix) LIKE 'GEOMETRYCOLLECTION%' THEN
        CASE
          WHEN NOT ST_IsEmpty(ST_CollectionExtract(ix, 3)) THEN ST_CollectionExtract(ix, 3)
          WHEN NOT ST_IsEmpty(ST_CollectionExtract(ix, 2)) THEN ST_CollectionExtract(ix, 2)
          WHEN NOT ST_IsEmpty(ST_CollectionExtract(ix, 1)) THEN ST_CollectionExtract(ix, 1)
          ELSE NULL
        END
      ELSE ix
    END
    FROM (
      SELECT ST_Intersection(
        ST_MakeValid(ST_ClipByBox2D(${g}, ST_Envelope(${clip}))),
        ${clip}
      ) AS ix
    ) _c
  ))`;
}

async function loadShpRows(
  tableNames: string[],
  asOfDate: string | null,
  wkt: string | null,
  dateMode: 'asOf' | 'day' = 'asOf',
  clipWkt: string | null = null,
  cityUnionSql: string | null = null
): Promise<SyncRow[]> {
  if (tableNames.length === 0) return [];
  const dateFilter = asOfDate
    ? dateMode === 'day'
      ? `AND (sl.sl_applied_at::date) = '${esc(dateKey(asOfDate))}'::date`
      : `AND (sl.sl_applied_at::date) <= '${esc(dateKey(asOfDate))}'::date`
    : '';
  const areaFilter = wkt
    ? `AND EXISTS (
         SELECT 1 FROM sync_log_geom gx
         WHERE gx.slg_sl_key = sl.sl_key
           AND gx.slg_geom IS NOT NULL
           AND ${areaIntersectsSql('gx.slg_geom', wkt)}
       )`
    : '';
  const newGj = stAsGeoJsonClippedSql('g.slg_geom', clipWkt, cityUnionSql);
  const oldGj = stAsGeoJsonClippedSql('g.slg_geom', clipWkt, cityUnionSql);
  const q = `
    SELECT
      sl.sl_key AS log_key,
      sl.sl_table_name AS table_name,
      sl.sl_key_field AS key_field,
      sl.sl_key_value AS key_value,
      sl.sl_operation AS operation,
      sl.sl_applied_at::text AS applied_at,
      sl.sl_old_data AS old_data,
      sl.sl_new_data AS new_data,
      (SELECT ${newGj}
         FROM sync_log_geom g
        WHERE g.slg_sl_key = sl.sl_key AND g.slg_side = 'new' AND g.slg_geom IS NOT NULL
        LIMIT 1) AS new_gj,
      (SELECT ${oldGj}
         FROM sync_log_geom g
        WHERE g.slg_sl_key = sl.sl_key AND g.slg_side = 'old' AND g.slg_geom IS NOT NULL
        LIMIT 1) AS old_gj
    FROM sync_log sl
    WHERE ${tableInListSql('sl.sl_table_name', tableNames)}
      AND sl.sl_operation IS NOT NULL
      AND COALESCE(sl.sl_rolled_back, false) = false
      AND sl.sl_applied_at IS NOT NULL
      ${dateFilter}
      ${areaFilter}
    ORDER BY sl.sl_applied_at ASC, sl.sl_key ASC
  `;
  try {
    const res = await db.execute(sql.raw(q));
    return (res.rows as SyncRow[]) ?? [];
  } catch {
    // 자르기·시군 합집합 SQL 실패 시 단계적으로 완화
    if (clipWkt && cityUnionSql) {
      return loadShpRows(tableNames, asOfDate, wkt, dateMode, clipWkt, null);
    }
    if (clipWkt) {
      return loadShpRows(tableNames, asOfDate, wkt, dateMode, null, cityUnionSql);
    }
    if (cityUnionSql) {
      return loadShpRows(tableNames, asOfDate, wkt, dateMode, null, null);
    }
    throw new Error('sync_log 조회 실패');
  }
}

async function loadExcelRows(
  tableNames: string[],
  asOfDate: string | null,
  wkt: string | null,
  dateMode: 'asOf' | 'day' = 'asOf',
  clipWkt: string | null = null,
  cityUnionSql: string | null = null
): Promise<SyncRow[]> {
  if (tableNames.length === 0) return [];
  const dateFilter = asOfDate
    ? dateMode === 'day'
      ? `AND (esl.esl_applied_at::date) = '${esc(dateKey(asOfDate))}'::date`
      : `AND (esl.esl_applied_at::date) <= '${esc(dateKey(asOfDate))}'::date`
    : '';
  const areaFilter = wkt
    ? `AND EXISTS (
         SELECT 1 FROM excel_sync_log_geom gx
         WHERE gx.eslg_esl_key = esl.esl_key
           AND gx.eslg_geom IS NOT NULL
           AND ${areaIntersectsSql('gx.eslg_geom', wkt)}
       )`
    : '';
  const newGj = stAsGeoJsonClippedSql('g.eslg_geom', clipWkt, cityUnionSql);
  const oldGj = stAsGeoJsonClippedSql('g.eslg_geom', clipWkt, cityUnionSql);
  const q = `
    SELECT
      esl.esl_key AS log_key,
      esl.esl_table_name AS table_name,
      esl.esl_key_field AS key_field,
      esl.esl_key_value AS key_value,
      esl.esl_operation AS operation,
      esl.esl_applied_at::text AS applied_at,
      esl.esl_old_data AS old_data,
      esl.esl_new_data AS new_data,
      (SELECT ${newGj}
         FROM excel_sync_log_geom g
        WHERE g.eslg_esl_key = esl.esl_key AND g.eslg_side = 'new' AND g.eslg_geom IS NOT NULL
        LIMIT 1) AS new_gj,
      (SELECT ${oldGj}
         FROM excel_sync_log_geom g
        WHERE g.eslg_esl_key = esl.esl_key AND g.eslg_side = 'old' AND g.eslg_geom IS NOT NULL
        LIMIT 1) AS old_gj
    FROM excel_sync_log esl
    WHERE ${tableInListSql('esl.esl_table_name', tableNames)}
      AND esl.esl_operation IS NOT NULL
      AND COALESCE(esl.esl_rolled_back, false) = false
      AND esl.esl_applied_at IS NOT NULL
      ${dateFilter}
      ${areaFilter}
    ORDER BY esl.esl_applied_at ASC, esl.esl_key ASC
  `;
  try {
    const res = await db.execute(sql.raw(q));
    return (res.rows as SyncRow[]) ?? [];
  } catch {
    if (clipWkt && cityUnionSql) {
      return loadExcelRows(tableNames, asOfDate, wkt, dateMode, clipWkt, null);
    }
    if (clipWkt) {
      return loadExcelRows(tableNames, asOfDate, wkt, dateMode, null, cityUnionSql);
    }
    if (cityUnionSql) {
      return loadExcelRows(tableNames, asOfDate, wkt, dateMode, null, null);
    }
    return [];
  }
}

function resolveAsOfFromRows(rows: SyncRow[]): ChangeHistoryAsOfFeature[] {
  const map = new Map<string, ChangeHistoryAsOfFeature>();
  for (const row of rows) {
    const op = String(row.operation ?? '').toLowerCase();
    if (!op) continue;
    const table = String(row.table_name ?? '');
    const key = String(row.key_value ?? '');
    if (!table || !key) continue;
    const mapKey = `${table}::${key}`;
    const at = String(row.applied_at ?? '');

    if (op === 'remove') {
      map.delete(mapKey);
      continue;
    }
    if (op !== 'append' && op !== 'conflict' && op !== 'kept') continue;

    const geom = parseGeoJson(row.new_gj) ?? parseGeoJson(row.old_gj);
    if (!geom?.type) continue;

    map.set(mapKey, {
      tableName: table,
      keyField: String(row.key_field ?? ''),
      keyValue: key,
      geom,
      lastOp: op,
      lastAt: at,
    });
  }
  return [...map.values()];
}

/** 당일 변경을 지도에 그릴 도형이 있는지 — dayDiff와 동일 기준. */
function rowHasDrawableClippedGeom(row: SyncRow): boolean {
  const op = String(row.operation ?? '').toLowerCase();
  if (op === 'append' || op === 'conflict') {
    const newGeom = parseGeoJson(row.new_gj) ?? (op === 'append' ? parseGeoJson(row.old_gj) : null);
    if (newGeom?.type) return true;
  }
  if (op === 'remove' || op === 'conflict') {
    if (parseGeoJson(row.old_gj)?.type) return true;
  }
  return false;
}

/** 타임라인용 — 행에서 그릴 후보 도형(자르기 전) 추출 */
function collectTimelineDrawableGeoms(
  row: SyncRow
): { geom: { type: string; coordinates?: unknown } }[] {
  const op = String(row.operation ?? '').toLowerCase();
  const out: { geom: { type: string; coordinates?: unknown } }[] = [];
  if (op === 'append' || op === 'conflict') {
    const newGeom = parseGeoJson(row.new_gj) ?? (op === 'append' ? parseGeoJson(row.old_gj) : null);
    if (newGeom?.type) out.push({ geom: newGeom });
  }
  if (op === 'remove' || op === 'conflict') {
    const oldGeom = parseGeoJson(row.old_gj);
    if (oldGeom?.type) out.push({ geom: oldGeom });
  }
  return out;
}

/**
 * 영역·선택 레이어 기준 타임라인(도형일).
 * 정사일은 클라 목업/추후 연동 — 여기서는 shape만.
 * 영역과 교차하는 로그를 가져온 뒤, 자른 도형이 남는 날만 넣는다.
 * (행마다 시군 합집합 자르기 SQL을 걸면 타임라인 전체 조회가 실패·타임아웃하기 쉬움)
 */
export async function listTimeline(params?: {
  tableNames?: string[];
  wkt?: string | null;
}) {
  const tableNames = sanitizeTableNames(params?.tableNames);
  const wkt = sanitizeWkt(params?.wkt);
  if (tableNames.length === 0) {
    return { events: [] as ChangeHistoryTimelineEvent[] };
  }

  // 영역 교차만 — 시점/당일 조회와 달리 전 기간 + 행별 시군 clip SQL 금지
  const [shp, excel] = await Promise.all([
    loadShpRows(tableNames, null, wkt),
    loadExcelRows(tableNames, null, wkt),
  ]);
  const rows = [...shp, ...excel];

  type DatedRow = { date: string; row: SyncRow };
  const visible: DatedRow[] = [];
  for (const row of rows) {
    if (!isVisibleTimelineChange(row)) continue;
    if (!rowHasDrawableClippedGeom(row)) continue;
    const d = dateKey(row.applied_at);
    if (!d) continue;
    visible.push({ date: d, row });
  }

  let keepDates: Set<string> | null = null;
  if (wkt && visible.length > 0) {
    const tagged: { date: string; geom: { type: string; coordinates?: unknown } }[] = [];
    for (const { date, row } of visible) {
      for (const g of collectTimelineDrawableGeoms(row)) {
        tagged.push({ date, geom: g.geom });
      }
    }
    if (tagged.length > 0) {
      const clipped = await clipFeatureGeomsToAreaWkt(tagged, wkt);
      keepDates = new Set(clipped.map((c) => c.date));
    } else {
      keepDates = new Set();
    }
  }

  const byDate = new Map<string, SyncRow[]>();
  for (const { date, row } of visible) {
    if (keepDates && !keepDates.has(date)) continue;
    const list = byDate.get(date) ?? [];
    list.push(row);
    byDate.set(date, list);
  }

  const events: ChangeHistoryTimelineEvent[] = [];
  for (const [date, dayRows] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const tables = [...new Set(dayRows.map((r) => String(r.table_name)))];
    events.push({
      date,
      changeCount: dayRows.length,
      kind: 'shape',
      layers: tables,
      tableNames: tables,
      orthoYear: Number(date.slice(0, 4)) || new Date().getFullYear(),
      hasShp: true,
      source: 'syncLog',
    });
  }
  return { events };
}

/** 선택일(포함) 기준 유효 시설 + geom */
export async function featuresAsOf(params?: {
  selectedDate?: string;
  tableNames?: string[];
  wkt?: string | null;
}) {
  const selectedDate = dateKey(String(params?.selectedDate ?? ''));
  const tableNames = sanitizeTableNames(params?.tableNames);
  const wkt = sanitizeWkt(params?.wkt);
  if (!selectedDate || tableNames.length === 0) {
    return { features: [] as ChangeHistoryAsOfFeature[] };
  }

  const cityUnionSql = await getProjectEmdUnionSql();
  // as-of는 영역 밖 이력도 반영해야 시점이 맞음. 그릴 도형만 분석영역∩시군으로 자름.
  const [shp, excel] = await Promise.all([
    loadShpRows(tableNames, selectedDate, null, 'asOf', wkt, cityUnionSql),
    loadExcelRows(tableNames, selectedDate, null, 'asOf', wkt, cityUnionSql),
  ]);
  let features = resolveAsOfFromRows([...shp, ...excel]);

  if (wkt && features.length > 0) {
    features = await clipFeatureGeomsToAreaWkt(features, wkt);
  }

  return { features };
}

/**
 * 선택일(그 날만) 변경 도형 — conflict는 old+new, append는 new, remove는 old.
 * 지도 전·후 겹침 표시용.
 */
export async function featuresDayDiff(params?: {
  selectedDate?: string;
  tableNames?: string[];
  wkt?: string | null;
}) {
  const selectedDate = dateKey(String(params?.selectedDate ?? ''));
  const tableNames = sanitizeTableNames(params?.tableNames);
  const wkt = sanitizeWkt(params?.wkt);
  if (!selectedDate || tableNames.length === 0) {
    return { features: [] as ChangeHistoryDayDiffFeature[] };
  }

  // 당일만 SQL(=)로 제한 — as-of(<=)나 전체(null)가 아님. JS 필터는 안전망.
  const cityUnionSql = await getProjectEmdUnionSql();
  const [shp, excel] = await Promise.all([
    loadShpRows(tableNames, selectedDate, null, 'day', wkt, cityUnionSql),
    loadExcelRows(tableNames, selectedDate, null, 'day', wkt, cityUnionSql),
  ]);
  const dayRows = [...shp, ...excel].filter((r) => dateKey(r.applied_at) === selectedDate);

  const features: ChangeHistoryDayDiffFeature[] = [];
  for (const row of dayRows) {
    if (!isVisibleTimelineChange(row)) continue;
    const op = String(row.operation ?? '').toLowerCase() as ChangeHistoryDayDiffFeature['op'];
    const table = String(row.table_name ?? '');
    const key = String(row.key_value ?? '');
    if (!table || !key) continue;
    const base = {
      tableName: table,
      keyField: String(row.key_field ?? ''),
      keyValue: key,
      op,
      appliedAt: String(row.applied_at ?? ''),
    };

    if (op === 'append' || op === 'conflict') {
      const newGeom = parseGeoJson(row.new_gj) ?? (op === 'append' ? parseGeoJson(row.old_gj) : null);
      if (newGeom?.type) {
        features.push({ ...base, side: 'new', geom: newGeom });
      }
    }
    if (op === 'remove' || op === 'conflict') {
      const oldGeom = parseGeoJson(row.old_gj);
      if (oldGeom?.type) {
        features.push({ ...base, side: 'old', geom: oldGeom });
      }
    }
  }

  if (wkt && features.length > 0) {
    return { features: await clipFeatureGeomsToAreaWkt(features, wkt) };
  }

  return { features };
}
