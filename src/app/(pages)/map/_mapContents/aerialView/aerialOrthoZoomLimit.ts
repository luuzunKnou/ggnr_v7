/** 드론영상 표시 줌 제한 — 타일만 캡하고 View 줌은 유지(overzoom) */
import { VWORLD_MAX_ZOOM_INDEX } from '../../_mapComponents/layerFactory/backgroundLayerFactory';

/** 제한 OFF일 때 타일 최대 줌(변환·기존과 동일) */
export const AERIAL_ORTHO_TILE_FULL_MAX_ZOOM = VWORLD_MAX_ZOOM_INDEX;

/** 제한 ON일 때 타일 최대 줌 — 그 위는 이 줌을 확대만 */
export const AERIAL_ORTHO_TILE_LIMIT_MAX_ZOOM = 16;

export type OrthoZoomLimitSetting = {
  enabled: boolean;
  maxZoom: number;
  displayMaxZoom: number;
  canManage: boolean;
};

export function resolveOrthoDisplayMaxZoom(enabled: boolean, maxZoom?: number): number {
  if (!enabled) return AERIAL_ORTHO_TILE_FULL_MAX_ZOOM;
  const z = Number(maxZoom);
  if (Number.isFinite(z) && z >= 0 && z <= AERIAL_ORTHO_TILE_FULL_MAX_ZOOM) {
    return Math.floor(z);
  }
  return AERIAL_ORTHO_TILE_LIMIT_MAX_ZOOM;
}
