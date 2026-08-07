'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Draw, { createBox, type DrawEvent } from 'ol/interaction/Draw';
import Modify, { type ModifyEvent } from 'ol/interaction/Modify';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import WKT from 'ol/format/WKT';
import { fromCircle } from 'ol/geom/Polygon';
import type Circle from 'ol/geom/Circle';
import type { Geometry } from 'ol/geom';
import { useMapContext } from '../../_mapComponents/MapContext';
import {
  ANALYSIS_DRAW_STYLE,
  formatAreaSqm,
  computeAreaSqmFromWkt5181,
  formatBoundaryAreaSummary,
  type DrawToolbarMapAnchor,
} from '../../_mapComponents/analysisArea';
import { useParcelAnalysis } from './parcelAnalysisContext';
import type {
  BoundaryEmdSelection,
  DrawProjectScope,
  DrawTool,
  ParcelAnalysisArea,
} from './parcelAnalysis.types';

export type {
  DrawToolbarMapAnchor,
  DrawToolbarScreenPlacement,
} from '../../_mapComponents/analysisArea';

export {
  formatAreaSqm,
  computeAreaSqmFromWkt5181,
  useParcelAnalysisAreaLayer,
  useParcelAnalysisMapZoom,
  useParcelAnalysisDrawToolbarPosition,
  ParcelAnalysisAreaSummary,
  DrawToolbarActions,
} from '../../_mapComponents/analysisArea';

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
    const layer = new VectorLayer({ source, style: ANALYSIS_DRAW_STYLE, zIndex: DRAW_LAYER_Z });
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
