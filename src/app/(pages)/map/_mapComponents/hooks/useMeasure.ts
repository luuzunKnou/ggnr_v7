'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import MapboxDraw from 'maplibre-gl-draw';
import length from '@turf/length';
import area from '@turf/area';
import centroid from '@turf/centroid';
import { lineString } from '@turf/helpers';

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

export function formatArea(sqMeters: number): string {
  if (sqMeters >= 1_000_000) return `${(sqMeters / 1_000_000).toFixed(2)} km²`;
  if (sqMeters >= 10_000) return `${(sqMeters / 10_000).toFixed(2)} ha`;
  return `${Math.round(sqMeters)} m²`;
}

function calculateLineLength(coords: [number, number][]): number {
  if (coords.length < 2) return 0;
  return length(lineString(coords), { units: 'meters' });
}

function calculatePolygonArea(coords: number[][][]): number {
  if (!coords?.length || !coords[0]?.length || coords[0].length < 3) return 0;
  try {
    return area({ type: 'Polygon', coordinates: coords });
  } catch {
    return 0;
  }
}

export type MeasureMode = 'distance' | 'area' | null;

export interface UseMeasureOptions {
  mapRef: RefObject<maplibregl.Map | null> | null;
  mode: MeasureMode;
}

export interface UseMeasureReturn {
  distanceM: number | null;
  areaSqM: number | null;
  isDrawing: boolean;
  mousePosition: { x: number; y: number } | null;
  reset: () => void;
}

export function useMeasure({ mapRef, mode }: UseMeasureOptions): UseMeasureReturn {
  const drawRef = useRef<MapboxDraw | null>(null);
  const resultPopupsRef = useRef<maplibregl.Popup[]>([]);
  const fixedPointRef = useRef<[number, number] | null>(null);
  const modeRef = useRef<MeasureMode>(null);

  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [areaSqM, setAreaSqM] = useState<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);

  modeRef.current = mode;

  const removeAllPopups = useCallback(() => {
    resultPopupsRef.current.forEach((p) => p.remove());
    resultPopupsRef.current = [];
  }, []);

  const reset = useCallback(() => {
    const draw = drawRef.current;
    const map = mapRef?.current;
    if (draw && map) {
      draw.deleteAll();
    }
    removeAllPopups();
    fixedPointRef.current = null;
    setDistanceM(null);
    setAreaSqM(null);
    setIsDrawing(false);
    setMousePosition(null);
  }, [mapRef, removeAllPopups]);

  useEffect(() => {
    const map = mapRef?.current;
    if (!map) return;

    if (!mode) {
      if (drawRef.current) {
        try {
          map.removeControl(drawRef.current as unknown as maplibregl.IControl);
        } catch (_) {}
        drawRef.current = null;
      }
      removeAllPopups();
      fixedPointRef.current = null;
      setDistanceM(null);
      setAreaSqM(null);
      setMousePosition(null);
      setIsDrawing(false);
      return;
    }

    const drawMode = mode === 'distance' ? 'draw_line_string' : 'draw_polygon';

    let mouseMoveHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
    let modeChangeHandler: (() => void) | null = null;
    let createHandler: ((e: { features?: GeoJSON.Feature[] }) => void) | null = null;
    let updateHandler: (() => void) | null = null;
    let deleteHandler: (() => void) | null = null;

    const initDraw = () => {
      let draw: MapboxDraw;
      if (drawRef.current) {
        draw = drawRef.current;
        (draw as { changeMode: (m: string) => void }).changeMode(drawMode);
        fixedPointRef.current = null;
        setMousePosition(null);
        setIsDrawing(true);
      } else {
        draw = new MapboxDraw({
          defaultMode: drawMode,
          displayControlsDefault: false,
        });
        map.addControl(draw as unknown as maplibregl.IControl, 'top-left');
        drawRef.current = draw;
        setIsDrawing(true);
      }

      const updateUI = () => {
        const data = drawRef.current?.getAll();
        if (!data?.features?.length) {
          setDistanceM(null);
          setAreaSqM(null);
          return;
        }

        if (mode === 'distance') {
          const lineFeatures = data.features.filter(
            (f) => f.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates)
          );
          const lastLine = lineFeatures[lineFeatures.length - 1];
          const totalM = lastLine
            ? calculateLineLength((lastLine.geometry as GeoJSON.LineString).coordinates as [number, number][])
            : 0;
          setDistanceM(totalM > 0 ? totalM : null);
          setAreaSqM(null);
        } else {
          const polyFeatures = data.features.filter(
            (f) => f.geometry?.type === 'Polygon' && Array.isArray(f.geometry.coordinates)
          );
          const lastPoly = polyFeatures[polyFeatures.length - 1];
          const totalSqM = lastPoly
            ? calculatePolygonArea((lastPoly.geometry as GeoJSON.Polygon).coordinates as number[][][])
            : 0;
          setAreaSqM(totalSqM > 0 ? totalSqM : null);
          setDistanceM(null);
        }
      };

      mouseMoveHandler = (e: maplibregl.MapMouseEvent) => {
        if (fixedPointRef.current) return;
        const rect = map.getContainer().getBoundingClientRect();
        setMousePosition({ x: e.point.x + rect.left, y: e.point.y + rect.top });
        updateUI();
      };
      map.on('mousemove', mouseMoveHandler);

      modeChangeHandler = () => {
        if (draw.getMode() === drawMode) {
          fixedPointRef.current = null;
          setMousePosition(null);
          setIsDrawing(true);
        } else {
          setIsDrawing(false);
        }
      };
      map.on('draw.modechange', modeChangeHandler);

      const addPopupForFeature = (f: GeoJSON.Feature, point: [number, number], value: number, isDistance: boolean) => {
        const label = document.createElement('div');
        label.className = 'measure-result-label';
        label.textContent = isDistance ? formatDistance(value) : formatArea(value);
        label.style.cssText =
          'font-size:0.7rem;font-weight:600;color:#2563eb;white-space:nowrap;' +
          'background:rgba(255,255,255,1.0);padding:2px 8px;' +
          'border-radius:4px;border:1px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,0.12);';
        const popup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          className: 'measure-result-popup',
          offset: [0, -10],
        })
          .setLngLat(point)
          .setDOMContent(label)
          .addTo(map);
        resultPopupsRef.current.push(popup);
      };

      createHandler = (e: { features?: GeoJSON.Feature[]; createdFeatures?: GeoJSON.Feature[] }) => {
        const created = (e?.createdFeatures ?? e?.features ?? []) as GeoJSON.Feature[];
        setIsDrawing(false);
        setMousePosition(null);

        created.forEach((f) => {
          if (mode === 'distance' && f.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates)) {
            const coords = f.geometry.coordinates as [number, number][];
            const value = calculateLineLength(coords);
            if (coords.length >= 2 && value > 0) {
              addPopupForFeature(f, coords[coords.length - 1], value, true);
            }
          } else if (mode === 'area' && f.geometry?.type === 'Polygon' && Array.isArray(f.geometry.coordinates)) {
            const coords = f.geometry.coordinates as number[][][];
            const value = calculatePolygonArea(coords);
            if (value > 0) {
              let point: [number, number];
              try {
                point = centroid(f as GeoJSON.Feature<GeoJSON.Polygon>).geometry.coordinates as [number, number];
              } catch {
                point = coords[0]?.[0] as [number, number];
              }
              if (point) {
                addPopupForFeature(f, point, value, false);
              }
            }
          }
        });

        setTimeout(() => (draw as { changeMode: (m: string) => void }).changeMode(drawMode), 0);
      };
      map.on('draw.create', createHandler);

      updateHandler = updateUI;
      map.on('draw.update', updateHandler);

      updateUI();

      deleteHandler = () => {
        updateUI();
        const data = drawRef.current?.getAll();
        const features = data?.features ?? [];
        removeAllPopups();
        features.forEach((f) => {
          let value = 0;
          let point: [number, number] | null = null;
          let isDistance = false;
          if (f.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates)) {
            const coords = f.geometry.coordinates as [number, number][];
            value = calculateLineLength(coords);
            if (coords.length >= 2) point = coords[coords.length - 1];
            isDistance = true;
          } else if (f.geometry?.type === 'Polygon' && Array.isArray(f.geometry.coordinates)) {
            const coords = f.geometry.coordinates as number[][][];
            value = calculatePolygonArea(coords);
            if (value > 0) {
              try {
                point = centroid(f as GeoJSON.Feature<GeoJSON.Polygon>).geometry.coordinates as [number, number];
              } catch {
                if (coords[0]?.length) point = coords[0][0] as [number, number];
              }
            }
          }
          if (point && value > 0) {
            const label = document.createElement('div');
            label.className = 'measure-result-label';
            label.textContent = isDistance ? formatDistance(value) : formatArea(value);
            label.style.cssText =
              'font-size:0.7rem;font-weight:600;color:#2563eb;white-space:nowrap;' +
              'background:rgba(255,255,255,1.0);padding:5px 5px;' +
              'border-radius:4px;border:1px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,0.12);';
            const popup = new maplibregl.Popup({
              closeButton: false,
              closeOnClick: false,
              className: 'measure-result-popup',
              offset: [0, -10],
            })
              .setLngLat(point)
              .setDOMContent(label)
              .addTo(map);
            resultPopupsRef.current.push(popup);
          }
        });
        if (features.length === 0) fixedPointRef.current = null;
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

      if (modeRef.current === null) {
        removeAllPopups();
      }

      if (modeRef.current === null && drawRef.current) {
        try {
          map.removeControl(drawRef.current as unknown as maplibregl.IControl);
        } catch (_) {}
        drawRef.current = null;
      }

      fixedPointRef.current = null;
      setDistanceM(null);
      setAreaSqM(null);
      setMousePosition(null);
      setIsDrawing(false);
    };
  }, [mapRef, mode, removeAllPopups]);

  return { distanceM, areaSqM, isDrawing, mousePosition, reset };
}
