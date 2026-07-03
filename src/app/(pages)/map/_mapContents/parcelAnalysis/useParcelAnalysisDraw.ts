'use client';

import { useEffect, useRef } from 'react';
import Draw, { createBox } from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import WKT from 'ol/format/WKT';
import { fromCircle } from 'ol/geom/Polygon';
import type Circle from 'ol/geom/Circle';
import type { Geometry } from 'ol/geom';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { useMapContext } from '../../_mapComponents/MapContext';
import { useParcelAnalysis } from './parcelAnalysisContext';
import type { DrawTool } from './parcelAnalysisTypes';

/** 확정 영역(860)보다 위 — 그리는 중 도형 */
const DRAW_LAYER_Z = 870;

const drawStyle = new Style({
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 1)', width: 2.5 }),
  fill: new Fill({ color: 'rgba(37, 99, 235, 0.18)' }),
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: 'rgba(37, 99, 235, 1)' }),
    stroke: new Stroke({ color: '#fff', width: 1.5 }),
  }),
});

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
  const { drawTool, drawPhase, drawWktRef, setDrawPhase } = useParcelAnalysis();

  const attachDrawRef = useRef<((tool: DrawTool) => void) | null>(null);
  const attachModifyRef = useRef<(() => void) | null>(null);

  // 세션 lifecycle: drawTool 켜짐 → 레이어·상호작용 준비, 꺼짐 → 정리
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !drawTool) return;

    const source = new VectorSource();
    const layer = new VectorLayer({ source, style: drawStyle, zIndex: DRAW_LAYER_Z });
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
      drawWktRef.current = geom ? toWkt5181(geom) : null;
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
      draw.on('drawstart', () => source.clear());
      draw.on('drawend', (e) => {
        const geom = (e as { feature?: { getGeometry(): Geometry | undefined } }).feature?.getGeometry();
        drawWktRef.current = geom ? toWkt5181(geom) : null;
        setDrawPhase('editing');
      });
      map.addInteraction(draw);
    };

    const attachModify = () => {
      detachDraw();
      detachModify();
      modify = new Modify({ source });
      modify.on('modifyend', () => writeWkt());
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
  }, [drawTool, mapContext?.mapInstanceRef, drawWktRef, setDrawPhase]);

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
