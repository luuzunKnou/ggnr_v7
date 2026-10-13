import { transformExtent } from 'ol/proj';
import { call } from '@/lib/api';
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation';
import type { MapContextValue } from '../../_mapComponents/MapContext';
import type { WorkUnitItem } from './aerialMediaTypes';

/** tiles_jpg/satellite_... → 배경지도 자체항공영상 id */
export function satelliteBackgroundIdFromUnit(unit: WorkUnitItem): {
  backgroundId: string;
  tuKey: number | null;
} | null {
  const file = unit.files.find(
    (item) => item.status === 'done' && item.tilesRelativePath
  );
  if (!file?.tilesRelativePath) return null;
  const name = file.tilesRelativePath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
  if (!name || !/^satellite_/i.test(name)) return null;
  return {
    backgroundId: name,
    tuKey: file.tuKey != null && Number.isFinite(file.tuKey) ? file.tuKey : null,
  };
}

/** 목록에서 고른 항공영상을 배경지도에 켜고 그 범위로 이동 */
export function showSatelliteOnBackgroundMap(
  mapContext: MapContextValue | null,
  unit: WorkUnitItem
): void {
  const hit = satelliteBackgroundIdFromUnit(unit);
  if (!hit) return;
  mapContext?.setMapBackgroundMapIdRef.current?.(hit.backgroundId);
  if (hit.tuKey == null) return;
  const map = mapContext?.mapInstanceRef?.current;
  if (!map) return;
  void call('', 'POST', {
    service: 'aerialOrthoService',
    action: 'getOrthoTifExtentWgs84',
    params: { tuKey: hit.tuKey },
  })
    .then((res) => {
      if (!res?.success) return;
      const d = (res.data ?? res) as {
        minLon?: number | null;
        minLat?: number | null;
        maxLon?: number | null;
        maxLat?: number | null;
      };
      if (
        d.minLon == null ||
        d.minLat == null ||
        d.maxLon == null ||
        d.maxLat == null ||
        !Number.isFinite(d.minLon) ||
        !Number.isFinite(d.minLat) ||
        !Number.isFinite(d.maxLon) ||
        !Number.isFinite(d.maxLat)
      ) {
        return;
      }
      const current = mapContext?.mapInstanceRef?.current;
      if (!current) return;
      const extent3857 = transformExtent(
        [d.minLon, d.minLat, d.maxLon, d.maxLat],
        'EPSG:4326',
        'EPSG:3857'
      );
      scheduleFitMapToExtent3857(current, extent3857, {
        maxZoom: 18,
        duration: 450,
        fitPadding: [80, 80, 80, 80],
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      });
    })
    .catch(() => undefined);
}
