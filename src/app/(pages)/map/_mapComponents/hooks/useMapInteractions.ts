import { useRef } from 'react';
import { Map } from 'ol';
import VectorSource from 'ol/source/Vector';
import { useDraw, DrawType } from './useDraw';
import { useSnap } from './useSnap';

/**
 * 지도 인터랙션 통합 관리 훅
 * 여러 인터랙션을 조합하여 관리
 */
export function useMapInteractions(
  map: Map | null,
  activeInteractions: string[]
) {
  // 벡터 소스는 나중에 실제 사용 시 생성
  // 현재는 기본 구조만 제공
  const vectorSourceRef = useRef<VectorSource | null>(null);

  // Draw 인터랙션 활성화 여부 확인
  const drawActive = activeInteractions.some((id) => id.startsWith('draw-'));
  const drawType = activeInteractions.find((id) => id.startsWith('draw-'))
    ?.replace('draw-', '') as DrawType | undefined;

  // Snap 인터랙션 활성화 여부 확인
  const snapActive = activeInteractions.includes('snap');

  // Draw 훅 사용 (실제 구현 시 vectorSource 필요)
  // const drawRef = useDraw(
  //   map,
  //   drawActive && !!drawType,
  //   drawType || 'Point',
  //   vectorSourceRef.current!,
  //   (feature) => {
  //     console.log('Draw completed:', feature);
  //   }
  // );

  // Snap 훅 사용 (실제 구현 시 vectorSource 필요)
  // const snapRef = useSnap(map, snapActive, vectorSourceRef.current);

  // 나중에 실제 구현 시 반환
  return {
    drawRef: useRef(null),
    snapRef: useRef(null),
    vectorSourceRef,
  };
}
