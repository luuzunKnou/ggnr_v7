import { useEffect } from 'react';
import type Map from 'ol/Map';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import { WORKSPACE } from './serviceLayerFactory';
import { BUILDING_ROAD_LAYER_DEFS } from './buildingRoadLayerConfig';
import { SAFETY_FAC_RELATED_TABLE_NAMES } from '../../_mapContents/safty/safetyFac/safetyFacRelatedBuildingConfig';

function getGeoServerBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return 'http://localhost:8080/geoserver';
}

const SAFETY_FAC_TABLE_SET = new Set(SAFETY_FAC_RELATED_TABLE_NAMES);

/** 재난대응시설 상세 — 관련 건물·도로 전용 WMS (우측 «건물·도로» 패널과 분리) */
export function createSafetyFacBuildingRoadLayers(): ImageLayer<ImageWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return BUILDING_ROAD_LAYER_DEFS.filter((d) => SAFETY_FAC_TABLE_SET.has(d.tableName)).map(
    ({ tableName, layerName, minZoom, maxZoom }) => {
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
      layer.set('name', `${layerName} (재난시설)`);
      layer.set('safetyFacBuildingRoadLayer', true);
      layer.set('layerTableName', tableName);
      return layer;
    }
  );
}

/** 재난대응시설 확장패널 관련 레이어만 CQL·표시 제어 */
export function useSafetyFacBuildingRoadLayerSync(
  map: Map | null,
  mapReady: boolean,
  state: {
    visibleTableNames: Set<string>;
    cqlByTable: Record<string, string>;
  } | null
) {
  useEffect(() => {
    if (!mapReady || !map) return;

    map.getLayers().getArray().forEach((l) => {
      if (!l.get('safetyFacBuildingRoadLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      if (!tableName) return;

      const active = state != null && state.visibleTableNames.has(tableName);
      const source = (l as ImageLayer<ImageWMS>).getSource();

      if (source) {
        const params = source.getParams();
        if (active) {
          const cql =
            state?.cqlByTable[tableName] ?? state?.cqlByTable[tableName.toLowerCase()];
          if (cql && params.CQL_FILTER !== cql) {
            if (typeof source.updateParams === 'function') {
              source.updateParams({ ...params, CQL_FILTER: cql });
            } else {
              params.CQL_FILTER = cql;
              source.changed();
            }
          }
        } else if (params.CQL_FILTER) {
          const next = { ...params };
          delete next.CQL_FILTER;
          if (typeof source.updateParams === 'function') {
            source.updateParams(next);
          } else {
            Object.assign(params, next);
            delete params.CQL_FILTER;
            source.changed();
          }
        }
      }

      l.setVisible(active);
    });
  }, [map, mapReady, state]);
}
