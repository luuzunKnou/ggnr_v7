'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Map as OlMap } from 'ol';
import { Feature } from 'ol';
import { Point } from 'ol/geom';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style';
import Overlay from 'ol/Overlay';
import { call } from '@/lib/api';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';

const DEBOUNCE_MS = 200;

const OVERLAY_BOX_CSS = `
  background: white;
  color: black;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(0, 0, 0, 0.1);
  line-height: 1.4;
`;

type ElevationApiResult = {
  success?: boolean;
  code?: string;
  message?: string;
  elevation?: number;
};

function createOverlayShell(withInstruction: boolean): {
  root: HTMLDivElement;
  valueLine: HTMLDivElement;
  instructionLine: HTMLDivElement | null;
} {
  const root = document.createElement('div');
  root.style.cssText = OVERLAY_BOX_CSS;

  const valueLine = document.createElement('div');
  valueLine.style.cssText = 'color: black; font-size: 12px;';
  valueLine.innerHTML = `고도 : <span style="color: #3388ff; font-weight: 600;">…</span>`;

  root.appendChild(valueLine);

  let instructionLine: HTMLDivElement | null = null;
  if (withInstruction) {
    instructionLine = document.createElement('div');
    instructionLine.style.cssText = 'color: #666; font-size: 11px; margin-top: 2px;';
    instructionLine.textContent = '클릭으로 측정 · 우클릭 또는 ESC로 종료';
    root.appendChild(instructionLine);
  }

  return { root, valueLine, instructionLine };
}

function setValueHtml(valueLine: HTMLDivElement, text: string, isError: boolean) {
  if (isError) {
    valueLine.innerHTML = `<span style="color: #b45309; font-weight: 600;">${escapeHtml(text)}</span>`;
  } else if (text.startsWith('고도')) {
    const m = text.match(/^고도\s*:\s*(.+)$/);
    const num = m?.[1]?.trim() ?? text;
    valueLine.innerHTML = `고도 : <span style="color: #3388ff; font-weight: 600;">${escapeHtml(num)}</span>`;
  } else {
    valueLine.innerHTML = `<span style="color: #3388ff; font-weight: 600;">${escapeHtml(text)}</span>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchElevationAt(
  coordinate: number[],
  srid: number
): Promise<ElevationApiResult> {
  const res = await call('', 'POST', {
    service: 'elevationService',
    action: 'getElevationAtPoint',
    params: { x: coordinate[0], y: coordinate[1], srid },
  });
  const data = (res?.data ?? res) as ElevationApiResult;
  return data ?? { success: false, message: '고도 관련 데이터가 없습니다' };
}

/**
 * 고도 측정 모드 — 이동 중 debounce 미리보기, 좌클릭 확정, 우클릭·ESC 종료
 */
export function useAltitudeMeasure(
  map: OlMap | null,
  active: boolean,
  onStop: () => void
) {
  const sourceRef = useRef<VectorSource | null>(null);
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const previewOverlayRef = useRef<Overlay | null>(null);
  const previewValueRef = useRef<HTMLDivElement | null>(null);
  const completedOverlaysRef = useRef<Overlay[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  const ensureLayer = useCallback((olMap: OlMap) => {
    if (!sourceRef.current) {
      sourceRef.current = new VectorSource();
    }
    if (!layerRef.current) {
      layerRef.current = new VectorLayer({
        source: sourceRef.current,
        renderOrder: compareFeaturesByGeometryStackOrder,
        style: new Style({
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({ color: '#3388ff' }),
            stroke: new Stroke({ color: '#fff', width: 2 }),
          }),
        }),
        zIndex: 9999,
      });
      olMap.addLayer(layerRef.current);
    }
  }, []);

  const clearAltitudeMarkers = useCallback(() => {
    sourceRef.current?.clear();
    if (map && completedOverlaysRef.current.length > 0) {
      for (const ov of completedOverlaysRef.current) {
        try {
          map.removeOverlay(ov);
        } catch {
          /* ignore */
        }
      }
      completedOverlaysRef.current = [];
    }
    if (previewOverlayRef.current && previewValueRef.current) {
      previewValueRef.current.innerHTML = `고도 : <span style="color: #3388ff; font-weight: 600;">…</span>`;
      previewOverlayRef.current.setPosition(undefined);
    }
  }, [map]);

  // 레이어 수명
  useEffect(() => {
    if (!map) return;
    ensureLayer(map);
    return () => {
      if (layerRef.current) {
        try {
          map.removeLayer(layerRef.current);
        } catch {
          /* ignore */
        }
        layerRef.current = null;
      }
    };
  }, [map, ensureLayer]);

  // 모드 on/off
  useEffect(() => {
    if (!map) return;

    if (!active) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (previewOverlayRef.current) {
        try {
          map.removeOverlay(previewOverlayRef.current);
        } catch {
          /* ignore */
        }
        previewOverlayRef.current = null;
        previewValueRef.current = null;
      }
      return;
    }

    ensureLayer(map);

    const { root, valueLine } = createOverlayShell(true);
    previewValueRef.current = valueLine;
    const preview = new Overlay({
      element: root,
      positioning: 'bottom-center',
      stopEvent: false,
      offset: [0, -10],
    });
    map.addOverlay(preview);
    previewOverlayRef.current = preview;

    const getSrid = () => {
      const code = map.getView().getProjection()?.getCode() ?? 'EPSG:3857';
      const m = code.match(/EPSG:(\d+)/i);
      return m ? Number(m[1]) : 3857;
    };

    const runQuery = (coordinate: number[], forPreview: boolean) => {
      const id = ++reqIdRef.current;
      const srid = getSrid();
      void fetchElevationAt(coordinate, srid)
        .then((data) => {
          if (id !== reqIdRef.current) return;
          const ok = data?.success === true;
          const msg =
            data?.message?.trim() ||
            (ok && data.elevation != null
              ? `고도 : ${data.elevation} m`
              : '고도 관련 데이터가 없습니다');
          if (forPreview && previewValueRef.current) {
            setValueHtml(previewValueRef.current, msg, !ok);
          }
          return { ok, msg, coordinate };
        })
        .catch(() => {
          if (id !== reqIdRef.current) return null;
          const msg = '고도 관련 데이터가 없습니다';
          if (forPreview && previewValueRef.current) {
            setValueHtml(previewValueRef.current, msg, true);
          }
          return null;
        });
    };

    const onPointerMove = (e: { coordinate?: number[]; dragging?: boolean }) => {
      if (e.dragging || !e.coordinate) return;
      preview.setPosition(e.coordinate);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      const coord = e.coordinate.slice(0, 2);
      debounceTimerRef.current = setTimeout(() => {
        runQuery(coord, true);
      }, DEBOUNCE_MS);
    };

    const onSingleClick = (e: { coordinate?: number[]; originalEvent?: Event }) => {
      const coordinate = e.coordinate;
      if (!coordinate || coordinate.length < 2) return;
      e.originalEvent?.preventDefault?.();

      const srid = getSrid();
      const id = ++reqIdRef.current;
      void fetchElevationAt(coordinate, srid).then((data) => {
        if (id !== reqIdRef.current && !data) return;
        const ok = data?.success === true;
        const msg =
          data?.message?.trim() ||
          (ok && data.elevation != null
            ? `고도 : ${data.elevation} m`
            : '고도 관련 데이터가 없습니다');

        // 오류여도 클릭 지점에 안내 고정 (지원지역 벗어남 등)
        const feature = new Feature({
          geometry: new Point(coordinate),
        });
        sourceRef.current?.addFeature(feature);

        const { root: doneRoot, valueLine: doneValue } = createOverlayShell(false);
        setValueHtml(doneValue, msg, !ok);
        const doneOverlay = new Overlay({
          element: doneRoot,
          positioning: 'bottom-center',
          stopEvent: false,
          offset: [0, -10],
        });
        doneOverlay.setPosition(coordinate);
        map.addOverlay(doneOverlay);
        completedOverlaysRef.current.push(doneOverlay);
      });
    };

    const onContextMenu = (evt: MouseEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      onStopRef.current();
    };

    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        evt.preventDefault();
        onStopRef.current();
      }
    };

    map.on('pointermove', onPointerMove);
    map.on('singleclick', onSingleClick);
    const viewport = map.getViewport();
    viewport.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      map.un('pointermove', onPointerMove);
      map.un('singleclick', onSingleClick);
      viewport.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKeyDown);
      if (previewOverlayRef.current) {
        try {
          map.removeOverlay(previewOverlayRef.current);
        } catch {
          /* ignore */
        }
        previewOverlayRef.current = null;
        previewValueRef.current = null;
      }
    };
  }, [map, active, ensureLayer]);

  return { clearAltitudeMarkers };
}
