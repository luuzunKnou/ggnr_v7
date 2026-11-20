/**
 * 지하시설물 — 레이어관리 그룹(상수·하수 등)과 동일한 define_table_group 기준.
 * schema: layer
 */
import { useEffect } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type { Map as OlMap } from 'ol';
import tables from '@/config/defineLayer/tables.json';
import { WORKSPACE } from './serviceLayerFactory';
import type {
  ThematicMapLayerGroup,
  ThematicMapLayerOption,
} from './thematicMapLayerFactory';
import { getGeoServerBase } from '@/lib/geoserverUrl';
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad';
import { compareDefineTableOrder, parseDefineTableIdx } from '@/lib/defineTableOrder';

type DefineTableRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
  define_table_div_query?: string;
  define_table_idx?: string | number;
};

function compareUndergroundLayers(a: ThematicMapLayerOption, b: ThematicMapLayerOption): number {
  return compareDefineTableOrder(a.tableIdx, a.layerName, b.tableIdx, b.layerName);
}

/** 지도 «지하시설물» — 레이어관리 그룹명과 동일 */
export const UNDERGROUND_FACILITY_GROUP_ALLOW = new Set([
  '상수',
  '급수구역',
  '하수',
  '배수설비',
  '광역상수',
  '가스',
  '도시가스',
  'LPG배관',
  '전기',
  '통신',
]);

const UNDERGROUND_FACILITY_GROUP_ORDER = [
  '상수',
  '급수구역',
  '하수',
  '배수설비',
  '광역상수',
  '가스',
  '도시가스',
  'LPG배관',
  '전기',
  '통신',
];

const UNDERGROUND_FACILITY_SCHEMA = 'layer';

/** 지도 «지하시설물» 목록에서 제외할 테이블 (가압장 펌프/흡수정, 정수장 펌프 현황) */
const UNDERGROUND_FACILITY_EXCLUDE_TABLES = new Set([
  'wtl_pres_pm_ps',
  'wtl_pres_hj_ps',
  'wtl_puri_dt_ps',
]);

/** 그룹명 접두 일치 (LIKE '허용그룹%') */
export function isUndergroundFacilityGroup(group: string): boolean {
  const g = String(group ?? '').trim();
  if (!g) return false;
  for (const allowed of UNDERGROUND_FACILITY_GROUP_ALLOW) {
    if (g === allowed || g.startsWith(allowed)) return true;
  }
  return false;
}

function groupSortKey(title: string): number {
  const t = String(title ?? '').trim();
  let best = UNDERGROUND_FACILITY_GROUP_ORDER.length;
  let bestLen = -1;
  for (let i = 0; i < UNDERGROUND_FACILITY_GROUP_ORDER.length; i++) {
    const allowed = UNDERGROUND_FACILITY_GROUP_ORDER[i];
    if (t === allowed || t.startsWith(allowed)) {
      if (allowed.length > bestLen) {
        bestLen = allowed.length;
        best = i;
      }
    }
  }
  return best;
}

function hasLayerTable(existing: Set<string>, name: string): boolean {
  return existing.has(name.trim().toLowerCase());
}

/**
 * tables.json(또는 프로젝트 분할 merge 결과) `layer` 스키마 중 지하시설물 대상 그룹을 묶어 패널·WMS 목록 생성.
 * 주제도와 동일: 부모 제외, 선택적 DB·데이터 필터.
 */
export function buildUndergroundFacilityLayerGroups(
  existingLayerTables?: Set<string> | null,
  layersWithData?: Set<string> | null,
  defineTables?: DefineTableRow[] | null
): ThematicMapLayerGroup[] {
  const rows = (defineTables ?? (tables as DefineTableRow[])) as DefineTableRow[];

  const parentNames = new Set<string>();
  for (const t of rows) {
    const parent = String(t.define_table_parents_layer ?? '').trim();
    if (parent) parentNames.add(parent.toLowerCase());
  }

  const dataNamesLower =
    layersWithData != null
      ? new Set([...layersWithData].map((n) => n.trim().toLowerCase()).filter(Boolean))
      : null;

  const byGroup = new Map<string, ThematicMapLayerOption[]>();

  for (const t of rows) {
    const schema = String(t.define_table_schema ?? '').trim();
    if (schema && schema !== UNDERGROUND_FACILITY_SCHEMA) continue;

    const group = String(t.define_table_group ?? '').trim();
    if (!isUndergroundFacilityGroup(group)) continue;

    const tableName = String(t.define_table_name ?? '').trim();
    if (!tableName) continue;
    if (UNDERGROUND_FACILITY_EXCLUDE_TABLES.has(tableName.toLowerCase())) continue;

    const layerName = String(t.define_table_kor_name ?? tableName).trim();
    const parentTableName = String(t.define_table_parents_layer ?? '').trim() || undefined;
    const cqlFilter = String(t.define_table_div_query ?? '').trim() || undefined;
    const tableIdx = parseDefineTableIdx(t.define_table_idx);

    if (parentNames.has(tableName.toLowerCase())) continue;
    if (!parentTableName && layerName.startsWith('(연속주제)')) continue;

    if (existingLayerTables) {
      if (parentTableName) {
        if (!hasLayerTable(existingLayerTables, parentTableName)) continue;
      } else if (!hasLayerTable(existingLayerTables, tableName)) {
        continue;
      }
    }

    if (dataNamesLower && !dataNamesLower.has(tableName.toLowerCase())) continue;

    const list = byGroup.get(group) ?? [];
    list.push({
      tableName,
      layerName,
      parentTableName,
      cqlFilter,
      tableIdx,
      minZoom: 8,
      maxZoom: 30,
    });
    byGroup.set(group, list);
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => {
      const da = groupSortKey(a) - groupSortKey(b);
      if (da !== 0) return da;
      return a.localeCompare(b, 'ko');
    })
    .map(([title, layers]) => ({
      id: title,
      title,
      layers: layers.sort(compareUndergroundLayers),
    }));
}

export const UNDERGROUND_FACILITY_LAYER_GROUPS: ThematicMapLayerGroup[] =
  buildUndergroundFacilityLayerGroups();

export const UNDERGROUND_FACILITY_LAYERS: ThematicMapLayerOption[] =
  UNDERGROUND_FACILITY_LAYER_GROUPS.flatMap((g) => g.layers);

export function createUndergroundFacilityLayers(
  layers: ThematicMapLayerOption[] = UNDERGROUND_FACILITY_LAYERS
): ImageLayer<ImageWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return layers.map(({ tableName, layerName, parentTableName, cqlFilter, minZoom, maxZoom }) => {
    const params: Record<string, string> = {
      LAYERS: `${WORKSPACE}:${tableName}`,
      STYLES: tableName,
    };
    if (cqlFilter) {
      params.CQL_FILTER = cqlFilter;
    }

    const layer = new ImageLayer({
      minZoom,
      maxZoom,
      visible: false,
      source: new ImageWMS({
        url: wmsUrl,
        params,
        serverType: 'geoserver',
        ratio: 1.5,
        // 읍면동·리 INTERSECTS 등 긴 CQL은 GET 414 → 이전(전체) 이미지가 남는 문제 방지
        imageLoadFunction: geoserverWmsImageLoadFunction,
      }),
    });
    layer.set('name', layerName);
    layer.set('undergroundFacilityLayer', true);
    layer.set('layerTableName', tableName);
    if (parentTableName) layer.set('layerParentTableName', parentTableName);
    if (cqlFilter) layer.set('layerCqlFilter', cqlFilter);
    return layer;
  });
}

/** DB 도형 변경 후 지하시설물 WMS 이미지를 바로 다시 받는다. */
export function refreshUndergroundFacilityWmsLayers(map: OlMap | null | undefined): void {
  if (!map) return;
  const stamp = String(Date.now());
  for (const layer of map.getLayers().getArray()) {
    if (!layer.get('undergroundFacilityLayer')) continue;
    const source = (layer as ImageLayer<ImageWMS>).getSource();
    if (!source || typeof source.updateParams !== 'function') continue;
    source.updateParams({ ...source.getParams(), _dc: stamp });
    source.changed();
    layer.changed();
  }
  map.render();
}

export function useUndergroundFacilityLayerSync(
  map: OlMap | null,
  mapReady: boolean,
  activeControls: string[],
  visibleTableNames?: Set<string> | null,
  availableTableNames?: Set<string> | null,
  suppressDrawTableNames?: ReadonlySet<string> | null
) {
  useEffect(() => {
    if (!mapReady || !map) return;
    const groupOn = activeControls.includes('underground-facility');
    const catalogReady = availableTableNames != null;
    const showAll = visibleTableNames == null;
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('undergroundFacilityLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      if (tableName != null && suppressDrawTableNames?.has(tableName)) {
        l.setVisible(false);
        return;
      }
      const inCatalog =
        catalogReady && tableName != null && availableTableNames.has(tableName);
      const selected =
        showAll || (tableName != null && (visibleTableNames?.has(tableName) ?? false));
      l.setVisible(groupOn && inCatalog && selected);
    });
  }, [map, mapReady, activeControls, visibleTableNames, availableTableNames, suppressDrawTableNames]);
}
