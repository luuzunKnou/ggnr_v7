'use client';

import { useEffect, useRef } from 'react';
import type { Map as OLMap } from 'ol';
import Draw from 'ol/interaction/Draw';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom';
import Modify from 'ol/interaction/Modify';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style';
import { useShapeEditorContext } from '../ShapeEditorContext';
import { featuresToWkt5181, shpTypeToDrawType } from '../_lib/geomUtils';

const EDIT_LAYER_Z = 900;

const editStyle = new Style({
  stroke: new Stroke({ color: 'rgba(239, 68, 68, 0.95)', width: 2.5 }),
  fill: new Fill({ color: 'rgba(239, 68, 68, 0.15)' }),
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(239, 68, 68, 0.95)' }),
    stroke: new Stroke({ color: '#fff', width: 1.5 }),
  }),
});

type ShapeEditorEngineProps = {
  map: OLMap;
};

export function ShapeEditorEngine({ map }: ShapeEditorEngineProps) {
  const { activeEditLayer, editMode, toolMode, setToolMode, setDraft } = useShapeEditorContext();
  const sourceRef = useRef<VectorSource | null>(null);
  const clearFeaturesRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      style: editStyle,
      zIndex: EDIT_LAYER_Z,
    });
    sourceRef.current = source;
    map.addLayer(layer);

    const syncDraft = () => {
      const features = source.getFeatures();
      const wkt = featuresToWkt5181(features);
      setDraft({
        hasGeometry: features.length > 0,
        wkt5181: wkt,
        saveMessage: null,
      });
    };

    clearFeaturesRef.current = () => {
      source.clear();
      syncDraft();
    };

    syncDraft();

    return () => {
      clearFeaturesRef.current = null;
      map.removeLayer(layer);
      source.clear();
      sourceRef.current = null;
    };
  }, [map, setDraft]);

  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    source.clear();
    setDraft({ hasGeometry: false, wkt5181: null, saveMessage: null });
  }, [activeEditLayer?.id, setDraft]);

  useEffect(() => {
    const source = sourceRef.current;
    if (!source || !activeEditLayer) return;

    let draw: Draw | null = null;
    let modify: Modify | null = null;

    const syncDraft = () => {
      const features = source.getFeatures();
      const wkt = featuresToWkt5181(features);
      setDraft({
        hasGeometry: features.length > 0,
        wkt5181: wkt,
        saveMessage: null,
      });
    };

    const dblClickZoom = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DoubleClickZoom) as DoubleClickZoom | undefined;

    const detachDraw = () => {
      if (draw) {
        map.removeInteraction(draw);
        draw.dispose();
        draw = null;
        dblClickZoom?.setActive(true);
      }
    };

    const detachModify = () => {
      if (modify) {
        map.removeInteraction(modify);
        modify.dispose();
        modify = null;
      }
    };

    const attachModify = () => {
      detachModify();
      modify = new Modify({ source });
      modify.on('modifyend', syncDraft);
      map.addInteraction(modify);
    };

    if (toolMode === 'draw' && editMode === 'new') {
      detachModify();
      detachDraw();
      dblClickZoom?.setActive(false);
      draw = new Draw({
        source,
        type: shpTypeToDrawType(activeEditLayer.shpType),
        stopClick: true,
      });
      draw.on('drawend', () => {
        syncDraft();
        detachDraw();
        attachModify();
        setToolMode('select');
      });
      map.addInteraction(draw);
    } else if (editMode === 'new') {
      detachDraw();
      attachModify();
    } else {
      detachDraw();
      detachModify();
    }

    return () => {
      detachDraw();
      detachModify();
      dblClickZoom?.setActive(true);
    };
  }, [map, activeEditLayer, editMode, toolMode, setDraft, setToolMode]);

  useEffect(() => {
    const handler = () => clearFeaturesRef.current?.();
    window.addEventListener('shape-editor:clear-geometry', handler);
    return () => window.removeEventListener('shape-editor:clear-geometry', handler);
  }, []);

  return null;
}

export function clearShapeEditorGeometry() {
  window.dispatchEvent(new Event('shape-editor:clear-geometry'));
}
