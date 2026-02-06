'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import MapboxDraw from 'maplibre-gl-draw';
import area from '@turf/area';
import centroid from '@turf/centroid';

export function formatArea(sqMeters: number): string {
  if (sqMeters >= 1_000_000) return `${(sqMeters / 1_000_000).toFixed(2)} km²`;
  if (sqMeters >= 10_000) return `${(sqMeters / 10_000).toFixed(2)} ha`;
  return `${Math.round(sqMeters)} m²`;
}

function calculatePolygonArea(coords: number[][][]): number {
  if (!coords?.length || !coords[0]?.length || coords[0].length < 3) return 0;
  try {
    return area({ type: 'Polygon', coordinates: coords });
  } catch {
    return 0;
  }
}

export interface UseMeasureAreaOptions {
  mapRef: RefObject<maplibregl.Map | null> | null;
  enabled: boolean;
}

export interface UseMeasureAreaReturn {
  areaSqM: number | null;
  isDrawing: boolean;
  mousePosition: { x: number; y: number } | null;
  reset: () => void;
}

export function useMeasureArea({
  mapRef,
  enabled,
}: UseMeasureAreaOptions): UseMeasureAreaReturn {
  const drawRef = useRef<MapboxDraw | null>(null);
  const resultPopupRef = useRef<maplibregl.Popup | null>(null);
  const fixedPointRef = useRef<[number, number] | null>(null);

  const [areaSqM, setAreaSqM] = useState<number | null>(null);
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
    setAreaSqM(null);
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
      setAreaSqM(null);
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
        defaultMode: 'draw_polygon',
        displayControlsDefault: false,
      });
      map.addControl(draw as unknown as maplibregl.IControl, 'top-left');
      drawRef.current = draw;
      setIsDrawing(true);

      const getTotalArea = (): { totalSqM: number; center: [number, number] | null } => {
        const data = drawRef.current?.getAll();
        if (!data?.features?.length) return { totalSqM: 0, center: null };

        let totalSqM = 0;
        let center: [number, number] | null = null;

        for (const f of data.features) {
          if (f.geometry?.type === 'Polygon' && Array.isArray(f.geometry.coordinates)) {
            const coords = f.geometry.coordinates as number[][][];
            totalSqM += calculatePolygonArea(coords);
            if (totalSqM > 0 && coords[0]?.length) {
              try {
                const c = centroid(f as GeoJSON.Feature<GeoJSON.Polygon>);
                center = c.geometry.coordinates as [number, number];
              } catch (_) {
                const ring = coords[0];
                if (ring?.length) center = ring[0] as [number, number];
              }
            }
          }
        }
        return { totalSqM, center };
      };

      const updateUI = () => {
        const { totalSqM } = getTotalArea();
        setAreaSqM(totalSqM > 0 ? totalSqM : null);
      };

      mouseMoveHandler = (e: maplibregl.MapMouseEvent) => {
        if (fixedPointRef.current) return;
        const rect = map.getContainer().getBoundingClientRect();
        setMousePosition({ x: e.point.x + rect.left, y: e.point.y + rect.top });
        updateUI();
      };
      map.on('mousemove', mouseMoveHandler);

      modeChangeHandler = () => {
        if (draw.getMode() === 'draw_polygon') {
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
        const { totalSqM, center } = getTotalArea();
        setIsDrawing(false);
        setMousePosition(null);

        if (center && totalSqM > 0) {
          fixedPointRef.current = center;
          resultPopupRef.current?.remove();
          resultPopupRef.current = null;

          const label = document.createElement('div');
          label.className = 'measure-result-label';
          label.textContent = formatArea(totalSqM);
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
            .setLngLat(center)
            .setDOMContent(label)
            .addTo(map);
          resultPopupRef.current = popup;
        }

        setTimeout(() => draw.changeMode('draw_polygon'), 0);
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
      setAreaSqM(null);
      setMousePosition(null);
      setIsDrawing(false);
    };
  }, [mapRef, enabled]);

  return { areaSqM, isDrawing, mousePosition, reset };
}
