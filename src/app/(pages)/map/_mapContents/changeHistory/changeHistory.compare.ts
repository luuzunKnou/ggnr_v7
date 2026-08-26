/**
 * 선택일 기준 «변경 전» / «변경 후» **레이어 전체** 도형.
 * - 변경 후 = as-of(그날까지 반영된 최종)
 * - 변경 전 = as-of 에서 당일 append 제거 · remove/conflict(dayDiff에 있는 것만) 는 old 도형
 * - 당일이 최초 등록(추가)만이면 변경 전을 비움
 */
import type { ChangeHistoryAsOfFeature, ChangeHistoryDayDiffFeature } from './changeHistory.types';

export type CompareSide = 'before' | 'after';

export type ChangeHistoryCompareFeature = {
  tableName: string;
  keyField: string;
  keyValue: string;
  side: CompareSide;
  geom: { type: string; coordinates?: unknown };
};

const GEOM_TYPE_ALIAS: Record<string, string> = {
  point: 'Point',
  multipoint: 'MultiPoint',
  linestring: 'LineString',
  multilinestring: 'MultiLineString',
  polygon: 'Polygon',
  multipolygon: 'MultiPolygon',
};

/** API·DB에서 온 geom 을 OL이 읽을 수 있게 정규화 */
export function normalizeGeoJsonGeometry(
  raw: unknown
): { type: string; coordinates?: unknown } | null {
  if (raw == null) return null;
  let o: unknown = raw;
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof o !== 'object' || o === null) return null;
  const rec = o as Record<string, unknown>;
  if (rec.type === 'Feature') {
    return normalizeGeoJsonGeometry(rec.geometry);
  }
  if (rec.type === 'FeatureCollection' && Array.isArray(rec.features) && rec.features[0]) {
    return normalizeGeoJsonGeometry(rec.features[0]);
  }
  if (rec.geom != null && rec.type == null) {
    return normalizeGeoJsonGeometry(rec.geom);
  }
  const rawType = String(rec.type ?? '').trim();
  if (!rawType) return null;
  const type = GEOM_TYPE_ALIAS[rawType.toLowerCase()] ?? rawType;
  if (rec.coordinates == null) return null;
  return { type, coordinates: rec.coordinates };
}

function rowKey(tableName: string, keyValue: string): string {
  return `${tableName.toLowerCase()}::${keyValue}`;
}

function pickTableName(row: { tableName?: string; table_name?: string }): string {
  return String(row.tableName ?? row.table_name ?? '').trim();
}

export function buildCompareFeatures(
  asOf: readonly ChangeHistoryAsOfFeature[],
  dayDiff: readonly ChangeHistoryDayDiffFeature[]
): ChangeHistoryCompareFeature[] {
  type Row = {
    tableName: string;
    keyField: string;
    keyValue: string;
    geom: { type: string; coordinates?: unknown };
  };

  const after = new Map<string, Row>();
  for (const f of asOf) {
    const table = pickTableName(f as ChangeHistoryAsOfFeature & { table_name?: string });
    const key = String(f.keyValue ?? '').trim();
    const geom = normalizeGeoJsonGeometry(f.geom);
    if (!table || !key || !geom?.type) continue;
    after.set(rowKey(table, key), {
      tableName: table,
      keyField: f.keyField,
      keyValue: key,
      geom,
    });
  }

  // 변경 전 초기값 = as-of(변경 후) 복제.
  // 당일 append 는 그날 생성이므로 before 에서 제거하고,
  // remove/conflict(old) 는 dayDiff 의 old 도형으로 before 를 덮어쓴다.
  const before = new Map<string, Row>();
  for (const [, v] of after) {
    before.set(rowKey(v.tableName, v.keyValue), { ...v, geom: v.geom });
  }

  let dayHasBeforeOp = false;

  for (const d of dayDiff) {
    const table = pickTableName(d as ChangeHistoryDayDiffFeature & { table_name?: string });
    const key = String(d.keyValue ?? '').trim();
    if (!table || !key) continue;
    const mk = rowKey(table, key);
    const op = String(d.op ?? '').toLowerCase();
    const geom = normalizeGeoJsonGeometry(d.geom);

    if (op === 'append') {
      // 최초 등록 — 전일 도형이 없으므로 변경 전에서 제거
      before.delete(mk);
      if (geom?.type && (d.side === 'new' || d.side == null) && !after.has(mk)) {
        after.set(mk, {
          tableName: table,
          keyField: d.keyField,
          keyValue: key,
          geom,
        });
      }
      continue;
    }
    if ((op === 'remove' || op === 'conflict') && d.side === 'old' && geom?.type) {
      dayHasBeforeOp = true;
      before.set(mk, {
        tableName: table,
        keyField: d.keyField,
        keyValue: key,
        geom,
      });
    }
    if (op === 'conflict' && d.side === 'new' && geom?.type) {
      after.set(mk, {
        tableName: table,
        keyField: d.keyField,
        keyValue: key,
        geom,
      });
    }
  }

  // 당일이 최초 등록(추가)만이면 변경 전 레이어 자체를 비움 (기존 시설 회색도 숨김)
  if (dayDiff.length > 0 && !dayHasBeforeOp) {
    before.clear();
  }

  const out: ChangeHistoryCompareFeature[] = [];
  for (const row of before.values()) {
    out.push({ ...row, side: 'before' });
  }
  for (const row of after.values()) {
    out.push({ ...row, side: 'after' });
  }
  return out;
}
