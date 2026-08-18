'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Map as OlMap } from 'ol';
import { isJijukVisibleAtView } from '../layerFactory/boundaryLayerFactory';
import {
  GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
  useSearchBarOffset,
} from '../../searchBarOffsetContext';

type Props = {
  map: OlMap | null;
  mapReady: boolean;
  /** 지적(jijuk) 레이어가 켜져 있을 때 */
  jijukEnabled: boolean;
};

/** 주소검색 입력(350) + 전체레이어끄기 아이콘·간격 */
const SEARCH_CLUSTER_WIDTH_PX = 350 + 8 + 30;
/** 우측 시스템 선택(230) + 테마·로그 아이콘·간격 + right-4 */
const RIGHT_CONTROLS_RESERVE_PX = 16 + 230 + 8 + 30 + 8 + 30 + 8;
const HINT_WIDTH_FALLBACK_PX = 280;
const EDGE_GAP_PX = 12;
/** 주소검색과 같은 줄 top */
const SEARCH_ROW_TOP_PX = 16;

type HintPlacement = {
  top: number;
  left: number;
  /** true면 left는 중심점, translateX(-50%) */
  centered: boolean;
};

/**
 * 지적 ON인데 화면에 지적선이 아직 안 보일 때 상단 안내.
 * - 기본: 보이는 지도 영역 상단 중앙 (좌측 패널에 따라 중심 이동)
 * - 주소검색·시스템선택과 겹치거나 공간 부족 시: 주소검색 아래·왼쪽 정렬
 */
export function CadastralZoomHint({ map, mapReady, jijukEnabled }: Props) {
  const { leftPx, inputBottomPx } = useSearchBarOffset();
  const [show, setShow] = useState(false);
  const [placement, setPlacement] = useState<HintPlacement>({
    top: SEARCH_ROW_TOP_PX,
    left: 0,
    centered: true,
  });
  const hintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapReady || !map || !jijukEnabled) {
      setShow(false);
      return;
    }
    const view = map.getView();
    const update = () => {
      const z = view.getZoom() ?? 0;
      const resolution = view.getResolution() ?? 0;
      setShow(!isJijukVisibleAtView(z, resolution));
    };
    update();
    view.on('change:resolution', update);
    return () => {
      view.un('change:resolution', update);
    };
  }, [map, mapReady, jijukEnabled]);

  useLayoutEffect(() => {
    if (!show) return;

    const updatePlacement = () => {
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const hintW = hintRef.current?.offsetWidth || HINT_WIDTH_FALLBACK_PX;

      // 보이는 지도: 좌측 패널 끝 ~ 우측 여백
      const mapLeft = Math.max(0, leftPx - 20);
      const mapRight = Math.max(mapLeft + 1, vw - 16);
      const centerX = (mapLeft + mapRight) / 2;

      const searchEnd = leftPx + SEARCH_CLUSTER_WIDTH_PX;
      const systemStart = vw - RIGHT_CONTROLS_RESERVE_PX;
      const rowGap = systemStart - searchEnd;

      const centerLeft = centerX - hintW / 2;
      const overlapsSearch = centerLeft < searchEnd + EDGE_GAP_PX;
      const overlapsSystem = centerLeft + hintW > systemStart - EDGE_GAP_PX;
      const notEnoughRowSpace = rowGap < hintW + EDGE_GAP_PX * 2;

      if (notEnoughRowSpace || overlapsSearch || overlapsSystem) {
        setPlacement({
          top: inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
          left: leftPx,
          centered: false,
        });
        return;
      }

      setPlacement({
        top: SEARCH_ROW_TOP_PX,
        left: centerX,
        centered: true,
      });
    };

    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    return () => window.removeEventListener('resize', updatePlacement);
  }, [show, leftPx, inputBottomPx]);

  if (!show) return null;

  return (
    <div
      className="pointer-events-none fixed z-[45]"
      style={{
        top: placement.top,
        left: placement.left,
        transform: placement.centered ? 'translateX(-50%)' : undefined,
      }}
    >
      <div
        ref={hintRef}
        className="whitespace-nowrap rounded-[5px] border border-amber-200 bg-amber-50/95 px-3 py-1.5 text-[12px] font-medium text-amber-900 shadow-md"
      >
        지적이 보이는 축척까지 지도를 확대해 주세요
      </div>
    </div>
  );
}
