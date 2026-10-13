import type { Map } from 'ol';
import { easeOut } from 'ol/easing';
import { fromLonLat } from 'ol/proj';
import { prepareMapForPanelAwareNavigation } from '../../../_mapComponents/config/mapAutoNavigation';
import type { RadiationShelterListItem } from '@/service/radiationShelterService';

const RADIATION_SHELTER_FLY_ZOOM = 15;
const RADIATION_SHELTER_FLY_MS = 450;

/** 상세 패널 padding 반영 후 좌표로 이동 (리스트·상세 저장 후 공통) */
export function flyToRadiationShelterLonLat(
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
      RADIATION_SHELTER_FLY_ZOOM
    );
    const resolution = view.getResolutionForZoom(targetZoom);
    view.animate({
      center: center3857,
      resolution,
      duration: RADIATION_SHELTER_FLY_MS,
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

export function flyToRadiationShelterRow(
  map: Map | null | undefined,
  row: RadiationShelterListItem | null | undefined,
  applyMapViewPadding?: (() => void) | null
): void {
  if (!map || !row) return;
  const g = row.geomJson;
  if (!g || typeof g !== 'object' || !('coordinates' in g)) return;
  const coords = (g as { coordinates?: number[] }).coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return;
  flyToRadiationShelterLonLat(map, coords[0], coords[1], applyMapViewPadding);
}
