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

/**
 * 영역과 교차하는 도형만 남기고, 교집합으로 자른 geom 으로 교체.
 * (큰 면이 영역과 조금만 겹쳐도 전체로 그려지던 문제 방지)
 */
async function clipFeatureGeomsToAreaWkt<T extends { geom: { type: string; coordinates?: unknown } }>(
  features: T[],
  wkt: string
): Promise<T[]> {
  if (features.length === 0) return features;

  const CHUNK = 80;
  const clippedByIdx = new Map<number, { type: string; coordinates?: unknown }>();

  for (let start = 0; start < features.length; start += CHUNK) {
    const slice = features.slice(start, start + CHUNK);
    const values = slice
      .map((f, j) => {
        const i = start + j;
        try {
          const gj = JSON.stringify(f.geom).replace(/'/g, "''");
          return `(${i}, '${gj}'::json)`;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (values.length === 0) continue;

    const q = `
      WITH raw AS (
        SELECT
          v.idx,
          ST_Intersection(
            ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(v.gj::text), 5181)),
            ST_MakeValid(ST_GeomFromText('${esc(wkt)}', 5181))
          ) AS g
        FROM (VALUES ${values.join(',')}) AS v(idx, gj)
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

    try {
      const res = await db.execute(sql.raw(q));
      for (const row of res.rows as { idx?: number; clipped_gj?: string | null }[]) {
        const idx = Number(row.idx);
        if (!Number.isFinite(idx)) continue;
        const g = parseGeoJson(row.clipped_gj);
        if (g?.type && g.coordinates != null) clippedByIdx.set(idx, g);
      }
    } catch {
      // 청크 실패 시 해당 구간은 교차만 통과(자르기 실패 폴백)
      try {
        const q2 = `
          SELECT v.idx
          FROM (VALUES ${values.join(',')}) AS v(idx, gj)
          WHERE ST_Intersects(
            ST_SetSRID(ST_GeomFromGeoJSON(v.gj::text), 5181),
            ST_GeomFromText('${esc(wkt)}', 5181)
          )
        `;
        const res2 = await db.execute(sql.raw(q2));
        for (const row of res2.rows as { idx?: number }[]) {
          const idx = Number(row.idx);
          if (!Number.isFinite(idx) || !features[idx]) continue;
          clippedByIdx.set(idx, features[idx].geom);
        }
      } catch {
        /* 폴백도 실패하면 이 청크는 스킵 */
      }
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

async function loadShpRows(
  tableNames: string[],
  asOfDate: string | null,
  wkt: string | null,
  dateMode: 'asOf' | 'day' = 'asOf'
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
      (SELECT ST_AsGeoJSON(g.slg_geom)
         FROM sync_log_geom g
        WHERE g.slg_sl_key = sl.sl_key AND g.slg_side = 'new' AND g.slg_geom IS NOT NULL
        LIMIT 1) AS new_gj,
      (SELECT ST_AsGeoJSON(g.slg_geom)
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
  const res = await db.execute(sql.raw(q));
  return (res.rows as SyncRow[]) ?? [];
}

async function loadExcelRows(
  tableNames: string[],
  asOfDate: string | null,
  wkt: string | null,
  dateMode: 'asOf' | 'day' = 'asOf'
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
      (SELECT ST_AsGeoJSON(g.eslg_geom)
         FROM excel_sync_log_geom g
        WHERE g.eslg_esl_key = esl.esl_key AND g.eslg_side = 'new' AND g.eslg_geom IS NOT NULL
        LIMIT 1) AS new_gj,
      (SELECT ST_AsGeoJSON(g.eslg_geom)
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

/**
 * 영역·선택 레이어 기준 타임라인(도형일).
 * 정사일은 클라 목업/추후 연동 — 여기서는 shape만.
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

  const [shp, excel] = await Promise.all([
    loadShpRows(tableNames, null, wkt),
    loadExcelRows(tableNames, null, wkt),
  ]);
  const rows = [...shp, ...excel];

  const byDate = new Map<string, SyncRow[]>();
  for (const row of rows) {
    // kept·Multi/CRS 표기만 노이즈 제외 — 추가·삭제·표속성·도형종류·좌표 변경 포함
    if (!isVisibleTimelineChange(row)) continue;
    const d = dateKey(row.applied_at);
    if (!d) continue;
    const list = byDate.get(d) ?? [];
    list.push(row);
    byDate.set(d, list);
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

  // as-of는 영역 밖 이력도 반영해야 시점이 맞음 → 로그는 전체 로드 후 geom만 영역으로 자름
  const [shp, excel] = await Promise.all([
    loadShpRows(tableNames, selectedDate, null),
    loadExcelRows(tableNames, selectedDate, null),
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
  const [shp, excel] = await Promise.all([
    loadShpRows(tableNames, selectedDate, null, 'day'),
    loadExcelRows(tableNames, selectedDate, null, 'day'),
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
