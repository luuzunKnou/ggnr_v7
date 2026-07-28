'use client';

import { useEffect, useRef, useState } from 'react';
import { Map as OlMap, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { defaults as defaultControls } from 'ol/control';
import { defaults as defaultInteractions } from 'ol/interaction';
import '@/app/(pages)/map/_mapComponents/config/projections';
import { RESOLUTIONS_3857 } from '@/app/(pages)/map/_mapComponents/config/mapDefaults';
import { createCadastralLayers, createBuildingRoadLayers } from '@/app/(pages)/map/_mapComponents/layerFactory/boundaryLayerFactory';
import { createBasicSectionLayers } from '@/app/(pages)/map/_mapComponents/layerFactory/basicSectionLayerFactory';
import { createJimokLayers } from '@/app/(pages)/map/_mapComponents/layerFactory/jimokLayerFactory';
import { createLandownLayers } from '@/app/(pages)/map/_mapComponents/layerFactory/landownLayerFactory';
import { createThematicMapLayers } from '@/app/(pages)/map/_mapComponents/layerFactory/thematicMapLayerFactory';
import { createSafetydataMapLayers } from '@/app/(pages)/map/_mapComponents/layerFactory/safetydataMapLayerFactory';
import {
  createServiceLayer,
  useServiceLayerSync,
} from '@/app/(pages)/map/_mapComponents/layerFactory/serviceLayerFactory';
import { useBackgroundLayer } from '@/app/(pages)/map/_mapComponents/hooks/useBackgroundLayer';
import {
  useCadastralLayerSync,
  useBuildingRoadLayerSync,
} from '@/app/(pages)/map/_mapComponents/layerFactory/boundaryLayerFactory';
import { useBasicSectionLayerSync } from '@/app/(pages)/map/_mapComponents/layerFactory/basicSectionLayerFactory';
import { useJimokLayerSync } from '@/app/(pages)/map/_mapComponents/layerFactory/jimokLayerFactory';
import { useLandownLayerSync } from '@/app/(pages)/map/_mapComponents/layerFactory/landownLayerFactory';
import { useThematicMapLayerSync } from '@/app/(pages)/map/_mapComponents/layerFactory/thematicMapLayerFactory';
import type { MapPrintSnapshot } from './mapPrintTypes';

export function useMapPrintMap(
  hostRef: React.RefObject<HTMLDivElement | null>,
  open: boolean,
  snapshot: MapPrintSnapshot | null,
  backgroundMapId: string,
  visibleLayerNames: Set<string>,
  activeLayerControls: string[],
  visibleCadastral: Set<string> | null,
  visibleBuildingRoad: Set<string> | null,
  visibleJimok: Set<string> | null,
  visibleLandown: Set<string> | null,
  visibleThematic: Set<string> | null,
) {
  const mapRef = useRef<OlMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [map, setMap] = useState<OlMap | null>(null);

  useEffect(() => {
    if (!open || !hostRef.current || !snapshot) return;
    if (mapRef.current) return;

    const olMap = new OlMap({
      target: hostRef.current,
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
        ...createSafetydataMapLayers(),
      ],
      view: new View({
        center: snapshot.center,
        zoom: snapshot.zoom,
        resolutions: RESOLUTIONS_3857,
        minZoom: 0,
        maxZoom: RESOLUTIONS_3857.length - 1,
        constrainResolution: true,
      }),
      controls: defaultControls({ zoom: false, attribution: false }),
      interactions: defaultInteractions({ doubleClickZoom: false }),
    });
    olMap.getLayers().push(createServiceLayer());
    mapRef.current = olMap;
    setMap(olMap);
    setMapReady(true);

    const updateSize = () => olMap.updateSize();
    window.setTimeout(updateSize, 50);
    window.addEventListener('resize', updateSize);

    return () => {
      window.removeEventListener('resize', updateSize);
      olMap.setTarget(undefined);
      mapRef.current = null;
      setMap(null);
      setMapReady(false);
    };
  }, [open, hostRef, snapshot]);

  useBackgroundLayer(map, backgroundMapId);
  useServiceLayerSync(map, mapReady, visibleLayerNames);
  useCadastralLayerSync(map, mapReady, activeLayerControls, visibleCadastral);
  useBuildingRoadLayerSync(map, mapReady, activeLayerControls, visibleBuildingRoad);
  useBasicSectionLayerSync(map, mapReady, activeLayerControls);
  useJimokLayerSync(map, mapReady, activeLayerControls, visibleJimok);
  useLandownLayerSync(map, mapReady, activeLayerControls, visibleLandown);
  useThematicMapLayerSync(map, mapReady, activeLayerControls, visibleThematic);

  return { map, mapReady, mapRef };
}
