import { useEffect } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type { Map } from 'ol';
import { WORKSPACE } from './serviceLayerFactory';

function getGeoServerBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return 'http://localhost:8080/geoserver';
}

/** 소유구분 (국유지·군유지·개인소유 등) — 패널 목록·동기화용 export */
export const LANDOWN_LAYERS: { tableName: string; layerName: string; minZoom: number; maxZoom: number }[] = [
  { tableName: 'landown_gukyuji', layerName: '국유지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_gunyuji', layerName: '군유지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_other', layerName: '기타소유', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_person', layerName: '개인소유', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_sidoyuji', layerName: '시도유지', minZoom: 8, maxZoom: 30 },
];

export function createLandownLayers(): ImageLayer<ImageWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return LANDOWN_LAYERS.map(({ tableName, layerName, minZoom, maxZoom }) => {
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
    layer.set('landownLayer', true);
    layer.set('layerTableName', tableName);
    return layer;
  });
}

export function useLandownLayerSync(
  map: Map | null,
  mapReady: boolean,
  activeControls: string[],
  /** null = 전체 표시, 빈 Set = 전체 숨김, 비어 있지 않은 Set = 선택된 것만 */
  visibleTableNames?: Set<string> | null,
) {
  useEffect(() => {
    if (!mapReady || !map) return;
    const groupOn = activeControls.includes('ownership');
    const showAll = visibleTableNames == null;
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('landownLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      const allowed =
        showAll || (tableName != null && (visibleTableNames?.has(tableName) ?? false));
      l.setVisible(groupOn && allowed);
    });
  }, [map, mapReady, activeControls, visibleTableNames]);
}
