import { useEffect } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type { Map } from 'ol';
import tables from '@/config/defineLayer/tables.json';
import { WORKSPACE } from './serviceLayerFactory';

function getGeoServerBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return 'http://localhost:8080/geoserver';
}

type DefineTableRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
};

export type ThematicMapLayerOption = {
  tableName: string;
  layerName: string;
  minZoom: number;
  maxZoom: number;
};

export type ThematicMapLayerGroup = {
  id: string;
  title: string;
  layers: ThematicMapLayerOption[];
};

/**
 * define_table_group 이 «주제도»로 시작하는 항목을 그룹별로 묶음.
 * 예: 주제도(기타), 추후 주제도(레이어) 등.
 */
function buildThematicMapLayerGroups(): ThematicMapLayerGroup[] {
  const byGroup = new Map<string, ThematicMapLayerOption[]>();

  for (const t of tables as DefineTableRow[]) {
    const group = String(t.define_table_group ?? '').trim();
    if (!group.startsWith('주제도')) continue;
    const tableName = String(t.define_table_name ?? '').trim();
    if (!tableName) continue;
    const layerName = String(t.define_table_kor_name ?? tableName).trim();
    const list = byGroup.get(group) ?? [];
    list.push({ tableName, layerName, minZoom: 8, maxZoom: 30 });
    byGroup.set(group, list);
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .map(([title, layers]) => ({
      id: title,
      title,
      layers: layers.sort((a, b) => a.layerName.localeCompare(b.layerName, 'ko')),
    }));
}

export const THEMATIC_MAP_LAYER_GROUPS: ThematicMapLayerGroup[] = buildThematicMapLayerGroups();

export const THEMATIC_MAP_LAYERS: ThematicMapLayerOption[] = THEMATIC_MAP_LAYER_GROUPS.flatMap(
  (g) => g.layers
);

export function createThematicMapLayers(): ImageLayer<ImageWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return THEMATIC_MAP_LAYERS.map(({ tableName, layerName, minZoom, maxZoom }) => {
    const layer = new ImageLayer({
      minZoom,
      maxZoom,
      visible: false,
      source: new ImageWMS({
        url: wmsUrl,
        params: {
          LAYERS: `${WORKSPACE}:${tableName}`,
          STYLES: tableName,
        },
        serverType: 'geoserver',
        ratio: 1.5,
      }),
    });
    layer.set('name', layerName);
    layer.set('thematicMapLayer', true);
    layer.set('layerTableName', tableName);
    return layer;
  });
}

export function useThematicMapLayerSync(
  map: Map | null,
  mapReady: boolean,
  activeControls: string[],
  /** null = 전체 표시, 빈 Set = 전체 숨김, 비어 있지 않은 Set = 선택된 것만 */
  visibleTableNames?: Set<string> | null
) {
  useEffect(() => {
    if (!mapReady || !map) return;
    const groupOn = activeControls.includes('thematic-map');
    const showAll = visibleTableNames == null;
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('thematicMapLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      const allowed =
        showAll || (tableName != null && (visibleTableNames?.has(tableName) ?? false));
      l.setVisible(groupOn && allowed);
    });
  }, [map, mapReady, activeControls, visibleTableNames]);
}
