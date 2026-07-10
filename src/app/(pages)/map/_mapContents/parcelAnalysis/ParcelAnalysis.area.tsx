'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { MapPin, Pencil, RotateCcw } from 'lucide-react';
import type Map from 'ol/Map';
import Feature from 'ol/Feature';
import Draw, { createBox, type DrawEvent } from 'ol/interaction/Draw';
import Modify, { type ModifyEvent } from 'ol/interaction/Modify';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import WKT from 'ol/format/WKT';
import Polygon, { fromCircle } from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import type Circle from 'ol/geom/Circle';
import type { Geometry } from 'ol/geom';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import { useMapContext } from '../../_mapComponents/MapContext';
import { scheduleAnimateMapToCenter3857, scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults';
import { transformCoordinate } from '../../_mapComponents/services/coordinateService';
import { formatBoundaryAreaSummary } from './ParcelAnalysis.boundary';
import { useParcelAnalysis } from './parcelAnalysisContext';
import {
  PARCEL_ANALYSIS_AREA_STYLE,
  PARCEL_ANALYSIS_DRAW_STYLE,
} from './parcelAnalysis.mapStyle';
import type {
  BoundaryEmdSelection,
  DrawProjectScope,
  DrawTool,
  ParcelAnalysisArea,
} from './parcelAnalysis.types';

/** 지도 좌표(EPSG:3857) — 도형 bbox 상단 중앙 */
export type DrawToolbarMapAnchor = {
  topCenter: [number, number];
};

export type DrawToolbarScreenPlacement = {
  left: number;
  top: number;
};

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

export function useParcelAnalysisArea() {
  const [area, setArea] = useState<ParcelAnalysisArea | null>(null);
  const [boundaryDraft, setBoundaryDraft] = useState<BoundaryEmdSelection[]>([]);

  const applyDrawArea = useCallback((wkt5181: string) => {
    const areaSqm = computeAreaSqmFromWkt5181(wkt5181);
    setArea({
      method: 'draw',
      summaryLabel: `직접 그린 영역 · ${formatAreaSqm(areaSqm)}`,
      // 겹치는 읍/면/동·구역 위치는 비동기 조회 후 setDrawAreaLookup으로 갱신
      targetLabel: '확인 중…',
      wkt: wkt5181,
      itemCount: 1,
      areaSqm,
    });
  }, []);

  /** 도형과 겹치는 읍/면/동·사업 구역 위치 조회 결과로 대상 라벨 갱신 (조회 시점 wkt가 그대로일 때만) */
  const setDrawAreaLookup = useCallback(
    (wkt5181: string, targetLabel: string, drawProjectScope?: DrawProjectScope) => {
      setArea((prev) =>
        prev && prev.method === 'draw' && prev.wkt === wkt5181
          ? { ...prev, targetLabel, drawProjectScope }
          : prev
      );
    },
    []
  );

  const applyBoundaryArea = useCallback(
    (selection: BoundaryEmdSelection[], wkt5181: string) => {
      setBoundaryDraft(selection);
      const areaSqm = computeAreaSqmFromWkt5181(wkt5181);
      const { itemCount, summaryLabel, summaryDetail, targetLabel } = formatBoundaryAreaSummary(
        selection,
        areaSqm
      );
      setArea({
        method: 'boundary',
        summaryLabel,
        summaryDetail,
        targetLabel,
        wkt: wkt5181,
        itemCount,
        areaSqm,
      });
    },
    []
  );

  const clearArea = useCallback(() => {
    setArea(null);
  }, []);

  return {
    area,
    boundaryDraft,
    applyDrawArea,
    setDrawAreaLookup,
    applyBoundaryArea,
    clearArea,
    setBoundaryDraft,
  };
}

/** 시군구 경계(850) 위에 확정 영역을 강조 */
const AREA_LAYER_Z = 860;

/**
 * 확정된 분석 영역(도형·행정경계 WKT)을 지도에 강조 표시하고 해당 영역으로 화면을 맞춘다.
 * fit 시 좌측 패널 폭을 view.padding에 반영해 패널 열림과 이동을 한 번에 처리한다.
 */
export function useParcelAnalysisAreaLayer(active: boolean, wkt5181: string | null) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

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
    const layer = new VectorLayer({ source, style: PARCEL_ANALYSIS_AREA_STYLE, zIndex: AREA_LAYER_Z });
    layer.set('parcelAnalysisArea', true);
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
  }, [active, wkt5181, mapContext?.mapInstanceRef, mapContext?.applyMapViewPaddingRef]);
}

/**
 * 시군구가 뷰포트에서 차지할 목표 비율.
 * 1.0 = 화면에 딱 맞춤, 1.0 초과 = 중심 좌표 기준 더 확대(가장자리 크롭).
 * (1.5 = 시군구가 화면의 약 150% → 중앙만 크게)
 * fit(contain)은 100% 초과가 안 되므로 중심+줌 계산 방식으로 처리한다.
 */
const TARGET_VIEWPORT_FILL = 1.5;

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
 * 필지분석 진입 시 사업 시군구(schema.emd 전체) 범위를 중심 좌표 기준으로 확대.
 * 좌측 패널이 없는 진입 단계에서 대상 지역을 크게 보여주기 위한 용도.
 */
export function useParcelAnalysisMapZoom() {
  const mapContext = useMapContext();
  const zoomedRef = useRef(false);

  const fitProjectEmdExtent = useCallback(async () => {
    if (zoomedRef.current) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

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
      const view = map.getView();
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
export function useParcelAnalysisDrawToolbarPosition(
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

/** 도형 bbox 상단 중앙 (EPSG:3857) */
function extentTopCenter(geom: Geometry): [number, number] {
  const ext = geom.getExtent();
  return [(ext[0] + ext[2]) / 2, ext[3]];
}

function buildToolbarAnchorFromGeom(geom: Geometry): DrawToolbarMapAnchor {
  const topCenter = extentTopCenter(geom);
  return { topCenter };
}

/** 확정 영역(860)보다 위 — 그리는 중 도형 */
const DRAW_LAYER_Z = 870;

/** 지도(3857) geometry → 5181 WKT. 원은 WKT 미지원이라 다각형으로 변환. */
function toWkt5181(geom: Geometry): string {
  const base = geom.getType() === 'Circle' ? fromCircle(geom as Circle) : geom;
  const cloned = base.clone();
  cloned.transform('EPSG:3857', 'EPSG:5181');
  return new WKT().writeGeometry(cloned);
}

/**
 * 필지분석 도형 그리기+편집. drawTool 세션이 켜지면 지도에 Draw를 붙이고,
 * 다 그리면 Modify(꼭짓점 편집)로 전환한다. 확정/취소는 context가 담당.
 */
export function useParcelAnalysisDraw() {
  const mapContext = useMapContext();
  const { drawTool, drawPhase, drawWktRef, setDrawPhase, previewDrawArea, setDrawToolbarAnchor, clearDrawToolbarAnchor } =
    useParcelAnalysis();

  const attachDrawRef = useRef<((tool: DrawTool) => void) | null>(null);
  const attachModifyRef = useRef<(() => void) | null>(null);

  // 세션 lifecycle: drawTool 켜짐 → 레이어·상호작용 준비, 꺼짐 → 정리
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !drawTool) return;

    const source = new VectorSource();
    const layer = new VectorLayer({ source, style: PARCEL_ANALYSIS_DRAW_STYLE, zIndex: DRAW_LAYER_Z });
    layer.set('parcelAnalysisDraw', true);
    map.addLayer(layer);

    // 다각형을 더블클릭으로 마칠 때 지도 확대 방지
    const dblClickZoom = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DoubleClickZoom) as DoubleClickZoom | undefined;
    dblClickZoom?.setActive(false);

    let draw: Draw | null = null;
    let modify: Modify | null = null;

    const detachDraw = () => {
      if (draw) {
        map.removeInteraction(draw);
        draw.dispose();
        draw = null;
      }
    };
    const detachModify = () => {
      if (modify) {
        map.removeInteraction(modify);
        modify.dispose();
        modify = null;
      }
    };

    const writeWkt = () => {
      const geom = source.getFeatures()[0]?.getGeometry();
      const wkt = geom ? toWkt5181(geom) : null;
      drawWktRef.current = wkt;
      if (wkt) previewDrawArea(wkt);
    };

    const attachDraw = (tool: DrawTool) => {
      detachDraw();
      detachModify();
      source.clear();
      drawWktRef.current = null;
      draw =
        tool === 'rectangle'
          ? new Draw({ source, type: 'Circle', geometryFunction: createBox(), stopClick: true })
          : tool === 'polygon'
            ? new Draw({ source, type: 'Polygon', stopClick: true })
            : new Draw({ source, type: 'Circle', stopClick: true });
      draw.on('drawstart', () => {
        source.clear();
        clearDrawToolbarAnchor();
      });
      draw.on('drawend', (e: DrawEvent) => {
        const geom = e.feature?.getGeometry()?.clone();
        if (!geom) return;

        let wkt: string | null = null;
        try {
          wkt = toWkt5181(geom);
        } catch {
          wkt = null;
        }

        drawWktRef.current = wkt;
        const anchor = buildToolbarAnchorFromGeom(geom);

        // drawend 처리 중 Draw interaction 분리(편집 전환)와 겹치지 않도록 다음 틱에 반영
        queueMicrotask(() => {
          setDrawToolbarAnchor(anchor);
          if (wkt) previewDrawArea(wkt);
          setDrawPhase('editing');
        });
      });
      map.addInteraction(draw);
    };

    const attachModify = () => {
      detachDraw();
      detachModify();
      modify = new Modify({ source });

      let anchorRaf = 0;
      const scheduleAnchorFromGeom = (geom: Geometry) => {
        if (anchorRaf) return;
        anchorRaf = requestAnimationFrame(() => {
          anchorRaf = 0;
          setDrawToolbarAnchor(buildToolbarAnchorFromGeom(geom));
        });
      };

      modify.on('modifyend', (e: ModifyEvent) => {
        const geom = e.features.getArray()[0]?.getGeometry();
        if (geom) scheduleAnchorFromGeom(geom);
      });
      modify.on('modifyend', () => {
        writeWkt();
        const geom = source.getFeatures()[0]?.getGeometry();
        if (geom) setDrawToolbarAnchor(buildToolbarAnchorFromGeom(geom));
      });
      map.addInteraction(modify);
    };

    attachDrawRef.current = attachDraw;
    attachModifyRef.current = attachModify;

    return () => {
      detachDraw();
      detachModify();
      map.removeLayer(layer);
      source.clear();
      dblClickZoom?.setActive(true);
      attachDrawRef.current = null;
      attachModifyRef.current = null;
    };
  }, [drawTool, mapContext?.mapInstanceRef, drawWktRef, setDrawPhase, previewDrawArea, setDrawToolbarAnchor, clearDrawToolbarAnchor]);

  // 단계 전환: 그리기 ↔ 편집
  useEffect(() => {
    if (!drawTool) return;
    if (drawPhase === 'drawing') {
      attachDrawRef.current?.(drawTool);
    } else {
      attachModifyRef.current?.();
    }
  }, [drawTool, drawPhase]);
}

type Props = {
  area: ParcelAnalysisArea | null;
  /** 영역 확정 후 초기화 등으로 area만 비운 상태 */
  areaCleared?: boolean;
  onChangeClick: () => void;
  onClearClick: () => void;
  onSpecifyClick: () => void;
};

type SummaryRow = { label: string; value: string; highlight?: boolean };

function buildRows(area: ParcelAnalysisArea): SummaryRow[] {
  const rows: SummaryRow[] = [
    { label: '방식', value: area.method === 'boundary' ? '행정경계' : '도형 그리기' },
    { label: '대상', value: area.targetLabel, highlight: true },
  ];
  if (area.areaSqm > 0) {
    rows.push({ label: '면적', value: `약 ${area.areaSqm.toLocaleString('ko-KR')} ㎡` });
  }
  return rows;
}

export function ParcelAnalysisAreaSummary({
  area,
  areaCleared = false,
  onChangeClick,
  onClearClick,
  onSpecifyClick,
}: Props) {
  const rows = area ? buildRows(area) : [];

  return (
    <div className="border-b border-slate-200">
      <div className="px-4 py-2">
        <span className="text-[12px] font-semibold text-[#666]">분석 영역</span>
      </div>

      <div className="px-3 pb-3">
        {area ? (
          <div className="overflow-hidden rounded border border-slate-200">
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={cn('flex items-stretch', index !== rows.length - 1 && 'border-b border-slate-200')}
              >
                <div className="flex w-[64px] shrink-0 items-start bg-slate-100 px-2.5 py-1.5">
                  <span className="text-[11px] leading-snug text-[#666]">{row.label}</span>
                </div>
                <div className="flex min-w-0 flex-1 items-start px-2.5 py-1.5">
                  <span
                    className={cn(
                      'break-words text-[11px] leading-snug',
                      row.highlight ? 'font-medium text-primary' : 'text-[#666]'
                    )}
                  >
                    {row.value}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : areaCleared ? (
          <p className="text-[11px] text-slate-500">분석 영역이 초기화되었습니다. 다시 지정해 주세요.</p>
        ) : (
          <p className="text-[11px] text-amber-700">분석 영역을 먼저 지정하세요.</p>
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
              className="h-7 flex-1 gap-1 border-amber-300/80 bg-amber-50 px-2 text-[11px] font-medium text-amber-900 hover:bg-amber-100 hover:text-amber-950"
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
