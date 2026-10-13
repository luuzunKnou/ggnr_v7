'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Feature from 'ol/Feature';
import WKT from 'ol/format/WKT';
import type { Geometry } from 'ol/geom';
import MultiPoint from 'ol/geom/MultiPoint';
import Point from 'ol/geom/Point';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import VectorLayer from 'ol/layer/Vector';
import type Map from 'ol/Map';
import { getTransform } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import '@/app/(pages)/map/_mapComponents/config/projections';
import { call } from '@/lib/api';
import { DrawToolbarActions } from '../../_mapComponents/analysisArea';
import { useMapVisualCenterPixel } from '../../_mapComponents/hooks/useMapVisualCenterPixel';
import { useMapContext } from '../../_mapComponents/MapContext';
import { GEOM_EDIT_HINT_BELOW_SEARCH_GAP, useSearchBarOffset } from '../../searchBarOffsetContext';
import { fileCoord5181 } from './aerialLocationParse';
import type { WorkFileItem } from './aerialMediaTypes';

type Phase = 'draw' | 'edit' | 'ready';
type DrawKind = 'Point' | 'MultiPoint';

function finitePoints(file: WorkFileItem): [number, number][] {
  const many = (file.points5181 ?? []).filter(
    (p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
  );
  if (many.length > 0) return many;
  const one = fileCoord5181(file);
  return one ? [one] : [];
}

function toView(map: Map, xy: [number, number]): [number, number] {
  const code = map.getView().getProjection().getCode();
  if (code === 'EPSG:5181') return xy;
  return getTransform('EPSG:5181', code)(xy) as [number, number];
}

function firstXy(geom: Geometry): [number, number] | null {
  if (geom.getType() === 'Point') {
    const c = (geom as Point).getCoordinates();
    return Number.isFinite(c[0]) && Number.isFinite(c[1]) ? [c[0], c[1]] : null;
  }
  if (geom.getType() === 'MultiPoint') {
    const c = (geom as MultiPoint).getCoordinates()[0];
    return c && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? [c[0], c[1]] : null;
  }
  return null;
}

export function DroneFileGeomEdit({
  file,
  onClose,
  onSaved,
}: {
  file: WorkFileItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const mapContext = useMapContext();
  const mapReady = Boolean(mapContext?.mapReady);
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const { inputBottomPx } = useSearchBarOffset();
  const hintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;
  const centerPixel = useMapVisualCenterPixel(
    mapContext?.mapInstanceRef.current ?? null,
    mapReady,
    mapPaddingLeft
  );
  const drawRef = useRef<Draw | null>(null);
  const modifyRef = useRef<Modify | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const modeRef = useRef<DrawKind>('MultiPoint');
  const beginRef = useRef<((kind: DrawKind, seed: [number, number][]) => void) | null>(null);
  const multiFeatureRef = useRef<Feature<MultiPoint> | null>(null);
  const [phase, setPhase] = useState<Phase>('draw');
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef.current;
    if (!map) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      zIndex: 9700,
      properties: { id: 'aerial-file-geom-edit', geomStackSkip: true },
      style: new Style({
        image: new CircleStyle({
          radius: 7,
          fill: new Fill({ color: 'rgba(225,29,72,0.92)' }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
        }),
      }),
    });
    map.addLayer(layer);

    const dblClickZoom = map
      .getInteractions()
      .getArray()
      .find((interaction) => interaction instanceof DoubleClickZoom);
    dblClickZoom?.setActive(false);

    const clearInteractions = () => {
      if (drawRef.current) {
        map.removeInteraction(drawRef.current);
        drawRef.current = null;
      }
      if (modifyRef.current) {
        map.removeInteraction(modifyRef.current);
        modifyRef.current = null;
      }
    };

    const startRepeatedPoints = (seedView: [number, number][]) => {
      const feature = new Feature(new MultiPoint(seedView));
      source.addFeature(feature);
      multiFeatureRef.current = feature;
      const sketch = new VectorSource();
      const draw = new Draw({ source: sketch, type: 'Point' });
      draw.on('drawend', (evt) => {
        const geom = evt.feature.getGeometry();
        if (!(geom instanceof Point)) return;
        const coord = geom.getCoordinates() as [number, number];
        const current = feature.getGeometry();
        if (!(current instanceof MultiPoint)) return;
        const next = current.getCoordinates();
        next.push(coord);
        current.setCoordinates(next);
        feature.changed();
        window.setTimeout(() => sketch.clear(), 0);
      });
      map.addInteraction(draw);
      drawRef.current = draw;
      setPhase('draw');
    };

    const begin = (kind: DrawKind, seed: [number, number][]) => {
      source.clear();
      clearInteractions();
      multiFeatureRef.current = null;
      if (seed.length === 1 && kind === 'Point') {
        source.addFeature(new Feature(new Point(toView(map, seed[0]!))));
        const modify = new Modify({ source });
        map.addInteraction(modify);
        modifyRef.current = modify;
        map.getView().animate({ center: toView(map, seed[0]!), duration: 250 });
        setPhase('edit');
        return;
      }
      if (seed.length > 1) {
        source.addFeature(new Feature(new MultiPoint(seed.map((p) => toView(map, p)))));
        const modify = new Modify({ source });
        map.addInteraction(modify);
        modifyRef.current = modify;
        map.getView().animate({ center: toView(map, seed[0]!), duration: 250 });
        setPhase('edit');
        return;
      }
      if (kind === 'Point') {
        const draw = new Draw({ source, type: 'Point' });
        draw.on('drawend', () => {
          map.removeInteraction(draw);
          if (drawRef.current === draw) drawRef.current = null;
          setPhase('ready');
        });
        map.addInteraction(draw);
        drawRef.current = draw;
        setPhase('draw');
        return;
      }
      startRepeatedPoints([]);
    };

    beginRef.current = begin;
    const existing = finitePoints(file);
    const kind: DrawKind = existing.length === 1 ? 'Point' : 'MultiPoint';
    modeRef.current = kind;
    begin(kind, existing);

    return () => {
      beginRef.current = null;
      multiFeatureRef.current = null;
      dblClickZoom?.setActive(true);
      clearInteractions();
      map.removeLayer(layer);
      sourceRef.current = null;
    };
  }, [file.id, mapReady, mapContext?.mapInstanceRef]);

  const finishDraw = () => {
    if (modeRef.current === 'MultiPoint') {
      const geom = multiFeatureRef.current?.getGeometry();
      const count = geom instanceof MultiPoint ? geom.getCoordinates().length : 0;
      if (count < 1) {
        window.alert('위치를 한 곳 이상 찍어 주세요.');
        return;
      }
      const map = mapContext?.mapInstanceRef.current;
      if (map && drawRef.current) {
        map.removeInteraction(drawRef.current);
        drawRef.current = null;
      }
      setPhase('ready');
      return;
    }
    try {
      drawRef.current?.finishDrawing();
    } catch {
      window.alert('위치를 한 곳 이상 찍어 주세요.');
    }
  };

  const save = async () => {
    const map = mapContext?.mapInstanceRef.current;
    const geom = sourceRef.current?.getFeatures()[0]?.getGeometry();
    if (!map || !geom) {
      window.alert('지도에 위치를 먼저 찍어 주세요.');
      return;
    }
    const cloned = geom.clone();
    const viewCode = map.getView().getProjection().getCode();
    if (viewCode !== 'EPSG:5181') cloned.transform(viewCode, 'EPSG:5181');
    const type = cloned.getType();
    if (type !== 'Point' && type !== 'MultiPoint') {
      window.alert('점만 저장할 수 있습니다.');
      return;
    }
    const first = firstXy(cloned);
    if (!first) {
      window.alert('지도에 위치를 먼저 찍어 주세요.');
      return;
    }
    const fuKey = Number(String(file.id).replace(/^fu-/, ''));
    if (!Number.isFinite(fuKey)) {
      window.alert('파일 키가 없습니다.');
      return;
    }
    setBusy(true);
    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'updateFileUnitGeom',
        params: {
          fuKey,
          wkt: new WKT().writeGeometry(cloned),
          x5181: first[0],
          y5181: first[1],
        },
      });
      const payload = (res?.data ?? res) as { success?: boolean; error?: string };
      if (res?.success === false || payload?.success === false) {
        window.alert(payload?.error || '위치 저장에 실패했습니다.');
        return;
      }
      onSaved();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : '위치 저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const bannerHost = mapContext?.mapInstanceRef.current?.getTargetElement()?.parentElement ?? null;
  if (!mounted || !bannerHost) return null;

  const drawing = phase === 'draw';

  return createPortal(
    <div
      className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col items-center gap-1.5"
      style={
        centerPixel
          ? { left: centerPixel.x, top: hintTopPx }
          : { left: '50%', top: hintTopPx }
      }
    >
      <DrawToolbarActions
        drawPhase={drawing ? 'drawing' : 'editing'}
        confirmDraw={drawing ? finishDraw : () => void save()}
        redrawShape={() => beginRef.current?.(modeRef.current, [])}
        cancelDraw={onClose}
        applyDisabled={!drawing && busy}
        finishLabel={drawing && modeRef.current === 'MultiPoint' ? '완료' : undefined}
      />
    </div>,
    bannerHost
  );
}
