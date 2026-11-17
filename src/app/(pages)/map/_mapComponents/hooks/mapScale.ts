import type Map from 'ol/Map';
import { VIEW_RESOLUTIONS_3857 } from '../config/mapDefaults';

/** 축척 막대 너비(px) — CSS `.ggnr-scale-bar-inner` 와 동일 */
export const SCALE_BAR_PX = 100;

/** 줌 1일 때 막대가 나타내는 거리(m). 7864320 / 2^(zoom-1) */
const SCALE_ZOOM_BASE_M = 7_864_320;

export type ScaleUnit = 'km' | 'm' | 'mm';

export function formatScaleFromZoom(zoom: number): string | null {
  if (!Number.isFinite(zoom)) return null;
  const meters = SCALE_ZOOM_BASE_M / Math.pow(2, zoom - 1);
  return formatScaleMeters(meters);
}

export function formatScaleMeters(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)}km`;
  if (meters < 1) return `${(meters * 1000).toFixed(2)}mm`;
  return `${meters.toFixed(2)}m`;
}

export function scaleMetersFromZoom(zoom: number): number | null {
  if (!Number.isFinite(zoom)) return null;
  return SCALE_ZOOM_BASE_M / Math.pow(2, zoom - 1);
}

export function zoomFromScaleMeters(meters: number): number {
  return 1 + Math.log2(SCALE_ZOOM_BASE_M / meters);
}

export function formatScaleFromMap(map: Map | null | undefined): string | null {
  const zoom = map?.getView().getZoom();
  return zoom == null ? null : formatScaleFromZoom(zoom);
}

function unitOf(label: string | null | undefined): ScaleUnit {
  const s = String(label ?? '').toLowerCase();
  if (s.endsWith('km')) return 'km';
  if (s.endsWith('mm')) return 'mm';
  return 'm';
}

/**
 * «3.84km» · «3840m» · «5» (단위 생략 시 현재 표시 단위) 를 미터로.
 */
export function parseScaleInput(raw: string, currentLabel?: string | null): number | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(/^([\d.]+)(km|mm|m)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] as ScaleUnit | undefined) ?? unitOf(currentLabel);
  if (unit === 'km') return n * 1000;
  if (unit === 'mm') return n / 1000;
  return n;
}

export function applyScaleMeters(map: Map, meters: number): boolean {
  if (!Number.isFinite(meters) || meters <= 0) return false;
  const view = map.getView();
  const minRes = VIEW_RESOLUTIONS_3857[VIEW_RESOLUTIONS_3857.length - 1] ?? 0.04;
  const maxRes = VIEW_RESOLUTIONS_3857[0] ?? 156543;
  const zoom = zoomFromScaleMeters(meters);
  if (!Number.isFinite(zoom)) return false;
  view.setConstrainResolution(false);
  view.setZoom(zoom);
  const res = view.getResolution();
  if (res != null && (res < minRes || res > maxRes)) {
    view.setResolution(Math.min(maxRes, Math.max(minRes, res)));
  }
  return true;
}
