'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { Map as OlMap } from 'ol';
import { Feature } from 'ol';
import { Draw, Select } from 'ol/interaction';
import type Interaction from 'ol/interaction/Interaction';
import { createBox, createRegularPolygon, type GeometryFunction } from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style, Circle as CircleStyle, Text as TextStyle } from 'ol/style';
import type { StyleLike } from 'ol/style/Style';
import Overlay from 'ol/Overlay';
import { Point, MultiPoint, LineString, Polygon } from 'ol/geom';
import type Geometry from 'ol/geom/Geometry';
import { transform } from 'ol/proj';
import { getCenter } from 'ol/extent';
import { useMeasure, type MeasureType } from '@/app/(pages)/map/_mapComponents/hooks/useMeasure';
import { useAltitudeMeasure } from '@/app/(pages)/map/_mapComponents/hooks/useAltitudeMeasure';
import { useSlopeMeasure } from '@/app/(pages)/map/_mapComponents/hooks/useSlopeMeasure';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import type { MapPrintTool } from './mapPrintTypes';

const PRINT_COORD_INPUT_KEY = 'printCoordInput';

// ol-ext has no bundled types in this project
// eslint-disable-next-line @typescript-eslint/no-require-imports
const UndoRedo = require('ol-ext/interaction/UndoRedo').default as new (opts?: {
  layers?: VectorLayer<VectorSource>[];
}) => Interaction & {
  undo: () => void;
  redo: () => void;
  clear: () => void;
};

/** 완료된 도형 — 꼭짓점(원) 없이 선·면만 */
function diagramFinishedStyle(color: string, isPointOnly = false): Style {
  if (isPointOnly) {
    return new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({ color }),
        stroke: new Stroke({ color: '#fff', width: 2 }),
      }),
    });
  }
  return new Style({
    stroke: new Stroke({ color, width: 2 }),
    fill: new Fill({ color: 'rgba(255,255,255,0.35)' }),
  });
}

/** Draw 스케치용 — 거리 측정처럼 꼭짓점이 클릭마다 늘어나 보이게 */
function diagramDrawStyle(color: string): StyleLike {
  const strokeFill = new Style({
    stroke: new Stroke({ color, width: 2 }),
    fill: new Fill({ color: 'rgba(255,255,255,0.35)' }),
  });
  const vertex = new Style({
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
  });
  const verticesOnLine = new Style({
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
    geometry: (feature) => {
      const geom = feature.getGeometry() as Geometry | undefined;
      if (!geom) return;
      const type = geom.getType();
      if (type === 'LineString') {
        return new MultiPoint((geom as LineString).getCoordinates());
      }
      if (type === 'Polygon') {
        const rings = (geom as Polygon).getCoordinates();
        return new MultiPoint(rings[0] ?? []);
      }
      if (type === 'Point') {
        return geom;
      }
      return undefined;
    },
  });
  return (feature) => {
    const geom = feature.getGeometry();
    const type = geom?.getType();
    if (type === 'Point') return [vertex];
    return [strokeFill, verticesOnLine, vertex];
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(51,153,204,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function useMapPrintTools(
  map: OlMap | null,
  activeTool: MapPrintTool,
  color: string,
  onStopElevation: () => void,
) {
  const diagramSourceRef = useRef<VectorSource | null>(null);
  const diagramLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawRef = useRef<Draw | null>(null);
  const selectRef = useRef<Select | null>(null);
  const undoRedoRef = useRef<(Interaction & { undo: () => void; redo: () => void; clear: () => void }) | null>(
    null
  );
  const overlaysRef = useRef<Overlay[]>([]);
  const colorRef = useRef(color);
  colorRef.current = color;
  const onStopElevationRef = useRef(onStopElevation);
  onStopElevationRef.current = onStopElevation;
  const stopElevation = useCallback(() => {
    onStopElevationRef.current();
  }, []);

  const measureType: MeasureType | null =
    activeTool === 'distance' ? 'distance' : activeTool === 'area' ? 'area' : null;
  const { clearMeasurements } = useMeasure(map, measureType);
  const { clearAltitudeMarkers } = useAltitudeMeasure(
    map,
    activeTool === 'elevation',
    stopElevation
  );
  const { clearSlopeMeasurements } = useSlopeMeasure(map, activeTool === 'slope');

  // diagram layer + undo (고도는 지도와 동일하게 useAltitudeMeasure 재사용)
  useEffect(() => {
    if (!map) return;
    const diagramSource = new VectorSource();
    const diagramLayer = new VectorLayer({
      source: diagramSource,
      zIndex: 200,
      renderOrder: compareFeaturesByGeometryStackOrder,
      properties: { name: 'MapPrintDiagram' },
    });
    map.addLayer(diagramLayer);
    diagramSourceRef.current = diagramSource;
    diagramLayerRef.current = diagramLayer;

    const undo = new UndoRedo({ layers: [diagramLayer] });
    map.addInteraction(undo);
    undoRedoRef.current = undo;

    return () => {
      map.removeInteraction(undo);
      map.removeLayer(diagramLayer);
      overlaysRef.current.forEach((o) => map.removeOverlay(o));
      overlaysRef.current = [];
      diagramSourceRef.current = null;
      diagramLayerRef.current = null;
      undoRedoRef.current = null;
    };
  }, [map]);

  // clear active draw/select when tool changes
  useEffect(() => {
    if (!map) return;

    if (drawRef.current) {
      map.removeInteraction(drawRef.current);
      drawRef.current = null;
    }
    if (selectRef.current) {
      map.removeInteraction(selectRef.current);
      selectRef.current = null;
    }

    const diagramSource = diagramSourceRef.current;
    if (!diagramSource) return;

    const c = colorRef.current;

    const attachDraw = (
      type: 'Point' | 'LineString' | 'Polygon' | 'Circle',
      geometryFunction?: GeometryFunction,
      onEnd?: (f: Feature) => void,
      source: VectorSource = diagramSource,
      pointOnlyStyle = false,
    ) => {
      const draw = new Draw({
        source,
        type,
        geometryFunction,
        style: pointOnlyStyle
          ? diagramFinishedStyle(c, true)
          : diagramDrawStyle(colorRef.current),
      });
      draw.on('drawend', (e) => {
        const f = e.feature;
        // 그리기 중엔 꼭짓점 표시, 완료 후에는 선·면만 (원 꼭짓점 숨김)
        f.setStyle(diagramFinishedStyle(colorRef.current, pointOnlyStyle));
        onEnd?.(f);
      });
      map.addInteraction(draw);
      drawRef.current = draw;
    };

    if (activeTool === 'point') attachDraw('Point', undefined, undefined, diagramSource, true);
    else if (activeTool === 'line') attachDraw('LineString');
    else if (activeTool === 'polygon') attachDraw('Polygon');
    else if (activeTool === 'circle') attachDraw('Circle');
    else if (activeTool === 'box') attachDraw('Circle', createBox());
    else if (activeTool === 'square') attachDraw('Circle', createRegularPolygon(4));
    else if (activeTool === 'symbol') {
      attachDraw('Point', undefined, (feature) => {
        feature.setStyle(
          new Style({
            image: new CircleStyle({
              radius: 1,
              fill: new Fill({ color: 'rgba(0,0,0,0)' }),
              stroke: new Stroke({ color: 'rgba(0,0,0,0)', width: 0 }),
            }),
          })
        );
        const geom = feature.getGeometry() as Point;
        const coord = geom.getCoordinates();
        const el = document.createElement('div');
        el.className = 'map-print-symbol-pin';
        el.innerHTML = `<svg width="22" height="28" viewBox="0 0 24 28" fill="${colorRef.current}" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C6.5 0 2 4.5 2 10c0 7.5 10 18 10 18s10-10.5 10-18C22 4.5 17.5 0 12 0zm0 14a4 4 0 110-8 4 4 0 010 8z"/></svg>`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'comment-cancle map-print-ignore';
        btn.textContent = '×';
        btn.style.cssText =
          'margin-left:2px;border:none;background:#ef4444;color:#fff;border-radius:50%;width:16px;height:16px;cursor:pointer;font-size:11px;line-height:1';
        btn.onclick = () => {
          diagramSource.removeFeature(feature);
          map.removeOverlay(overlay);
          overlaysRef.current = overlaysRef.current.filter((o) => o !== overlay);
        };
        el.appendChild(btn);
        const overlay = new Overlay({
          element: el,
          position: coord,
          positioning: 'bottom-center',
          offset: [0, 2],
        });
        map.addOverlay(overlay);
        overlaysRef.current.push(overlay);
        feature.set('printOverlay', overlay);
        feature.set('isSymbol', true);
      });
    } else if (activeTool === 'comment') {
      attachDraw('Point', undefined, (feature) => {
        feature.setStyle(
          new Style({
            image: new CircleStyle({
              radius: 1,
              fill: new Fill({ color: 'rgba(0,0,0,0)' }),
              stroke: new Stroke({ color: 'rgba(0,0,0,0)', width: 0 }),
            }),
          })
        );
        const geom = feature.getGeometry() as Point;
        const coord = geom.getCoordinates();
        const wrap = document.createElement('div');
        wrap.className = 'map-print-comment-box map-print-ignore';

        const row = document.createElement('div');
        row.className = 'map-print-comment-row';

        const sizeSel = document.createElement('select');
        sizeSel.className = 'map-print-comment-size';
        sizeSel.title = '글자 크기';
        ;[8, 10, 12, 14, 16, 18, 20, 24, 28, 32].forEach((s) => {
          const opt = document.createElement('option');
          opt.value = String(s);
          opt.textContent = `${s}`;
          if (s === 12) opt.selected = true;
          sizeSel.appendChild(opt);
        });

        const boldBtn = document.createElement('button');
        boldBtn.type = 'button';
        boldBtn.className = 'map-print-comment-bold';
        boldBtn.textContent = 'B';
        boldBtn.title = '굵게';
        let isBold = false;
        boldBtn.onclick = () => {
          isBold = !isBold;
          boldBtn.classList.toggle('is-active', isBold);
        };

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'map-print-comment-text';
        input.placeholder = '내용을 입력하세요';

        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'map-print-comment-save';
        save.title = '저장';
        save.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'map-print-comment-cancel comment-cancle';
        cancel.title = '취소';
        cancel.textContent = '×';

        row.append(sizeSel, boldBtn, input, save);
        wrap.append(row, cancel);

        const overlay = new Overlay({
          element: wrap,
          position: coord,
          positioning: 'bottom-left',
          offset: [8, -8],
        });
        map.addOverlay(overlay);
        overlaysRef.current.push(overlay);

        const removeInput = () => {
          map.removeOverlay(overlay);
          overlaysRef.current = overlaysRef.current.filter((o) => o !== overlay);
        };

        cancel.onclick = () => {
          diagramSource.removeFeature(feature);
          removeInput();
        };
        const commit = () => {
          const text = input.value.trim();
          if (!text) {
            diagramSource.removeFeature(feature);
            removeInput();
            return;
          }
          const fontSize = Number(sizeSel.value) || 12;
          removeInput();
          feature.setStyle(
            new Style({
              text: new TextStyle({
                text,
                font: `${isBold ? 'bold ' : ''}${fontSize}px sans-serif`,
                fill: new Fill({ color: colorRef.current }),
                stroke: new Stroke({ color: '#fff', width: 3 }),
                offsetY: -12,
              }),
            })
          );
        };
        save.onclick = commit;
        input.onkeydown = (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            commit();
          }
          if (ev.key === 'Escape') {
            diagramSource.removeFeature(feature);
            removeInput();
          }
        };
        window.setTimeout(() => input.focus(), 30);
      });
    } else if (activeTool === 'select') {
      const select = new Select({
        layers: [diagramLayerRef.current!].filter(Boolean),
        style: new Style({
          stroke: new Stroke({ color: '#ef4444', width: 3 }),
          fill: new Fill({ color: hexToRgba('#ef4444', 0.2) }),
          image: new CircleStyle({
            radius: 7,
            fill: new Fill({ color: '#ef4444' }),
            stroke: new Stroke({ color: '#fff', width: 2 }),
          }),
        }),
      });
      map.addInteraction(select);
      selectRef.current = select;
    }
  }, [map, activeTool]);

  // update unfinished draw style color when color changes
  useEffect(() => {
    if (!diagramSourceRef.current) return;
    diagramSourceRef.current.getFeatures().forEach((f) => {
      const style = f.getStyle();
      if (!style || f.get('printOverlay')) return;
      // keep text styles; only recolor simple diagrams without custom overlay
      const geom = f.getGeometry();
      if (!geom) return;
      const isPoint = geom.getType() === 'Point';
      const textStyle = Array.isArray(style)
        ? style.find((s) => s.getText())
        : style instanceof Style
          ? style.getText()
          : null;
      if (textStyle) {
        const t = Array.isArray(style) ? style[0]!.getText() : (style as Style).getText();
        if (t) {
          t.setFill(new Fill({ color }));
          f.changed();
        }
        return;
      }
      f.setStyle(
        isPoint ? diagramFinishedStyle(color, true) : diagramFinishedStyle(color, false)
      );
    });
  }, [color]);

  const deleteSelected = useCallback(() => {
    if (!map || !selectRef.current) return;
    const selected = selectRef.current.getFeatures();
    selected.forEach((f) => {
      const ov = f.get('printOverlay') as Overlay | undefined;
      if (ov) {
        map.removeOverlay(ov);
        overlaysRef.current = overlaysRef.current.filter((o) => o !== ov);
      }
      diagramSourceRef.current?.removeFeature(f);
    });
    selected.clear();
  }, [map]);

  const undo = useCallback(() => {
    undoRedoRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoRedoRef.current?.redo();
  }, []);

  const clearAll = useCallback(() => {
    if (!map) return;
    diagramSourceRef.current?.clear();
    overlaysRef.current.forEach((o) => map.removeOverlay(o));
    overlaysRef.current = [];
    clearMeasurements();
    clearAltitudeMarkers();
    clearSlopeMeasurements();
    undoRedoRef.current?.clear();
  }, [map, clearMeasurements, clearAltitudeMarkers, clearSlopeMeasurements]);

  /**
   * 좌표 입력 패널 — EPSG:5181 점 목록.
   * 1개: 점 / 2개 이상: 각 점 + 연결 선. 이전 좌표입력 도형은 교체.
   */
  const applyCoordInput5181 = useCallback(
    (coords5181: [number, number][]) => {
      if (!map) return;
      const source = diagramSourceRef.current;
      const view = map.getView();
      const projection = view.getProjection();
      if (!source || !projection) return;

      const prev = source.getFeatures().filter((f) => f.get(PRINT_COORD_INPUT_KEY));
      prev.forEach((f) => source.removeFeature(f));

      if (coords5181.length === 0) return;

      const color = colorRef.current;
      const mapCoords = coords5181.map(([x, y]) =>
        transform([x, y], 'EPSG:5181', projection)
      );

      for (const c of mapCoords) {
        const pt = new Feature({ geometry: new Point(c) });
        pt.set(PRINT_COORD_INPUT_KEY, true);
        pt.setStyle(diagramFinishedStyle(color, true));
        source.addFeature(pt);
      }

      if (mapCoords.length >= 2) {
        const line = new Feature({ geometry: new LineString(mapCoords) });
        line.set(PRINT_COORD_INPUT_KEY, true);
        line.setStyle(diagramFinishedStyle(color, false));
        source.addFeature(line);
      }

      if (mapCoords.length === 1) {
        view.setCenter(mapCoords[0]);
        return;
      }
      const lineGeom = new LineString(mapCoords);
      const extent = lineGeom.getExtent();
      if (extent.every((v) => Number.isFinite(v))) {
        view.fit(extent, { padding: [48, 48, 48, 48], maxZoom: 18, duration: 200 });
      } else {
        view.setCenter(getCenter(extent));
      }
    },
    [map]
  );

  return { deleteSelected, undo, redo, clearAll, clearMeasurements, applyCoordInput5181 };
}
