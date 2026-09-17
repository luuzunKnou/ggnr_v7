import type { Map } from 'ol';
import { easeOut } from 'ol/easing';
import GeoJSON from 'ol/format/GeoJSON';
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

function flyToGeomJson(
  map: Map,
  geomJson: unknown,
  applyMapViewPadding?: (() => void) | null
): boolean {
  if (!geomJson || typeof geomJson !== 'object' || !('type' in geomJson)) return false;
  const type = String((geomJson as { type?: unknown }).type ?? '');
  if (type === 'Point') {
    const coords = (geomJson as { coordinates?: number[] }).coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return false;
    flyToWaterPlaySignLonLat(map, coords[0], coords[1], applyMapViewPadding);
    return true;
  }
  try {
    const geom = new GeoJSON().readGeometry(geomJson, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    });
    const extent = geom?.getExtent();
    if (!extent || !extent.every((n) => Number.isFinite(n))) return false;
    const run = () => {
      prepareMapForPanelAwareNavigation(map, applyMapViewPadding);
      const view = map.getView();
      view.cancelAnimations();
      view.fit(extent, {
        duration: WATER_PLAY_SIGN_FLY_MS,
        easing: easeOut,
        maxZoom: WATER_PLAY_SIGN_FLY_ZOOM + 2,
        padding: [48, 48, 48, 48],
      });
    };
    window.setTimeout(() => {
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(run);
        });
      });
    }, 80);
    return true;
  } catch {
    return false;
  }
}

export function flyToWaterPlaySignRow(
  map: Map | null | undefined,
  row: WaterPlaySignListItem | null | undefined,
  applyMapViewPadding?: (() => void) | null
): void {
  if (!map || !row) return;
  flyToGeomJson(map, row.geomJson, applyMapViewPadding);
}

export function flyToWaterPlayChildGeom(
  map: Map | null | undefined,
  geomJson: unknown,
  applyMapViewPadding?: (() => void) | null
): void {
  if (!map) return;
  flyToGeomJson(map, geomJson, applyMapViewPadding);
}
