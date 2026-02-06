'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import MapboxDraw from 'maplibre-gl-draw';
import length from '@turf/length';
import { lineString } from '@turf/helpers';

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function calculateLineLength(coords: [number, number][]): number {
  if (coords.length < 2) return 0;
  const line = lineString(coords);
  return length(line, { units: 'meters' });
}

export interface UseMeasureDistanceOptions {
  mapRef: RefObject<maplibregl.Map | null> | null;
  enabled: boolean;
}

export interface UseMeasureDistanceReturn {
  distanceM: number | null;
  isDrawing: boolean;
  mousePosition: { x: number; y: number } | null;
  reset: () => void;
}

export function useMeasureDistance({
  mapRef,
  enabled,
}: UseMeasureDistanceOptions): UseMeasureDistanceReturn {
  const drawRef = useRef<MapboxDraw | null>(null);
  const resultPopupRef = useRef<maplibregl.Popup | null>(null);
  const fixedPointRef = useRef<[number, number] | null>(null);

  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    const draw = drawRef.current;
    const map = mapRef?.current;
    if (draw && map) {
      draw.deleteAll();
    }
    resultPopupRef.current?.remove();
    resultPopupRef.current = null;
    fixedPointRef.current = null;
    setDistanceM(null);
    setIsDrawing(false);
    setMousePosition(null);
  }, [mapRef]);

  useEffect(() => {
    const map = mapRef?.current;
    if (!map || !enabled) {
      if (drawRef.current && map) {
        try {
          map.removeControl(drawRef.current as unknown as maplibregl.IControl);
        } catch (_) {}
        drawRef.current = null;
      }
      resultPopupRef.current?.remove();
      resultPopupRef.current = null;
      fixedPointRef.current = null;
      setDistanceM(null);
      setMousePosition(null);
      setIsDrawing(false);
      return;
    }

    let mouseMoveHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
    let modeChangeHandler: (() => void) | null = null;
    let createHandler: ((e: { features?: GeoJSON.Feature[] }) => void) | null = null;
    let updateHandler: (() => void) | null = null;
    let deleteHandler: (() => void) | null = null;

    const initDraw = () => {
      if (drawRef.current) return;

      const draw = new MapboxDraw({
        defaultMode: 'draw_line_string',
        displayControlsDefault: false,
      });
      map.addControl(draw as unknown as maplibregl.IControl, 'top-left');
      drawRef.current = draw;
      setIsDrawing(true);

      const getTotalDistance = (): { totalM: number; lastPoint: [number, number] | null } => {
        const data = drawRef.current?.getAll();
        if (!data?.features?.length) return { totalM: 0, lastPoint: null };

        let totalM = 0;
        let lastPoint: [number, number] | null = null;

        for (const f of data.features) {
          if (f.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates)) {
            const coords = f.geometry.coordinates as [number, number][];
            totalM += calculateLineLength(coords);
            if (coords.length >= 2) lastPoint = coords[coords.length - 1];
          }
        }
        return { totalM, lastPoint };
      };

      const updateUI = () => {
        const { totalM } = getTotalDistance();
        setDistanceM(totalM > 0 ? totalM : null);
      };

      mouseMoveHandler = (e: maplibregl.MapMouseEvent) => {
        if (fixedPointRef.current) return;
        const rect = map.getContainer().getBoundingClientRect();
        setMousePosition({ x: e.point.x + rect.left, y: e.point.y + rect.top });
        updateUI();
      };
      map.on('mousemove', mouseMoveHandler);

      modeChangeHandler = () => {
        if (draw.getMode() === 'draw_line_string') {
          resultPopupRef.current?.remove();
          resultPopupRef.current = null;
          fixedPointRef.current = null;
          setMousePosition(null);
          setIsDrawing(true);
        } else {
          setIsDrawing(false);
        }
      };
      map.on('draw.modechange', modeChangeHandler);

      createHandler = () => {
        const { totalM, lastPoint } = getTotalDistance();
        setIsDrawing(false);
        setMousePosition(null);

        if (lastPoint && totalM > 0) {
          fixedPointRef.current = lastPoint;
          resultPopupRef.current?.remove();
          resultPopupRef.current = null;

          const label = document.createElement('div');
          label.className = 'measure-result-label';
          label.textContent = formatDistance(totalM);
          label.style.cssText =
            'font-size:0.85rem;font-weight:600;color:#2563eb;white-space:nowrap;' +
            'background:rgba(255,255,255,1.0);padding:5px 5px;' +
            'border-radius:4px;border:1px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,0.12);';

          const popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            className: 'measure-result-popup',
            offset: [0, -10],
          })
            .setLngLat(lastPoint)
            .setDOMContent(label)
            .addTo(map);
          resultPopupRef.current = popup;
        }

        setTimeout(() => draw.changeMode('draw_line_string'), 0);
      };
      map.on('draw.create', createHandler);

      updateHandler = updateUI;
      map.on('draw.update', updateHandler);

      deleteHandler = () => {
        updateUI();
        resultPopupRef.current?.remove();
        resultPopupRef.current = null;
        fixedPointRef.current = null;
      };
      map.on('draw.delete', deleteHandler);
    };

    if (map.loaded()) {
      initDraw();
    } else {
      map.once('load', initDraw);
    }

    return () => {
      if (mouseMoveHandler) map.off('mousemove', mouseMoveHandler);
      if (modeChangeHandler) map.off('draw.modechange', modeChangeHandler);
      if (createHandler) map.off('draw.create', createHandler);
      if (updateHandler) map.off('draw.update', updateHandler);
      if (deleteHandler) map.off('draw.delete', deleteHandler);

      resultPopupRef.current?.remove();
      resultPopupRef.current = null;

      if (drawRef.current) {
        try {
          map.removeControl(drawRef.current as unknown as maplibregl.IControl);
        } catch (_) {}
        drawRef.current = null;
      }

      fixedPointRef.current = null;
      setDistanceM(null);
      setMousePosition(null);
      setIsDrawing(false);
    };
  }, [mapRef, enabled]);

  return { distanceM, isDrawing, mousePosition, reset };
}
