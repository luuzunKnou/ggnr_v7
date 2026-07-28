import { useEffect, useRef, useState, type RefObject } from 'react';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { defaults } from 'ol/control';
import { getTransform } from 'ol/proj';
import '../../map/_mapComponents/config/projections';
import {
  DEFAULT_CENTER_LON,
  DEFAULT_CENTER_LAT,
  DEFAULT_ZOOM_2D,
  RESOLUTIONS_3857,
} from '../../map/_mapComponents/config/mapDefaults';
import {
  createCadastralLayers,
  createBuildingRoadLayers,
} from '../../map/_mapComponents/layerFactory/boundaryLayerFactory';
import { createBasicSectionLayers } from '../../map/_mapComponents/layerFactory/basicSectionLayerFactory';
import { createJimokLayers } from '../../map/_mapComponents/layerFactory/jimokLayerFactory';
import { createLandownLayers } from '../../map/_mapComponents/layerFactory/landownLayerFactory';
import { createThematicMapLayers } from '../../map/_mapComponents/layerFactory/thematicMapLayerFactory';
import { createServiceLayer } from '../../map/_mapComponents/layerFactory/serviceLayerFactory';
import { loadPersistedMapState } from '../../map/_mapComponents/hooks/useMapStatePersist';

const SHAPE_EDITOR_STATE_SUFFIX = ':shape-editor';

/**
 * 도형편집기 전용 OpenLayers 맵 — 배경 + 참조 WMS + serviceLayer.
 */
export function useShapeEditorMapInstance(
  mapRef: RefObject<HTMLDivElement | null>,
  defaultCenterWgs84?: { lon: number; lat: number } | null,
  projectName?: string
) {
  const mapInstanceRef = useRef<Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const initialDefaultCenterRef = useRef(defaultCenterWgs84);
  const persistKey = projectName ? `${projectName}${SHAPE_EDITOR_STATE_SUFFIX}` : SHAPE_EDITOR_STATE_SUFFIX;

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const persisted = loadPersistedMapState(persistKey);
    const to3857 = getTransform('EPSG:4326', 'EPSG:3857');
    const initialDefaultCenter = initialDefaultCenterRef.current;
    const defaultCenter = to3857([
      initialDefaultCenter?.lon ?? DEFAULT_CENTER_LON,
      initialDefaultCenter?.lat ?? DEFAULT_CENTER_LAT,
    ]);

    const initialCenter = persisted ? [persisted.centerX, persisted.centerY] : defaultCenter;
    const initialZoom = persisted?.zoom ?? DEFAULT_ZOOM_2D;

    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new OSM(),
          properties: { name: 'background' },
        }),
        ...createCadastralLayers(),
        ...createBuildingRoadLayers(),
        ...createBasicSectionLayers(),
        ...createJimokLayers(),
        ...createLandownLayers(),
        ...createThematicMapLayers(),
      ],
      view: new View({
        center: initialCenter,
        zoom: initialZoom,
        resolutions: RESOLUTIONS_3857,
        minZoom: 0,
        maxZoom: RESOLUTIONS_3857.length - 1,
        constrainResolution: true,
      }),
      controls: defaults({
        zoom: false,
        attribution: false,
      }),
    });

    map.getLayers().push(createServiceLayer());
    mapInstanceRef.current = map;
    setMapReady(true);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setTarget(undefined);
        mapInstanceRef.current = null;
      }
      setMapReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, persistKey]);

  return { mapInstanceRef, mapReady, persistedBackgroundId: loadPersistedMapState(persistKey)?.backgroundMap };
}
