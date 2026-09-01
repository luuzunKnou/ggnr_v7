import { useEffect } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type { Map as OlMap } from 'ol';
import tables from '@/config/defineLayer/tables.json';
import { WORKSPACE } from './serviceLayerFactory';
import { getGeoServerBase } from '@/lib/geoserverUrl';

type DefineTableRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
  define_table_div_query?: string;
};

export type ThematicMapLayerOption = {
  tableName: string;
  layerName: string;
  /** 분할 시 부모 물리 테이블 (WMS native) */
  parentTableName?: string;
  /** DB 분할 조건 → WMS CQL_FILTER */
  cqlFilter?: string;
  /** 목록 범례 고정 색 (CSS fill). 없으면 회색 */
  legendColor?: string;
  minZoom: number;
  maxZoom: number;
};

export type ThematicMapLayerGroup = {
  id: string;
  title: string;
  layers: ThematicMapLayerOption[];
};

/**
 * 지도 «주제도»에 노출할 define_table_group.
 * public_layer 중 지목·소유·행정경계 등 전용 컨트롤이 있는 그룹은 제외.
 * «주제도»로 시작하는 그룹은 추후 추가분도 자동 포함.
 */
const THEMATIC_MAP_GROUP_ALLOW = new Set([
  '도시계획시설',
  '용도구역',
  '용도지구',
  '용도지역',
  '주제도(기타)',
  '지구단위계획구역',
  '행정제한/특별고시',
]);

function isThematicMapGroup(group: string): boolean {
  if (!group) return false;
  if (THEMATIC_MAP_GROUP_ALLOW.has(group)) return true;
  return group.startsWith('주제도');
}

/** 패널에 표시할 그룹 순서 */
const THEMATIC_MAP_GROUP_ORDER = [
  '용도지역',
  '용도지구',
  '용도구역',
  '도시계획시설',
  '지구단위계획구역',
  '행정제한/특별고시',
  '주제도(기타)',
];

function groupSortKey(title: string): number {
  const i = THEMATIC_MAP_GROUP_ORDER.indexOf(title);
  return i >= 0 ? i : THEMATIC_MAP_GROUP_ORDER.length;
}

function hasPublicTable(existing: Set<string>, name: string): boolean {
  return existing.has(name.trim().toLowerCase());
}

/**
 * tables.json public_layer 중 주제도 대상 그룹을 묶어 패널·WMS 목록 생성.
 * - 부모(연속주제 원본)는 목록에서 제외 — 분할 자식만 노출.
 * - `existingPublicTables`가 있으면: 분할은 부모 테이블 존재 시에만, 비분할은 자기 테이블 존재 시에만.
 * - `layersWithData`가 있으면: 해당 define 테이블명만 남김(분할 조건에 실제 행이 있는 자식).
 * - 둘 다 없으면: 정의 기준 전체 후보(부모 제외).
 */
export function buildThematicMapLayerGroups(
  existingPublicTables?: Set<string> | null,
  layersWithData?: Set<string> | null,
  legendColors?: Record<string, string> | null
): ThematicMapLayerGroup[] {
  const rows = tables as DefineTableRow[];

  /** 다른 레이어의 parents_layer로 쓰이는 원본 테이블명 */
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
    if (!isThematicMapGroup(group)) continue;

    const tableName = String(t.define_table_name ?? '').trim();
    if (!tableName) continue;

    const layerName = String(t.define_table_kor_name ?? tableName).trim();
    const parentTableName = String(t.define_table_parents_layer ?? '').trim() || undefined;
    const cqlFilter = String(t.define_table_div_query ?? '').trim() || undefined;

    // 분할의 부모(원본)는 주제도에 표시하지 않음
    if (parentNames.has(tableName.toLowerCase())) continue;
    // 연속주제 원본 표기(자식 정의가 아직 없어도) 제외
    if (!parentTableName && layerName.startsWith('(연속주제)')) continue;

    // 시스템별: DB public_layer에 부모(또는 자기) 테이블이 있을 때만 노출
    if (existingPublicTables) {
      if (parentTableName) {
        if (!hasPublicTable(existingPublicTables, parentTableName)) continue;
      } else if (!hasPublicTable(existingPublicTables, tableName)) {
        continue;
      }
    }

    // 분할 조건(또는 비분할 테이블)에 실제 데이터가 있는 항목만
    if (dataNamesLower && !dataNamesLower.has(tableName.toLowerCase())) continue;

    const list = byGroup.get(group) ?? [];
    const legendColor = legendColors?.[tableName.toLowerCase()];
    list.push({
      tableName,
      layerName,
      parentTableName,
      cqlFilter,
      ...(legendColor ? { legendColor } : {}),
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
      layers: layers.sort((a, b) => a.layerName.localeCompare(b.layerName, 'ko')),
    }));
}

/** 정의 기준 전체 후보(부모 제외, DB 필터 없음) */
export const THEMATIC_MAP_LAYER_GROUPS: ThematicMapLayerGroup[] = buildThematicMapLayerGroups();

export const THEMATIC_MAP_LAYERS: ThematicMapLayerOption[] = THEMATIC_MAP_LAYER_GROUPS.flatMap(
  (g) => g.layers
);

export function createThematicMapLayers(
  layers: ThematicMapLayerOption[] = THEMATIC_MAP_LAYERS
): ImageLayer<ImageWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return layers.map(({ tableName, layerName, parentTableName, cqlFilter, minZoom, maxZoom }) => {
    // 분할: GeoServer 발행명(자식)을 쓰되 CQL은 tables.json div_query를 GetMap에 직접 적용
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
    layer.set('thematicMapLayer', true);
    layer.set('layerTableName', tableName);
    if (parentTableName) layer.set('layerParentTableName', parentTableName);
    if (cqlFilter) layer.set('layerCqlFilter', cqlFilter);
    return layer;
  });
}

export function useThematicMapLayerSync(
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
    const groupOn = activeControls.includes('thematic-map');
    const catalogReady = availableTableNames != null;
    const showAll = visibleTableNames == null;
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('thematicMapLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      const inCatalog =
        catalogReady && tableName != null && availableTableNames.has(tableName);
      const selected =
        showAll || (tableName != null && (visibleTableNames?.has(tableName) ?? false));
      l.setVisible(groupOn && inCatalog && selected);
    });
  }, [map, mapReady, activeControls, visibleTableNames, availableTableNames]);
}
