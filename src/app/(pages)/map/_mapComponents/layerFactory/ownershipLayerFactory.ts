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

type DefineTableRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
  define_table_div_query?: string;
};

/** 지도 «소유구분»에 노출할 define_table_group */
export const OWNERSHIP_GROUP_NAME = '소유자정보';

function isOwnershipGroup(group: string): boolean {
  return group === OWNERSHIP_GROUP_NAME;
}

function hasPublicTable(existing: Set<string>, name: string): boolean {
  return existing.has(name.trim().toLowerCase());
}

/** 기타(기타단체)는 목록 맨 아래 */
function isOwnershipOtherLayer(layer: Pick<ThematicMapLayerOption, 'tableName' | 'layerName'>): boolean {
  const table = String(layer.tableName ?? '')
    .trim()
    .toLowerCase();
  if (table === 'landown_other') return true;
  const name = String(layer.layerName ?? '').trim();
  return name === '기타' || name.startsWith('기타');
}

/**
 * tables.json public_layer 중 소유자정보 그룹을 묶어 패널·WMS 목록 생성.
 * 주제도와 동일: 부모 제외, 선택적 DB·데이터 필터.
 */
export function buildOwnershipLayerGroups(
  existingPublicTables?: Set<string> | null,
  layersWithData?: Set<string> | null
): ThematicMapLayerGroup[] {
  const rows = tables as DefineTableRow[];

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
    if (schema && schema !== 'public_layer') continue;

    const group = String(t.define_table_group ?? '').trim();
    if (!isOwnershipGroup(group)) continue;

    const tableName = String(t.define_table_name ?? '').trim();
    if (!tableName) continue;

    const layerName = String(t.define_table_kor_name ?? tableName).trim();
    const parentTableName = String(t.define_table_parents_layer ?? '').trim() || undefined;
    const cqlFilter = String(t.define_table_div_query ?? '').trim() || undefined;

    if (parentNames.has(tableName.toLowerCase())) continue;
    if (!parentTableName && layerName.startsWith('(연속주제)')) continue;

    if (existingPublicTables) {
      if (parentTableName) {
        if (!hasPublicTable(existingPublicTables, parentTableName)) continue;
      } else if (!hasPublicTable(existingPublicTables, tableName)) {
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
      minZoom: 8,
      maxZoom: 30,
    });
    byGroup.set(group, list);
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .map(([title, layers]) => ({
      id: title,
      title,
      layers: layers.sort((a, b) => {
        const aOther = isOwnershipOtherLayer(a);
        const bOther = isOwnershipOtherLayer(b);
        if (aOther !== bOther) return aOther ? 1 : -1;
        return a.layerName.localeCompare(b.layerName, 'ko');
      }),
    }));
}

export const OWNERSHIP_LAYER_GROUPS: ThematicMapLayerGroup[] = buildOwnershipLayerGroups();

export const OWNERSHIP_LAYERS: ThematicMapLayerOption[] = OWNERSHIP_LAYER_GROUPS.flatMap(
  (g) => g.layers
);

export function createOwnershipLayers(
  layers: ThematicMapLayerOption[] = OWNERSHIP_LAYERS
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
      }),
    });
    layer.set('name', layerName);
    layer.set('landownLayer', true);
    layer.set('ownershipLayer', true);
    layer.set('layerTableName', tableName);
    if (parentTableName) layer.set('layerParentTableName', parentTableName);
    if (cqlFilter) layer.set('layerCqlFilter', cqlFilter);
    return layer;
  });
}

export function useOwnershipLayerSync(
  map: OlMap | null,
  mapReady: boolean,
  activeControls: string[],
  /** null = 전체 표시, 빈 Set = 전체 숨김, 비어 있지 않은 Set = 선택된 것만 */
  visibleTableNames?: Set<string> | null,
  /**
   * DB 기준 가용 자식 테이블명. null/undefined = 아직 미조회(전부 끔).
   * Set이면 그 안의 레이어만 켤 수 있음.
   */
  availableTableNames?: Set<string> | null
) {
  useEffect(() => {
    if (!mapReady || !map) return;
    const groupOn = activeControls.includes('ownership');
    const catalogReady = availableTableNames != null;
    const showAll = visibleTableNames == null;
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('landownLayer') && !l.get('ownershipLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      const inCatalog =
        catalogReady && tableName != null && availableTableNames.has(tableName);
      const selected =
        showAll || (tableName != null && (visibleTableNames?.has(tableName) ?? false));
      l.setVisible(groupOn && inCatalog && selected);
    });
  }, [map, mapReady, activeControls, visibleTableNames, availableTableNames]);
}
