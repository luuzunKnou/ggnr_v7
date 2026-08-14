'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { MapPin, Pencil, RotateCcw, X } from 'lucide-react';
import type Map from 'ol/Map';
import Feature from 'ol/Feature';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import WKT from 'ol/format/WKT';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import { useMapContext } from '../MapContext';
import { scheduleAnimateMapToCenter3857, scheduleFitMapToExtent3857 } from '../config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../config/mapDefaults';
import { transformCoordinate } from '../services/coordinateService';
import { ANALYSIS_AREA_STYLE } from './analysisArea.style';
import type {
  AnalysisAreaSummaryLike,
  DrawToolbarMapAnchor,
  DrawToolbarScreenPlacement,
} from './analysisArea.types';

export type { DrawToolbarMapAnchor, DrawToolbarScreenPlacement } from './analysisArea.types';

/** 제곱미터 표시용 포맷 (천 단위 구분 + ㎡) */
export function formatAreaSqm(areaSqm: number): string {
  return `약 ${areaSqm.toLocaleString('ko-KR')} ㎡`;
}

/**
 * 5181 평면 WKT → 제곱미터(㎡).
 * EPSG:5181은 미터 단위 평면 좌표라 (변환 없이 읽은) geometry.getArea()가 곧 m².
 * 지도 표시용 3857로 읽으면 면적이 왜곡되므로 면적 계산에는 5181 원본을 쓴다.
 */
export function computeAreaSqmFromWkt5181(wkt5181: string): number {
  try {
    const geom = new WKT().readGeometry(wkt5181);
    const areaSqm =
      geom instanceof Polygon || geom instanceof MultiPolygon ? geom.getArea() : 0;
    if (!Number.isFinite(areaSqm) || areaSqm <= 0) return 0;
    return Math.round(areaSqm);
  } catch {
    return 0;
  }
}

/** 시군구 경계(850) 위에 확정 영역을 강조 */
const AREA_LAYER_Z = 860;

/**
 * 확정된 분석 영역(도형·행정경계 WKT)을 지도에 강조 표시하고 해당 영역으로 화면을 맞춘다.
 * fit 시 좌측 패널 폭을 view.padding에 반영해 패널 열림과 이동을 한 번에 처리한다.
 * @param layerFlag 레이어 식별 키 (기본 parcelAnalysisArea · 변동이력은 changeHistoryArea)
 */
export function useAnalysisAreaLayer(
  active: boolean,
  wkt5181: string | null,
  options?: { layerFlag?: string }
) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const layerFlag = options?.layerFlag ?? 'parcelAnalysisArea';

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !active || !wkt5181) return;

    let geom;
    try {
      geom = new WKT().readGeometry(wkt5181, {
        dataProjection: 'EPSG:5181',
        featureProjection: 'EPSG:3857',
      });
    } catch {
      return;
    }

    const source = new VectorSource({ features: [new Feature(geom)] });
    const layer = new VectorLayer({ source, style: ANALYSIS_AREA_STYLE, zIndex: AREA_LAYER_Z });
    layer.set(layerFlag, true);
    map.addLayer(layer);
    layerRef.current = layer;

    scheduleFitMapToExtent3857(map, geom.getExtent(), {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });

    return () => {
      map.removeLayer(layer);
      if (layerRef.current === layer) layerRef.current = null;
    };
  }, [active, wkt5181, layerFlag, mapContext?.mapInstanceRef, mapContext?.applyMapViewPaddingRef]);
}

/** @deprecated useAnalysisAreaLayer — 필지·변동이력 호환 */
export const useParcelAnalysisAreaLayer = useAnalysisAreaLayer;

/**
 * 시군구가 뷰포트에서 차지할 목표 비율.
 * 1.0 = 화면에 딱 맞춤, 1.0 초과 = 중심 좌표 기준 더 확대(가장자리 크롭).
 * (1.5 = 시군구가 화면의 약 150% → 중앙만 크게)
 * fit(contain)은 100% 초과가 안 되므로 중심+줌 계산 방식으로 처리한다.
 */
const TARGET_VIEWPORT_FILL = 1.5;

/**
 * 진입 시 시군구 맞춤을 건너뛸 최소 줌.
 * 이미 동네·필지 스케일(16~19)이면 강제 축소하지 않고 현재 뷰를 유지한다.
 */
const SKIP_PROJECT_FIT_MIN_ZOOM = 16;

function extent5181To3857(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): [number, number, number, number] | null {
  const corners: [number, number][] = [
    [minX, minY],
    [minX, maxY],
    [maxX, minY],
    [maxX, maxY],
  ];
  const transformed = corners.map(
    (c) => transformCoordinate(c, 'EPSG:5181', 'EPSG:3857') as [number, number]
  );
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const [x, y] of transformed) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    xmin = Math.min(xmin, x);
    ymin = Math.min(ymin, y);
    xmax = Math.max(xmax, x);
    ymax = Math.max(ymax, y);
  }
  return [xmin, ymin, xmax, ymax];
}

/**
 * 필지분석·변동이력 진입 시 사업 시군구(schema.emd 전체) 범위를 중심 기준으로 맞춤.
 * 현재 줌이 16 이상이면 맞춤을 생략하고 화면을 유지한다.
 */
export function useAnalysisProjectMapZoom() {
  const mapContext = useMapContext();
  const zoomedRef = useRef(false);

  const fitProjectEmdExtent = useCallback(async () => {
    if (zoomedRef.current) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    const view = map.getView();
    const currentZoom = view.getZoom();
    // 확대된 상태(16+)에서는 시군구로 강제 축소하지 않음 — 필지·변동이력 공용
    if (currentZoom != null && Number.isFinite(currentZoom) && currentZoom >= SKIP_PROJECT_FIT_MIN_ZOOM) {
      zoomedRef.current = true;
      return;
    }

    try {
      const res = await call('', 'POST', {
        service: 'devTestService',
        action: 'getEmdExtent5181',
        params: {},
      });
      const data = res?.data ?? res;
      const minX = Number(data?.minX);
      const maxX = Number(data?.maxX);
      const minY = Number(data?.minY);
      const maxY = Number(data?.maxY);
      if (![minX, maxX, minY, maxY].every(Number.isFinite)) return;

      const ext3857 = extent5181To3857(minX, minY, maxX, maxY);
      if (!ext3857) return;

      const [xmin, ymin, xmax, ymax] = ext3857;
      const center: [number, number] = [(xmin + xmax) / 2, (ymin + ymax) / 2];
      const extentWidth = xmax - xmin;
      const extentHeight = ymax - ymin;

      const size = map.getSize();
      if (!size || extentWidth <= 0 || extentHeight <= 0) return;

      // 좌측 패널이 없는 진입 단계 — 사이드바 패딩만 가시영역에서 제외
      const paddingLeft = mapContext?.mapPaddingLeft ?? 0;
      const usableWidth = Math.max(1, size[0] - paddingLeft);
      const usableHeight = Math.max(1, size[1]);

      // 시군구의 큰 변이 가시영역의 (목표 비율)을 차지하도록 해상도 계산
      const targetResolution = Math.max(
        extentWidth / (usableWidth * TARGET_VIEWPORT_FILL),
        extentHeight / (usableHeight * TARGET_VIEWPORT_FILL)
      );

      const rawZoom = view.getZoomForResolution(targetResolution);
      if (rawZoom == null || !Number.isFinite(rawZoom)) return;
      const zoom = Math.min(rawZoom, MAP_AUTO_NAV_MAX_ZOOM);

      scheduleAnimateMapToCenter3857(map, center, zoom, {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      });
      zoomedRef.current = true;
    } catch {
      /* 맞춤 실패해도 진행 — 사용자가 수동으로 이동 가능 */
    }
  }, [mapContext?.mapInstanceRef, mapContext?.applyMapViewPaddingRef, mapContext?.mapPaddingLeft]);

  const resetZoomFlag = useCallback(() => {
    zoomedRef.current = false;
  }, []);

  return { fitProjectEmdExtent, resetZoomFlag, zoomedRef };
}

/** @deprecated useAnalysisProjectMapZoom — 필지·변동이력 호환 */
export const useParcelAnalysisMapZoom = useAnalysisProjectMapZoom;

const GAP_ABOVE_SHAPE = 10;
const VIEWPORT_PAD = 8;

function isValidMapCoord(coord: [number, number] | undefined): coord is [number, number] {
  return !!coord && coord.length >= 2 && Number.isFinite(coord[0]) && Number.isFinite(coord[1]);
}

function coordToViewport(
  map: Map,
  coord: [number, number]
): { left: number; top: number } | null {
  if (!isValidMapCoord(coord)) return null;
  const mapEl = map.getTargetElement();
  if (!mapEl) return null;
  const pixel = map.getPixelFromCoordinate(coord);
  if (!pixel || pixel.length < 2) return null;
  if (!Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) return null;
  const rect = mapEl.getBoundingClientRect();
  return {
    left: rect.left + pixel[0],
    top: rect.top + pixel[1],
  };
}

function clampToViewport(
  left: number,
  top: number,
  width: number,
  height: number
): { left: number; top: number } {
  const maxLeft = Math.max(VIEWPORT_PAD, window.innerWidth - width - VIEWPORT_PAD);
  const maxTop = Math.max(VIEWPORT_PAD, window.innerHeight - height - VIEWPORT_PAD);
  return {
    left: Math.min(Math.max(VIEWPORT_PAD, left), maxLeft),
    top: Math.min(Math.max(VIEWPORT_PAD, top), maxTop),
  };
}

function resolvePlacement(
  map: Map,
  anchor: DrawToolbarMapAnchor,
  size: { width: number; height: number }
): DrawToolbarScreenPlacement | null {
  const point = coordToViewport(map, anchor.topCenter);
  if (!point) return null;

  const rawLeft = point.left - size.width / 2;
  const rawTop = point.top - size.height - GAP_ABOVE_SHAPE;
  const clamped = clampToViewport(rawLeft, rawTop, size.width, size.height);
  return { left: clamped.left, top: clamped.top };
}

/** 도형 bbox 상단 중앙 위에 플로팅 바 배치 */
export function useDrawToolbarPosition(
  mapRef: RefObject<Map | null>,
  anchor: DrawToolbarMapAnchor | null,
  toolbarRef: RefObject<HTMLElement | null>,
  active: boolean
): DrawToolbarScreenPlacement | null {
  const [placement, setPlacement] = useState<DrawToolbarScreenPlacement | null>(null);

  useEffect(() => {
    if (!active || !anchor) {
      return;
    }

    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      const el = toolbarRef.current;
      const width = el?.offsetWidth ?? 420;
      const height = el?.offsetHeight ?? 48;
      setPlacement(resolvePlacement(map, anchor, { width, height }));
    };

    update();
    const ro = toolbarRef.current ? new ResizeObserver(update) : null;
    if (toolbarRef.current && ro) ro.observe(toolbarRef.current);

    map.on('moveend', update);
    map.on('postrender', update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);

    return () => {
      ro?.disconnect();
      map.un('moveend', update);
      map.un('postrender', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [active, anchor, mapRef, toolbarRef]);

  if (!active || !anchor) return null;
  return placement;
}

/** @deprecated useDrawToolbarPosition — 필지·변동이력 호환 */
export const useParcelAnalysisDrawToolbarPosition = useDrawToolbarPosition;

type Props = {
  area: AnalysisAreaSummaryLike | null;
  /** 영역 확정 후 초기화 등으로 area만 비운 상태 */
  areaCleared?: boolean;
  onChangeClick: () => void;
  onClearClick: () => void;
  onSpecifyClick: () => void;
};

type SummaryRow = { label: string; value: string; highlight?: boolean };

function buildRows(area: AnalysisAreaSummaryLike): SummaryRow[] {
  const rows: SummaryRow[] = [
    { label: '방식', value: area.method === 'boundary' ? '행정경계' : '도형 그리기' },
    { label: '대상', value: area.targetLabel, highlight: true },
  ];
  if (area.summaryDetail) {
    rows.push({ label: '상세', value: area.summaryDetail });
  }
  if (area.areaSqm > 0) {
    rows.push({ label: '면적', value: `약 ${area.areaSqm.toLocaleString('ko-KR')} ㎡` });
  }
  return rows;
}

export function AnalysisAreaSummary({
  area,
  areaCleared = false,
  onChangeClick,
  onClearClick,
  onSpecifyClick,
}: Props) {
  const rows = area ? buildRows(area) : [];

  return (
    <div className="border-b border-border">
      <div className="px-4 py-2">
        <span className="text-[12px] font-semibold text-muted-foreground">분석 영역</span>
      </div>

      <div className="px-3 pb-3">
        {area ? (
          <div className="overflow-hidden rounded border border-border">
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={cn('flex items-stretch', index !== rows.length - 1 && 'border-b border-border')}
              >
                <div className="flex w-[64px] shrink-0 items-start bg-muted px-2.5 py-1.5">
                  <span className="text-[11px] leading-snug text-muted-foreground">{row.label}</span>
                </div>
                <div className="flex min-w-0 flex-1 items-start px-2.5 py-1.5">
                  <span
                    className={cn(
                      'break-words text-[11px] leading-snug',
                      row.highlight ? 'font-medium text-primary' : 'text-muted-foreground'
                    )}
                  >
                    {row.value}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : areaCleared ? (
          <p className="text-[11px] text-muted-foreground">분석 영역이 초기화되었습니다. 다시 지정해 주세요.</p>
        ) : (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">분석 영역을 먼저 지정하세요.</p>
        )}

        {area ? (
          <div className="mt-2 flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 flex-1 gap-1 border-primary/40 bg-primary/5 px-2 text-[10px] font-medium text-primary hover:bg-primary/10 hover:text-primary"
              onClick={onChangeClick}
            >
              <Pencil className="size-3 shrink-0" aria-hidden />
              영역 변경
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 flex-1 gap-1 border-amber-300/80 bg-amber-50 px-2 text-[11px] font-medium text-amber-900 hover:bg-amber-100 hover:text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60 dark:hover:text-amber-100"
              onClick={onClearClick}
            >
              <RotateCcw className="size-3 shrink-0" aria-hidden />
              재설정
            </Button>
          </div>
        ) : areaCleared ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-7 w-full gap-1 border-primary/40 bg-primary/5 px-2 text-[10px] font-medium text-primary hover:bg-primary/10 hover:text-primary"
            onClick={onSpecifyClick}
          >
            <MapPin className="size-3 shrink-0" aria-hidden />
            영역 지정
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type DrawToolbarActionsProps = {
  drawPhase: 'drawing' | 'editing';
  confirmDraw: () => void;
  redrawShape: () => void;
  cancelDraw: () => void;
  /** 필지: 사업구역 밖이면 true. 변동이력 등은 생략(기본 false) */
  applyDisabled?: boolean;
};

/** 도형 그리기·편집 지도 위 알약 툴바 (필지분석·변동이력 공용) */
export function DrawToolbarActions({
  drawPhase,
  confirmDraw,
  redrawShape,
  cancelDraw,
  applyDisabled = false,
}: DrawToolbarActionsProps) {
  const pillShell =
    'pointer-events-auto flex max-w-[min(100vw-16px,560px)] flex-wrap items-center gap-2 rounded-full border border-border bg-background/95 py-2 pr-2 pl-4 text-foreground shadow-lg backdrop-blur';

  if (drawPhase === 'drawing') {
    return (
      <div className={pillShell}>
        <span className="text-[12px] leading-snug sm:text-sm">지도에 도형을 그리세요.</span>
        <button
          type="button"
          onClick={cancelDraw}
          title="취소"
          aria-label="취소"
          className="flex cursor-pointer items-center gap-1 rounded-full bg-muted py-1 pr-2.5 pl-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:text-sm"
        >
          <X className="size-3.5" />
          취소
        </button>
      </div>
    );
  }

  return (
    <div className={pillShell}>
      <span className="text-[12px] leading-snug sm:text-sm">꼭짓점을 드래그해 모양을 수정하세요.</span>
      <button
        type="button"
        onClick={confirmDraw}
        disabled={applyDisabled}
        title="적용"
        aria-label="적용"
        className="rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:bg-muted enabled:cursor-pointer sm:text-sm"
      >
        적용
      </button>
      <button
        type="button"
        onClick={redrawShape}
        title="다시 그리기"
        aria-label="다시 그리기"
        className="cursor-pointer rounded-full bg-muted px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:text-sm"
      >
        다시 그리기
      </button>
      <button
        type="button"
        onClick={cancelDraw}
        title="취소"
        aria-label="취소"
        className="flex cursor-pointer items-center gap-1 rounded-full bg-muted py-1 pr-2.5 pl-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:text-sm"
      >
        <X className="size-3.5" />
        취소
      </button>
    </div>
  );
}

/** @deprecated AnalysisAreaSummary — 필지·변동이력 호환 */
export const ParcelAnalysisAreaSummary = AnalysisAreaSummary;
