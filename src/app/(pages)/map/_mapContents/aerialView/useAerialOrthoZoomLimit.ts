'use client';

import { useCallback, useEffect, useState } from 'react';
import { call } from '@/lib/api';
import {
  AERIAL_ORTHO_TILE_FULL_MAX_ZOOM,
  AERIAL_ORTHO_TILE_LIMIT_MAX_ZOOM,
  type OrthoZoomLimitSetting,
  resolveOrthoDisplayMaxZoom,
} from './aerialOrthoZoomLimit';

const POLL_MS = 20_000;

const DEFAULT: OrthoZoomLimitSetting = {
  enabled: false,
  maxZoom: AERIAL_ORTHO_TILE_LIMIT_MAX_ZOOM,
  displayMaxZoom: AERIAL_ORTHO_TILE_FULL_MAX_ZOOM,
  canManage: false,
};

/** 공통 드론영상 타일 표시 최대줌 + 관리자 토글 상태 */
export function useAerialOrthoZoomLimit() {
  const [setting, setSetting] = useState<OrthoZoomLimitSetting>(DEFAULT);

  const refresh = useCallback(async () => {
    try {
      const res = await call('', 'POST', {
        service: 'aerialOrthoService',
        action: 'getOrthoZoomLimitSetting',
        params: {},
      });
      if (!res?.success) return;
      const d = (res.data ?? res) as Partial<OrthoZoomLimitSetting>;
      const enabled = Boolean(d.enabled);
      const maxZoom = Number(d.maxZoom);
      setSetting({
        enabled,
        maxZoom: Number.isFinite(maxZoom) ? maxZoom : AERIAL_ORTHO_TILE_LIMIT_MAX_ZOOM,
        displayMaxZoom:
          typeof d.displayMaxZoom === 'number'
            ? d.displayMaxZoom
            : resolveOrthoDisplayMaxZoom(enabled, maxZoom),
        canManage: Boolean(d.canManage),
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      const res = await call('', 'POST', {
        service: 'aerialOrthoService',
        action: 'setOrthoZoomLimitSetting',
        params: { enabled },
      });
      if (!res?.success) {
        throw new Error(
          String(
            (res && typeof res === 'object' && 'error' in res && (res as { error?: string }).error) ||
              '설정을 저장하지 못했습니다.'
          )
        );
      }
      const d = (res.data ?? res) as Partial<OrthoZoomLimitSetting>;
      const nextEnabled = Boolean(d.enabled);
      const maxZoom = Number(d.maxZoom);
      setSetting({
        enabled: nextEnabled,
        maxZoom: Number.isFinite(maxZoom) ? maxZoom : AERIAL_ORTHO_TILE_LIMIT_MAX_ZOOM,
        displayMaxZoom:
          typeof d.displayMaxZoom === 'number'
            ? d.displayMaxZoom
            : resolveOrthoDisplayMaxZoom(nextEnabled, maxZoom),
        canManage: true,
      });
    },
    []
  );

  return { ...setting, refresh, setEnabled };
}
