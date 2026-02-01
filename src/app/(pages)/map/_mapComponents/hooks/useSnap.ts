import { useEffect, useRef } from 'react';
import { Map } from 'ol';
import { Snap } from 'ol/interaction';
import VectorSource from 'ol/source/Vector';

/**
 * Snap 인터랙션 훅
 * 그리기나 수정 시 다른 피처에 스냅하는 기능
 */
export function useSnap(
  map: Map | null,
  isActive: boolean,
  source: VectorSource | null
) {
  const snapRef = useRef<Snap | null>(null);

  useEffect(() => {
    if (!map || !isActive || !source) return;

    const snap = new Snap({ source });
    map.addInteraction(snap);
    snapRef.current = snap;

    return () => {
      map.removeInteraction(snap);
      snapRef.current = null;
    };
  }, [map, isActive, source]);

  return snapRef;
}
