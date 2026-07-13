/**
 * 데이터조회(AttributeQueryUI) 레이어 그룹 구성 — 서버·클라이언트 공통
 */
export type DefineLayerMetaRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_shp_type?: string;
  define_table_group?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
  define_table_div_query?: string;
};

export type DataQueryLayerItem = {
  layerKey: string;
  layerKorName: string;
  schema: string;
  geomType: 'POINT' | 'LINE' | 'POLYGON';
  physicalTableName?: string;
  rowFilterSql?: string | null;
};

export type DataQueryLayerGroup = {
  groupName: string;
  layers: DataQueryLayerItem[];
};

function normalizeGeomType(value: string | undefined): 'POINT' | 'LINE' | 'POLYGON' {
  const v = String(value ?? '').toUpperCase();
  if (v === 'POINT' || v === 'MULTIPOINT') return 'POINT';
  if (v === 'LINE' || v === 'LINESTRING' || v === 'MULTILINE') return 'LINE';
  return 'POLYGON';
}

/** v6 layer_geom_type·필지분석과 동일 — 통계를 «시설 수(개)»로 집계하는 그룹 */
export const FACILITY_COUNT_STAT_GROUPS = new Set(['재난안전지도']);

export function resolveFacilityStatsGeomType(
  layerKey: string,
  options?: {
    groupName?: string;
    shpType?: string;
    dbGeomTypes?: Record<string, 'POINT' | 'LINE' | 'POLYGON'>;
    passedGeomType?: string;
  }
): 'POINT' | 'LINE' | 'POLYGON' {
  const group = options?.groupName?.trim();
  if (group && FACILITY_COUNT_STAT_GROUPS.has(group)) return 'POINT';

  const fromDb =
    options?.dbGeomTypes?.[layerKey] ?? options?.dbGeomTypes?.[layerKey.toLowerCase()];
  if (fromDb) return fromDb;

  if (options?.passedGeomType) return normalizeGeomType(options.passedGeomType);
  return normalizeGeomType(options?.shpType);
}

function metaToLayer(
  row: DefineLayerMetaRow | undefined,
  tableKey: string,
  geomTypes?: Record<string, 'POINT' | 'LINE' | 'POLYGON'>
): DataQueryLayerItem {
  /** GeoServer·DB 실제명은 소문자 — AttributeQueryUI tableName과 동일 */
  const key = tableKey.toLowerCase();
  return {
    layerKey: key,
    layerKorName: row
      ? String(row.define_table_kor_name ?? key).trim() || key
      : tableKey,
    schema: row ? String(row.define_table_schema ?? 'layer').trim() || 'layer' : 'layer',
    geomType: resolveFacilityStatsGeomType(key, {
      groupName: row?.define_table_group,
      shpType: row?.define_table_shp_type,
      dbGeomTypes: geomTypes,
    }),
  };
}

export type BuildDataQueryLayerGroupsOptions = {
  excludeGroups?: Set<string>;
};

/**
 * layer 스키마 DB 테이블 + defineLayer 메타로 그룹 구성 (AttributeQueryUI와 동일 규칙)
 */
export function buildDataQueryLayerGroups(
  dbLayerTableNamesLower: Set<string>,
  metaArr: DefineLayerMetaRow[],
  geomTypes?: Record<string, 'POINT' | 'LINE' | 'POLYGON'>,
  options?: BuildDataQueryLayerGroupsOptions
): DataQueryLayerGroup[] {
  const excludeGroups = options?.excludeGroups ?? new Set<string>();
  const groupMap = new Map<string, DataQueryLayerItem[]>();
  const groupOrder: string[] = [];

  const metaMap = new Map<string, DefineLayerMetaRow>();
  for (const m of metaArr) {
    const name = String(m.define_table_name ?? '').trim().toLowerCase();
    if (name && (m.define_table_schema || 'layer').toLowerCase() === 'layer') {
      metaMap.set(name, m);
    }
  }

  const parentTablesWithSplitDefs = new Set<string>();
  for (const m of metaArr) {
    if ((m.define_table_schema || 'layer').toLowerCase() !== 'layer') continue;
    const p = String(m.define_table_parents_layer ?? '').trim().toLowerCase();
    const divQ = String(m.define_table_div_query ?? '').trim();
    if (p && divQ) parentTablesWithSplitDefs.add(p);
  }

  const addLayer = (groupName: string, layer: DataQueryLayerItem) => {
    if (excludeGroups.has(groupName)) return;
    if (!groupMap.has(groupName)) {
      groupMap.set(groupName, []);
      groupOrder.push(groupName);
    }
    const list = groupMap.get(groupName)!;
    if (list.some((l) => l.layerKey.toLowerCase() === layer.layerKey.toLowerCase())) return;
    list.push(layer);
  };

  for (const tblName of dbLayerTableNamesLower) {
    if (parentTablesWithSplitDefs.has(tblName)) continue;
    const meta = metaMap.get(tblName);
    const groupName = meta?.define_table_group?.trim() || '기타';
    addLayer(groupName, metaToLayer(meta, tblName, geomTypes));
  }

  for (const m of metaArr) {
    const schemaM = (m.define_table_schema || 'layer').toLowerCase();
    if (schemaM !== 'layer') continue;
    const eng = String(m.define_table_name ?? '').trim();
    if (!eng) continue;
    const engLower = eng.toLowerCase();
    const parent = String(m.define_table_parents_layer ?? '').trim();
    const divQ = String(m.define_table_div_query ?? '').trim();
    if (!parent || !divQ) continue;
    const parentLower = parent.toLowerCase();
    if (!dbLayerTableNamesLower.has(parentLower)) continue;
    if (dbLayerTableNamesLower.has(engLower)) continue;
    const groupName = String(m.define_table_group ?? '').trim() || '기타';
    const korName = String(m.define_table_kor_name ?? '').trim() || eng;
    addLayer(groupName, {
      layerKey: engLower,
      layerKorName: korName,
      schema: 'layer',
      geomType: resolveFacilityStatsGeomType(engLower, {
        groupName,
        shpType: m.define_table_shp_type,
        dbGeomTypes: geomTypes,
      }),
      physicalTableName: parentLower,
      rowFilterSql: divQ,
    });
  }

  return groupOrder.map((groupName) => ({
    groupName,
    layers: (groupMap.get(groupName) ?? []).sort((a, b) =>
      a.layerKorName.localeCompare(b.layerKorName, 'ko')
    ),
  }));
}
