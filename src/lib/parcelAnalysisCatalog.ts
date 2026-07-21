/**
 * 필지분석 4-B~4-E — 기본도·시설 레이어 카탈로그 (defineLayer tables.json 기준)
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  buildDataQueryLayerGroups,
  resolveFacilityStatsGeomType,
  type DefineLayerMetaRow,
} from '@/lib/dataQueryLayerGroups';

export type ParcelAnalysisLayerDef = {
  layerKey: string;
  layerKorName: string;
  geomType: 'POINT' | 'LINE' | 'POLYGON';
  schema: string;
  /** 분할 레이어 — 부모 물리 테이블 */
  physicalTableName?: string;
  /** define_table_div_query */
  rowFilterSql?: string | null;
};

export type ParcelAnalysisFacilityGroupDef = {
  id: string;
  title: string;
  description: string;
  layers: ParcelAnalysisLayerDef[];
  /** GeoServer publish 된 레이어만 — 결과 지도 캡처용 */
  wmsLayerKeys?: string[];
};

const TABLES_PATH = join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');

const EXCLUDED_GROUPS = new Set(['메모', '민원']);

function readDefineLayerTables(): DefineLayerMetaRow[] {
  if (!existsSync(TABLES_PATH)) return [];
  try {
    const raw = readFileSync(TABLES_PATH, 'utf-8');
    const data = JSON.parse(raw) as DefineLayerMetaRow[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function slugifyGroup(group: string): string {
  return group.replace(/\s+/g, '_');
}

function toParcelLayer(layer: {
  layerKey: string;
  layerKorName: string;
  geomType: 'POINT' | 'LINE' | 'POLYGON';
  schema: string;
  physicalTableName?: string;
  rowFilterSql?: string | null;
}): ParcelAnalysisLayerDef {
  return {
    layerKey: layer.layerKey,
    layerKorName: layer.layerKorName,
    geomType: layer.geomType,
    schema: layer.schema,
    physicalTableName: layer.physicalTableName,
    rowFilterSql: layer.rowFilterSql,
  };
}

/**
 * 데이터조회와 동일한 그룹 규칙 — layer 스키마 DB 테이블 + defineLayer 메타
 */
export function buildParcelAnalysisFacilityCatalogFromDbTables(
  dbLayerTableNamesLower: Set<string>,
  publishedLayerNamesLower?: Set<string>,
  geomTypes?: Record<string, 'POINT' | 'LINE' | 'POLYGON'>
): ParcelAnalysisFacilityGroupDef[] {
  const tables = readDefineLayerTables();
  const dataQueryGroups = buildDataQueryLayerGroups(dbLayerTableNamesLower, tables, geomTypes, {
    excludeGroups: EXCLUDED_GROUPS,
  });

  return dataQueryGroups
    .map(({ groupName, layers }) => {
      const parcelLayers = layers.map(toParcelLayer);
      const wmsLayerKeys = publishedLayerNamesLower
        ? parcelLayers
            .map((l) => l.layerKey)
            .filter((key) => publishedLayerNamesLower.has(key.toLowerCase()))
        : undefined;
      return {
        id: `facility:${slugifyGroup(groupName)}`,
        title: groupName,
        description: `${groupName} 시설 목록을 분석합니다.`,
        layers: parcelLayers,
        wmsLayerKeys: wmsLayerKeys?.length ? wmsLayerKeys : undefined,
      };
    })
    .filter((group) => group.layers.length > 0);
}

const tableIndex = new Map<
  string,
  {
    schema: string;
    geomType: 'POINT' | 'LINE' | 'POLYGON';
    korName: string;
    groupName: string;
    physicalTableName?: string;
    rowFilterSql?: string | null;
  }
>();

function normalizeGeomType(value: string | undefined): 'POINT' | 'LINE' | 'POLYGON' {
  const v = String(value ?? '').toUpperCase();
  if (v === 'POINT' || v === 'MULTIPOINT') return 'POINT';
  if (v === 'LINE' || v === 'LINESTRING' || v === 'MULTILINE') return 'LINE';
  return 'POLYGON';
}

function ensureTableIndex(): void {
  if (tableIndex.size) return;
  for (const row of readDefineLayerTables()) {
    const key = String(row.define_table_name ?? '').trim();
    if (!key) continue;
    const parent = String(row.define_table_parents_layer ?? '').trim();
    const divQ = String(row.define_table_div_query ?? '').trim();
    tableIndex.set(key, {
      schema: String(row.define_table_schema ?? 'layer').trim() || 'layer',
      geomType: normalizeGeomType(row.define_table_shp_type),
      korName: String(row.define_table_kor_name ?? key).trim() || key,
      groupName: String(row.define_table_group ?? '').trim(),
      physicalTableName: parent ? parent.toLowerCase() : undefined,
      rowFilterSql: divQ || null,
    });
    tableIndex.set(key.toLowerCase(), tableIndex.get(key)!);
  }
}

/** SQL 인젝션 방지 — defineLayer 화이트리스트 우선, 카탈로그에서 온 메타는 허용 */
export function resolveParcelAnalysisLayers(
  layers: Array<{
    layerKey?: string;
    layerKorName?: string;
    geomType?: string;
    schema?: string;
    physicalTableName?: string;
    rowFilterSql?: string | null;
  }>,
  dbGeomTypes?: Record<string, 'POINT' | 'LINE' | 'POLYGON'>
): ParcelAnalysisLayerDef[] {
  ensureTableIndex();
  const out: ParcelAnalysisLayerDef[] = [];
  for (const layer of layers ?? []) {
    const key = String(layer.layerKey ?? '').trim().toLowerCase();
    if (!key) continue;
    const meta = tableIndex.get(key) ?? tableIndex.get(key.toLowerCase());
    const geomType = resolveFacilityStatsGeomType(key, {
      groupName: meta?.groupName,
      shpType: meta?.geomType,
      dbGeomTypes,
      passedGeomType: layer.geomType ?? meta?.geomType,
    });
    out.push({
      layerKey: key,
      layerKorName: String(layer.layerKorName ?? meta?.korName ?? key).trim() || key,
      geomType,
      schema: String(layer.schema ?? meta?.schema ?? 'layer').trim() || 'layer',
      physicalTableName: layer.physicalTableName ?? meta?.physicalTableName,
      rowFilterSql: layer.rowFilterSql ?? meta?.rowFilterSql ?? null,
    });
  }
  return out;
}
