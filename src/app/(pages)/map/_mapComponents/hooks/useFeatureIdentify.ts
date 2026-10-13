import { useEffect, useRef, useState, useCallback } from 'react';
import type { Map, MapBrowserEvent } from 'ol';
import Overlay from 'ol/Overlay';
import { unByKey } from 'ol/Observable';
import { call } from '@/lib/api';
import { getLegendGraphicUrl } from '../layerFactory/serviceLayerFactory';

export interface IdentifyFeatureItem {
  titleValue: string;
  data: Record<string, unknown>;
  /** 통합검색: 키워드와 맞은 첫 속성(서버가 채움) */
  keywordMatch?: {
    fieldName: string;
    fieldKorName?: string;
    valuePreview: string;
  };
}

export interface IdentifyLayerResult {
  tableName: string;
  korName: string;
  titleField: string | null;
  /** 분할 레이어 식별 결과(부모 테이블+CQL). 목록·자동 패널에서 부모보다 우선 */
  isSplitLayer?: boolean;
  features: IdentifyFeatureItem[];
}

export interface IdentifyPopupState {
  coordinate: [number, number];
  results: IdentifyLayerResult[];
  /** 시설관리 검색 등 — 다중 식별 목록 헤더 문구 오버라이드 */
  listHeaderLabel?: string;
}

/** d = 300000 * 0.54^z  (z = zoom level) */
function zoomToBuffer(zoom: number): number {
  return 300_000 * Math.pow(0.54, zoom);
}

export function getLegendUrl(layerName: string): string {
  return getLegendGraphicUrl(layerName, layerName);
}

/**
 * 지도 클릭 시 해당 좌표에서 모든 visible layer 테이블의 교차 도형을 검색.
 * 버퍼는 줌 레벨에 비례하여 자동 계산: d = 300,000 × 0.54^z (미터)
 *
 * 반환값:
 * - popupState: 팝업에 표시할 데이터 (null이면 팝업 닫힘)
 * - overlayRef: OL Overlay 인스턴스 (외부에서 DOM element 연결용)
 * - closePopup: 팝업 닫기 함수
 */
export function useFeatureIdentify(
  map: Map | null,
  mapReady: boolean,
  visibleLayerNames: Set<string>,
  /** true이면 지도 클릭 식별(identifyFeatures)을 수행하지 않음 (예: CCTV 패널 열림) */
  identifyDisabled = false,
  /**
   * WMS와 동일 레이어별 속성 필터 (예: 하천기본계획 선택 하천 river_name).
   * 화면에 안 보이는 도형이 식별되지 않도록 서버 identify에 함께 전달.
   */
  tableFilters: Record<string, string> | null = null,
) {
  const visibleRef = useRef(visibleLayerNames);
  visibleRef.current = visibleLayerNames;
  const disabledRef = useRef(identifyDisabled);
  disabledRef.current = identifyDisabled;
  const tableFiltersRef = useRef(tableFilters);
  tableFiltersRef.current = tableFilters;

  const [popupState, setPopupState] = useState<IdentifyPopupState | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const popupElRef = useRef<HTMLDivElement | null>(null);

  const closePopup = useCallback(() => {
    setPopupState(null);
    overlayRef.current?.setPosition(undefined);
  }, []);

  // Overlay 초기화
  useEffect(() => {
    if (!mapReady || !map) return;
    const el = document.createElement('div');
    popupElRef.current = el;

    const overlay = new Overlay({
      element: el,
      positioning: 'top-left',
      stopEvent: true,
      offset: [12, 12],
    });
    map.addOverlay(overlay);
    overlayRef.current = overlay;

    return () => {
      map.removeOverlay(overlay);
      overlayRef.current = null;
      popupElRef.current = null;
    };
  }, [map, mapReady]);

  const handleClick = useCallback(
    async (evt: MapBrowserEvent<PointerEvent>) => {
      if (!evt.map) return;
      if (disabledRef.current) {
        closePopup();
        return;
      }
      const tables = Array.from(visibleRef.current);
      if (tables.length === 0) {
        closePopup();
        return;
      }

      const zoom = evt.map.getView().getZoom() ?? 10;
      const bufferMeters = zoomToBuffer(zoom);
      const coord = evt.coordinate as [number, number];
      const [x, y] = coord;
      const filters = tableFiltersRef.current;

      try {
        const res = await call('', 'POST', {
          service: 'standardService',
          action: 'identifyFeatures',
          params: {
            x,
            y,
            buffer: bufferMeters,
            tables,
            schema: 'layer',
            ...(filters && Object.keys(filters).length > 0 ? { tableFilters: filters } : {}),
          },
        });
        const data = res?.data ?? res;
        const results: IdentifyLayerResult[] = Array.isArray(data?.results) ? data.results : [];

        if (results.length > 0) {
          setPopupState({ coordinate: coord, results });
          overlayRef.current?.setPosition(coord);
        } else {
          closePopup();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[FeatureIdentify] 검색 실패 — ${msg}`);
        closePopup();
      }
    },
    [closePopup],
  );

  useEffect(() => {
    if (identifyDisabled) closePopup();
  }, [identifyDisabled, closePopup]);

  useEffect(() => {
    if (!mapReady || !map) return;
    const key = map.on('singleclick', handleClick as never);
    return () => { if (key) unByKey(key); };
  }, [map, mapReady, handleClick]);

  return { popupState, popupElRef, closePopup };
}
