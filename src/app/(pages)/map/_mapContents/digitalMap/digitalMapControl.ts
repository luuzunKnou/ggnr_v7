'use client';

import { useEffect, useState } from 'react';
import { MountainSnow } from 'lucide-react';
import { call } from '@/lib/api';
import type { MapControlGroup } from '../../_mapComponents/mapControlPanel/mapControlPanel';
import { DIGITAL_MAP_CONTROL_ID } from './digitalMapConfig';

export { DIGITAL_MAP_CONTROL_ID };

const ANCHOR_CONTROL_ID = 'thematic-map';

/** 주제도 바로 아래에 «수치지형도» 버튼을 끼운다 */
export function withDigitalMapControl(groups: MapControlGroup[], enabled: boolean): MapControlGroup[] {
  if (!enabled) return groups;
  return groups.map((g) => {
    const idx = g.items.findIndex((it) => it.id === ANCHOR_CONTROL_ID);
    if (idx < 0) return g;
    if (g.items.some((it) => it.id === DIGITAL_MAP_CONTROL_ID)) return g;
    const items = [...g.items];
    items.splice(idx + 1, 0, {
      id: DIGITAL_MAP_CONTROL_ID,
      icon: MountainSnow,
      label: '수치지형도',
      allowMultiple: true,
      labelEllipsis: false,
      labelLetterSpacing: -0.3,
    });
    return { ...g, items };
  });
}

let cachedAvailable: boolean | null = null;

/** 서버에 수치지형도 폴더가 있는지 — 세션당 한 번 */
export function useDigitalMapAvailable(): boolean {
  const [available, setAvailable] = useState(cachedAvailable ?? false);

  useEffect(() => {
    if (cachedAvailable != null) return;
    let cancelled = false;
    void call('', 'POST', { service: 'digitalMapService', action: 'available', params: {} })
      .then((res) => {
        const data = (res?.data ?? res) as { available?: boolean } | undefined;
        cachedAvailable = Boolean(res?.success && data?.available);
        if (!cancelled) setAvailable(cachedAvailable);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}
