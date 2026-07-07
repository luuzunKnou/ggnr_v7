/**
 * 필지분석 4-B~4-E — 기본도·시설 레이어 카탈로그 (defineLayer tables.json 기준)
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type ParcelAnalysisLayerDef = {
  layerKey: string;
  layerKorName: string;
  geomType: 'POINT' | 'LINE' | 'POLYGON';
  schema: string;
};

export type ParcelAnalysisFacilityGroupDef = {
  id: string;
  title: string;
  description: string;
  layers: ParcelAnalysisLayerDef[];
};

type DefineLayerRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_shp_type?: string;
  define_table_group?: string;
  define_table_schema?: string;
};

const TABLES_PATH = join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');

const EXCLUDED_GROUPS = new Set(['메모', '민원']);

/** ENABLED_SYSTEMS(road,river,…) → define_table_group 키워드 */
const SYSTEM_GROUP_KEYWORDS: Record<string, string[]> = {
  road: ['도로'],
  river: ['하천', '맑은물', '하수'],
  build: ['공사', '사업', '건축', '인허가', '개발'],
  safety: ['안전', '재난'],
};

function readDefineLayerTables(): DefineLayerRow[] {
  if (!existsSync(TABLES_PATH)) return [];
  try {
    const raw = readFileSync(TABLES_PATH, 'utf-8');
    const data = JSON.parse(raw) as DefineLayerRow[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function normalizeGeomType(value: string | undefined): 'POINT' | 'LINE' | 'POLYGON' {
  const v = String(value ?? '').toUpperCase();
  if (v === 'POINT' || v === 'MULTIPOINT') return 'POINT';
  if (v === 'LINE' || v === 'LINESTRING' || v === 'MULTILINE') return 'LINE';
  return 'POLYGON';
}

function slugifyGroup(group: string): string {
  return group.replace(/\s+/g, '_');
}

function groupMatchesEnabledSystems(group: string, enabledSystems: string[]): boolean {
  if (!enabledSystems.length) return true;
  for (const sys of enabledSystems) {
    const keywords = SYSTEM_GROUP_KEYWORDS[sys.trim().toLowerCase()];
    if (!keywords) continue;
    if (keywords.some((kw) => group.includes(kw))) return true;
  }
  return false;
}

export function parseEnabledSystems(raw: string | undefined): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 시설목록 동적 카탈로그 (4-E) */
export function buildParcelAnalysisFacilityCatalog(enabledSystemsRaw?: string): ParcelAnalysisFacilityGroupDef[] {
  const enabledSystems = parseEnabledSystems(enabledSystemsRaw);
  const tables = readDefineLayerTables();
  const groupMap = new Map<string, ParcelAnalysisLayerDef[]>();

  for (const row of tables) {
    const group = String(row.define_table_group ?? '').trim();
    const tableName = String(row.define_table_name ?? '').trim();
    if (!group || !tableName || EXCLUDED_GROUPS.has(group)) continue;
    if (tableName.endsWith('_jijuk')) continue;
    if (enabledSystems.length && !groupMatchesEnabledSystems(group, enabledSystems)) continue;

    const layer: ParcelAnalysisLayerDef = {
      layerKey: tableName,
      layerKorName: String(row.define_table_kor_name ?? tableName).trim() || tableName,
      geomType: normalizeGeomType(row.define_table_shp_type),
      schema: String(row.define_table_schema ?? 'layer').trim() || 'layer',
    };
    const prev = groupMap.get(group) ?? [];
    prev.push(layer);
    groupMap.set(group, prev);
  }

  return [...groupMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .map(([group, layers]) => ({
      id: `facility:${slugifyGroup(group)}`,
      title: group,
      description: `${group} 시설 목록을 분석합니다.`,
      layers: layers.sort((a, b) => a.layerKorName.localeCompare(b.layerKorName, 'ko')),
    }));
}

const tableIndex = new Map<string, { schema: string; geomType: 'POINT' | 'LINE' | 'POLYGON'; korName: string }>();

function ensureTableIndex(): void {
  if (tableIndex.size) return;
  for (const row of readDefineLayerTables()) {
    const key = String(row.define_table_name ?? '').trim();
    if (!key) continue;
    tableIndex.set(key, {
      schema: String(row.define_table_schema ?? 'layer').trim() || 'layer',
      geomType: normalizeGeomType(row.define_table_shp_type),
      korName: String(row.define_table_kor_name ?? key).trim() || key,
    });
  }
}

/** SQL 인젝션 방지 — defineLayer 화이트리스트만 허용 */
export function resolveParcelAnalysisLayers(
  layers: Array<{ layerKey?: string; layerKorName?: string; geomType?: string; schema?: string }>
): ParcelAnalysisLayerDef[] {
  ensureTableIndex();
  const out: ParcelAnalysisLayerDef[] = [];
  for (const layer of layers ?? []) {
    const key = String(layer.layerKey ?? '').trim();
    if (!key) continue;
    const meta = tableIndex.get(key);
    if (!meta) continue;
    const geom = String(layer.geomType ?? meta.geomType).toUpperCase();
    const geomType =
      geom === 'POINT' ? 'POINT' : geom === 'LINE' || geom === 'LINESTRING' ? 'LINE' : 'POLYGON';
    out.push({
      layerKey: key,
      layerKorName: String(layer.layerKorName ?? meta.korName).trim() || meta.korName,
      geomType,
      schema: String(layer.schema ?? meta.schema).trim() || meta.schema,
    });
  }
  return out;
}
