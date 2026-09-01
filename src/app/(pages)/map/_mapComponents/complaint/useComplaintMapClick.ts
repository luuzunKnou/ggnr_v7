'use client';

import { useEffect, useRef } from 'react';
import type { Map, MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import { easeOut } from 'ol/easing';
import { call } from '@/lib/api';
import { prepareMapForPanelAwareNavigation } from '../config/mapAutoNavigation';
import { useMapContext } from '../MapContext';
import { COMP_WMS_LAYER_ID } from './complaintLayerId';

/** d = 300000 * 0.54^z — 재난대응시설·일반 식별과 동일 */
function zoomToBuffer(zoom: number): number {
  return 300_000 * Math.pow(0.54, zoom);
}

/** 목록·지도 선택 시 목표 줌 (재난대응시설과 동일) */
export const COMPLAINT_CLICK_ZOOM = 18;
export const COMPLAINT_FLY_MS = 600;

let complaintFlySeq = 0;
let complaintFlyCompleteListener: (() => void) | null = null;

/** 민원 지도 이동이 끝나면 한 번 호출. 범위 강조를 확대 후에 띄울 때 사용 */
export function subscribeComplaintFlyComplete(fn: () => void): () => void {
  complaintFlyCompleteListener = fn;
  return () => {
    if (complaintFlyCompleteListener === fn) complaintFlyCompleteListener = null;
  };
}

function pickCompKey(row: Record<string, unknown>): number | null {
  const raw = row.comp_key ?? row.compKey ?? row.COMP_KEY;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function center3857FromExtent(
  extent: unknown
): [number, number] | null {
  if (!Array.isArray(extent) || extent.length !== 4) return null;
  const nums = extent.map((v) => Number(v));
  if (!nums.every((n) => Number.isFinite(n))) return null;
  return [(nums[0]! + nums[2]!) / 2, (nums[1]! + nums[3]!) / 2];
}

/**
 * 점 위치가 보이는 지도 중앙이 되도록 이동·확대.
 * 상세 패널 padding 반영 후 실행 (더블 rAF).
 */
export function animateComplaintToCenter3857(
  map: Map,
  center3857: [number, number],
  applyMapViewPadding?: (() => void) | null,
  onComplete?: () => void
) {
  const seq = ++complaintFlySeq;
  const run = () => {
    if (seq !== complaintFlySeq) return;
    prepareMapForPanelAwareNavigation(map, applyMapViewPadding);
    const view = map.getView();
    view.cancelAnimations();
    const currentZoom = view.getZoom();
    const targetZoom = Math.max(
      Number.isFinite(currentZoom) ? (currentZoom as number) : 0,
      COMPLAINT_CLICK_ZOOM
    );
    const resolution = view.getResolutionForZoom(targetZoom);
    view.animate(
      {
        center: center3857,
        resolution,
        duration: COMPLAINT_FLY_MS,
        easing: easeOut,
      },
      () => {
        if (seq !== complaintFlySeq) return;
        complaintFlyCompleteListener?.();
        onComplete?.();
      }
    );
  };
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  });
}

type Props = {
  enabled: boolean;
  /** 식별된 민원 키로 상세 조회·패널 오픈·이동·하이라이트 */
  onSelectCompKey: (compKey: number) => void | Promise<void>;
};

/**
 * 민원관리 패널이 열린 동안 `comp` 레이어만 식별.
 * 클릭 시 상세를 열고, 중심 이동은 상세(extent) 기준으로 호출측에서 수행한다.
 */
export function useComplaintMapClick({ enabled, onSelectCompKey }: Props) {
  const mapContext = useMapContext();
  const onSelectRef = useRef(onSelectCompKey);
  onSelectRef.current = onSelectCompKey;

  useEffect(() => {
    if (!enabled) return;
    const map = mapContext?.mapInstanceRef?.current;
    const mapReady = mapContext?.mapReady;
    if (!mapReady || !map) return;

    const handleClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (!evt.map) return;
      if (mapContext?.spatialDrawRequest) return;
      if (mapContext?.mapMeasureTool) return;
      if (mapContext?.mapDrawInputSuspended) return;
      if (mapContext?.layerRowGeomEdit) return;

      const zoom = evt.map.getView().getZoom() ?? 10;
      const bufferMeters = zoomToBuffer(zoom);
      const [x, y] = evt.coordinate as [number, number];

      try {
        const res = await call('', 'POST', {
          service: 'standardService',
          action: 'identifyFeatures',
          params: {
            x,
            y,
            buffer: bufferMeters,
            tables: [COMP_WMS_LAYER_ID],
            schema: 'layer',
          },
        });
        const data = res?.data ?? res;
        const results = Array.isArray(data?.results) ? data.results : [];
        const first = results[0] as
          | {
              tableName?: string;
              features?: { data?: Record<string, unknown> }[];
            }
          | undefined;
        const table = String(first?.tableName ?? '')
          .trim()
          .toLowerCase();
        if (table !== COMP_WMS_LAYER_ID) return;

        const row = first?.features?.[0]?.data;
        if (!row) return;
        const compKey = pickCompKey(row);
        if (compKey == null) return;

        await onSelectRef.current(compKey);
      } catch {
        /* 클릭 식별 실패는 무시 */
      }
    };

    const key = map.on('singleclick', handleClick as never);
    return () => {
      if (key) unByKey(key);
    };
  }, [
    enabled,
    mapContext?.mapInstanceRef,
    mapContext?.mapReady,
    mapContext?.spatialDrawRequest,
    mapContext?.mapMeasureTool,
    mapContext?.mapDrawInputSuspended,
    mapContext?.layerRowGeomEdit,
  ]);
}
