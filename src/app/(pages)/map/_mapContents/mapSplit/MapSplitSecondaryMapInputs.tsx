'use client';

import { useCallback, useEffect, useRef } from 'react';
import type Map from 'ol/Map';
import { useMapContext } from '../../_mapComponents/MapContext';
import { useMeasure, type MeasureType } from '../../_mapComponents/hooks/useMeasure';
import { useAltitudeMeasure } from '../../_mapComponents/hooks/useAltitudeMeasure';
import { useSlopeMeasure } from '../../_mapComponents/hooks/useSlopeMeasure';
import { useSpatialDrawOnMap } from '../../_mapComponents/hooks/useSpatialDrawOnMap';
import {
  MAP_MEASUREMENTS_RESET_EVENT,
  parseMapMeasurementsResetTarget,
} from './mapMeasurementsReset';

type Props = {
  map: Map | null;
  active: boolean;
};

/**
 * 지도분할 우측 맵 전용 측정·도형 입력.
 * 좌측 메뉴로 켠 도구를 우측에서도 독립적으로 사용한다 (좌측으로 포인터 전달 없음).
 */
export function MapSplitSecondaryMapInputs({ map, active }: Props) {
  const mapContext = useMapContext();
  const tool = mapContext?.mapMeasureTool ?? null;
  const inputSuspended = mapContext?.mapDrawInputSuspended ?? false;
  const mapForHooks = active ? map : null;

  const measureType: MeasureType | null =
    !inputSuspended && (tool === 'distance' || tool === 'area') ? tool : null;
  const altitudeActive = !inputSuspended && tool === 'altitude';
  const slopeActive = !inputSuspended && tool === 'slope';

  const stopAltitude = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('ggnr-map-control-set', {
        detail: { id: 'altitude', active: false },
      })
    );
  }, []);

  const { clearMeasurements } = useMeasure(mapForHooks, measureType);
  const { clearAltitudeMarkers } = useAltitudeMeasure(
    mapForHooks,
    active && altitudeActive,
    stopAltitude
  );
  const { clearSlopeMeasurements } = useSlopeMeasure(
    mapForHooks,
    active && slopeActive
  );

  const clearAllSecondaryMeasurements = useCallback(() => {
    clearMeasurements();
    clearAltitudeMarkers();
    clearSlopeMeasurements();
  }, [clearMeasurements, clearAltitudeMarkers, clearSlopeMeasurements]);

  useEffect(() => {
    const onReset = (e: Event) => {
      const target = parseMapMeasurementsResetTarget(e);
      if (!target || target === 'primary') return;
      clearAllSecondaryMeasurements();
    };
    window.addEventListener(MAP_MEASUREMENTS_RESET_EVENT, onReset);
    return () => window.removeEventListener(MAP_MEASUREMENTS_RESET_EVENT, onReset);
  }, [clearAllSecondaryMeasurements]);

  const wasMeasuringRef = useRef(false);
  useEffect(() => {
    const measuring = Boolean(tool);
    if (wasMeasuringRef.current && !measuring) {
      clearMeasurements();
      clearAltitudeMarkers();
      clearSlopeMeasurements();
    }
    wasMeasuringRef.current = measuring;
  }, [tool, clearMeasurements, clearAltitudeMarkers, clearSlopeMeasurements]);

  useSpatialDrawOnMap(
    map,
    active,
    mapContext?.spatialDrawRequest ?? null,
    mapContext?.setSpatialDrawRequest,
    Boolean(mapContext?.layerRowGeomEdit) || inputSuspended
  );

  return null;
}
