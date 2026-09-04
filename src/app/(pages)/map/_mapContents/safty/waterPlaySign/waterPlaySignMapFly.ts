import type { Map } from 'ol';
import { easeOut } from 'ol/easing';
import { fromLonLat } from 'ol/proj';
import { prepareMapForPanelAwareNavigation } from '../../../_mapComponents/config/mapAutoNavigation';
import type { WaterPlaySignListItem } from '@/service/waterPlaySignService';

const WATER_PLAY_SIGN_FLY_ZOOM = 15;
const WATER_PLAY_SIGN_FLY_MS = 450;

/** 상세 패널 padding 반영 후 좌표로 이동 (리스트·상세 저장 후 공통) */
export function flyToWaterPlaySignLonLat(
  map: Map | null | undefined,
  lon: number | null | undefined,
  lat: number | null | undefined,
  applyMapViewPadding?: (() => void) | null
): void {
  if (!map || lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const center3857 = fromLonLat([lon, lat]) as [number, number];

  const run = () => {
    prepareMapForPanelAwareNavigation(map, applyMapViewPadding);
    const view = map.getView();
    view.cancelAnimations();
    const currentZoom = view.getZoom();
    const targetZoom = Math.max(
      Number.isFinite(currentZoom) ? (currentZoom as number) : 0,
      WATER_PLAY_SIGN_FLY_ZOOM
    );
    const resolution = view.getResolutionForZoom(targetZoom);
    view.animate({
      center: center3857,
      resolution,
      duration: WATER_PLAY_SIGN_FLY_MS,
      easing: easeOut,
    });
  };

  window.setTimeout(() => {
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(run);
      });
    });
  }, 80);
}

export function flyToWaterPlaySignRow(
  map: Map | null | undefined,
  row: WaterPlaySignListItem | null | undefined,
  applyMapViewPadding?: (() => void) | null
): void {
  if (!map || !row) return;
  const g = row.geomJson;
  if (!g || typeof g !== 'object' || !('coordinates' in g)) return;
  const coords = (g as { coordinates?: number[] }).coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return;
  flyToWaterPlaySignLonLat(map, coords[0], coords[1], applyMapViewPadding);
}
