'use client';

import { useEffect, useRef } from 'react';
import type { Map as OLMap, MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import Draw from 'ol/interaction/Draw';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom';
import Modify from 'ol/interaction/Modify';
import Select from 'ol/interaction/Select';
import Snap from 'ol/interaction/Snap';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type Feature from 'ol/Feature';
import { getUid } from 'ol/util';
import { click } from 'ol/events/condition';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style';
import { useShapeEditorContext } from '../ShapeEditorContext';
import { featuresToWkt5181, shpTypeToDrawType, wkt5181ToFeature } from '../_lib/geomUtils';
import {
  emptyAttributeValues,
  readFeatureAttributes,
  writeFeatureAttributes,
} from '../_lib/featureAttributes';
import {
  extractFeatureKeyForWms,
  featureFromIdentifyRow,
  identifyFeatureKey,
  identifyFeaturesAtCoordinate,
  isWmsCqlSafeKeyField,
  rowToAttributeValues,
  type WmsFeatureKey,
} from '../_lib/mapIdentify';
import { fetchFormAttributesForPreset } from '../../map/_mapComponents/layerRowEdit/buildFormAttributes';
import { buildSessionKey, collectPendingOverlayGeometries } from '../_lib/editHistory';
import { useShapeEditorSnap } from '../_hooks/useShapeEditorSnap';
import type { EditHistoryEntry } from '../types';
import type { PendingOverlayGeometry } from '../_lib/editHistory';

const EDIT_LAYER_Z = 1201;
const PENDING_LAYER_Z = 1200;
const ATTR_FIELDS_CACHE = new Map<string, { field: string }[]>();

const editStyle = new Style({
  stroke: new Stroke({ color: 'rgba(239, 68, 68, 0.95)', width: 2.5 }),
  fill: new Fill({ color: 'rgba(239, 68, 68, 0.15)' }),
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(239, 68, 68, 0.95)' }),
    stroke: new Stroke({ color: '#fff', width: 1.5 }),
  }),
});

const selectedStyle = new Style({
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.95)', width: 3 }),
  fill: new Fill({ color: 'rgba(37, 99, 235, 0.2)' }),
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: 'rgba(37, 99, 235, 0.95)' }),
    stroke: new Stroke({ color: '#fff', width: 2 }),
  }),
});

const pendingStyle = new Style({
  stroke: new Stroke({ color: 'rgba(245, 158, 11, 0.95)', width: 2, lineDash: [8, 4] }),
  fill: new Fill({ color: 'rgba(245, 158, 11, 0.14)' }),
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(245, 158, 11, 0.95)' }),
    stroke: new Stroke({ color: '#fff', width: 1.5 }),
  }),
});

type ShapeEditorEngineProps = {
  map: OLMap;
};

async function loadAttributeFields(tableName: string, schema: string) {
  const key = `${schema}:${tableName}`;
  const cached = ATTR_FIELDS_CACHE.get(key);
  if (cached) return cached;
  const attrs = await fetchFormAttributesForPreset({ tableName, schema });
  const fields = attrs.map((a) => ({ field: a.field }));
  ATTR_FIELDS_CACHE.set(key, fields);
  return fields;
}

export function ShapeEditorEngine({ map }: ShapeEditorEngineProps) {
  const {
    activeEditLayer,
    editMode,
    toolMode,
    setToolMode,
    setDraft,
    onFeatureSelected,
    registerEngineBridge,
    draft,
    hideWmsFeature,
    tryReleaseWmsHide,
    recordGeometrySnapshot,
    editHistory,
    historyIndex,
    reactivateHistorySession,
    snapWorkLayer,
  } = useShapeEditorContext();

  const snapSourceRef = useShapeEditorSnap(map, snapWorkLayer);
  const sourceRef = useRef<VectorSource | null>(null);
  const vectorLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const pendingSourceRef = useRef<VectorSource | null>(null);
  const pendingLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const syncPendingOverlayRef = useRef<
    (geometries: ReturnType<typeof collectPendingOverlayGeometries>) => void
  >(() => {});
  const selectRef = useRef<Select | null>(null);
  const clearFeaturesRef = useRef<(() => void) | null>(null);
  const syncDraftRef = useRef<(() => void) | null>(null);
  const selectedFeatureRef = useRef<Feature | null>(null);
  const attributeFieldsRef = useRef<{ field: string }[]>([]);
  const preferredKeyFieldRef = useRef<string | null>(null);
  const wmsKeyCandidatesRef = useRef<string[]>([]);
  const draftSelectedIdRef = useRef(draft.selectedFeatureId);
  const draftRef = useRef(draft);
  const editHistoryRef = useRef(editHistory);
  const historyIndexRef = useRef(historyIndex);
  const activeEditLayerRef = useRef(activeEditLayer);
  draftSelectedIdRef.current = draft.selectedFeatureId;
  draftRef.current = draft;
  editHistoryRef.current = editHistory;
  historyIndexRef.current = historyIndex;
  activeEditLayerRef.current = activeEditLayer;

  const rebuildPendingOverlayRef = useRef<
    (options?: { includeCanvasInPending?: boolean }) => void
  >(() => {});

  useEffect(() => {
    if (!activeEditLayer) {
      attributeFieldsRef.current = [];
      preferredKeyFieldRef.current = null;
      wmsKeyCandidatesRef.current = [];
      return;
    }
    let cancelled = false;
    void loadAttributeFields(activeEditLayer.tableName, activeEditLayer.schema).then((fields) => {
      if (!cancelled) attributeFieldsRef.current = fields;
    });
    void fetch(`/api/config/defineLayer/fields/${encodeURIComponent(activeEditLayer.tableName)}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const fields = Array.isArray(body?.data) ? body.data : [];
        const defineFieldNames = fields
          .map((f: { define_field_name?: string }) => String(f.define_field_name ?? '').trim())
          .filter(Boolean);
        const key = fields.find(
          (f: { define_field_is_key?: string }) =>
            String(f.define_field_is_key ?? '').toLowerCase() === 'true'
        );
        preferredKeyFieldRef.current = key
          ? String(key.define_field_name).trim()
          : null;
        wmsKeyCandidatesRef.current = defineFieldNames;
      })
      .catch(() => {
        if (!cancelled) {
          preferredKeyFieldRef.current = null;
          wmsKeyCandidatesRef.current = [];
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeEditLayer?.id, activeEditLayer?.tableName, activeEditLayer?.schema]);

  const pickFeature = (
    feature: Feature | null,
    wms?: WmsFeatureKey & { featureId: string }
  ) => {
    const nextFeatureId = feature ? (wms?.featureId ?? getUid(feature)) : null;
    const prevId = draftSelectedIdRef.current;
    if (prevId && prevId !== nextFeatureId && activeEditLayer) {
      tryReleaseWmsHide(activeEditLayer.tableName, prevId);
    }

    selectedFeatureRef.current = feature;
    const select = selectRef.current;
    if (select) {
      select.getFeatures().clear();
      if (feature) select.getFeatures().push(feature);
    }
    vectorLayerRef.current?.changed();
    if (!feature) {
      onFeatureSelected(null);
      draftSelectedIdRef.current = null;
      return;
    }
    const fields = attributeFieldsRef.current;
    const attributeValues = readFeatureAttributes(feature, fields);
    const featureId = wms?.featureId ?? getUid(feature);
    draftSelectedIdRef.current = featureId;
    onFeatureSelected({
      featureId,
      attributeValues,
      changeKind: wms ? 'update' : 'insert',
      rowKey: wms ? { keyField: wms.keyField, keyValue: wms.keyValue } : null,
      originalAttributeValues: { ...attributeValues },
    });
    if (wms && activeEditLayer && isWmsCqlSafeKeyField(wms.keyField)) {
      hideWmsFeature(activeEditLayer.tableName, {
        keyField: wms.keyField,
        keyValue: wms.keyValue,
      });
    }
  };

  useEffect(() => {
    registerEngineBridge({
      applyAttributeValues: (values) => {
        const f = selectedFeatureRef.current;
        if (f) writeFeatureAttributes(f, values);
      },
      restoreFromHistory: (entry: EditHistoryEntry) => {
        const source = sourceRef.current;
        const layer = vectorLayerRef.current;
        if (!source) return;

        source.clear();
        selectedFeatureRef.current = null;
        selectRef.current?.getFeatures().clear();

        if (!entry.wkt5181?.trim()) {
          draftSelectedIdRef.current = null;
          layer?.changed();
          return;
        }

        const feature = wkt5181ToFeature(entry.wkt5181);
        if (!feature) {
          layer?.changed();
          return;
        }

        writeFeatureAttributes(feature, entry.attributeValues);
        source.addFeature(feature);
        selectedFeatureRef.current = feature;
        selectRef.current?.getFeatures().clear();
        selectRef.current?.getFeatures().push(feature);
        draftSelectedIdRef.current = entry.featureId;
        layer?.changed();
      },
    });
    return () => registerEngineBridge(null);
  }, [registerEngineBridge]);

  useEffect(() => {
    const pendingSource = new VectorSource();
    const pendingLayer = new VectorLayer({
      source: pendingSource,
      style: pendingStyle,
      zIndex: PENDING_LAYER_Z,
    });
    pendingSourceRef.current = pendingSource;
    pendingLayerRef.current = pendingLayer;
    map.addLayer(pendingLayer);

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      style: (feature) =>
        selectedFeatureRef.current === feature ? selectedStyle : editStyle,
      zIndex: EDIT_LAYER_Z,
    });
    sourceRef.current = source;
    vectorLayerRef.current = layer;
    map.addLayer(layer);

    const applyPendingGeometries = (geometries: PendingOverlayGeometry[]) => {
      pendingSource.clear();
      for (const item of geometries) {
        const feature = wkt5181ToFeature(item.wkt5181);
        if (!feature) continue;
        feature.set('sessionKey', item.sessionKey);
        pendingSource.addFeature(feature);
      }
      pendingLayer.changed();
    };
    syncPendingOverlayRef.current = applyPendingGeometries;

    const computePendingGeometries = (
      options?: { includeCanvasInPending?: boolean }
    ): PendingOverlayGeometry[] => {
      const editLayer = activeEditLayerRef.current;
      const draftState = draftRef.current;
      const features = source.getFeatures();
      let excludeKey: string | null = null;
      let canvasFallback: PendingOverlayGeometry | null = null;

      if (features.length > 0 && editLayer) {
        const sessionKey = buildSessionKey(editLayer, draftState);
        if (options?.includeCanvasInPending) {
          const wkt = featuresToWkt5181(features);
          if (wkt?.trim()) {
            canvasFallback = { sessionKey, wkt5181: wkt };
          }
        } else if (draftState.wkt5181?.trim()) {
          excludeKey = sessionKey;
        }
      }

      const fromHistory = collectPendingOverlayGeometries(
        editHistoryRef.current,
        historyIndexRef.current,
        excludeKey
      );

      if (
        canvasFallback &&
        !fromHistory.some((g) => g.sessionKey === canvasFallback!.sessionKey)
      ) {
        return [...fromHistory, canvasFallback];
      }
      return fromHistory;
    };

    rebuildPendingOverlayRef.current = (options) => {
      applyPendingGeometries(computePendingGeometries(options));
    };
    rebuildPendingOverlayRef.current();

    const syncDraft = () => {
      const features = source.getFeatures();
      const wkt = featuresToWkt5181(features);
      setDraft({
        hasGeometry: features.length > 0,
        wkt5181: wkt,
        saveMessage: null,
      });
      if (features.length === 0) pickFeature(null);
      else if (features.length === 1 && !draftSelectedIdRef.current) {
        pickFeature(features[0]!);
      }
      layer.changed();
      rebuildPendingOverlayRef.current();
    };

    clearFeaturesRef.current = () => {
      source.clear();
      pickFeature(null);
      syncDraft();
    };

    syncDraftRef.current = syncDraft;
    syncDraft();

    return () => {
      clearFeaturesRef.current = null;
      syncDraftRef.current = null;
      syncPendingOverlayRef.current = () => {};
      rebuildPendingOverlayRef.current = () => {};
      map.removeLayer(layer);
      map.removeLayer(pendingLayer);
      source.clear();
      pendingSource.clear();
      sourceRef.current = null;
      vectorLayerRef.current = null;
      pendingSourceRef.current = null;
      pendingLayerRef.current = null;
      selectRef.current = null;
      selectedFeatureRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, setDraft, onFeatureSelected]);

  useEffect(() => {
    rebuildPendingOverlayRef.current();
  }, [editHistory, historyIndex, draft.wkt5181, draft.rowKey, draft.selectedFeatureId, draft.hasGeometry, activeEditLayer?.id]);

  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    source.clear();
    pickFeature(null);
    setDraft({ hasGeometry: false, wkt5181: null, saveMessage: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEditLayer?.id, setDraft]);

  useEffect(() => {
    const source = sourceRef.current;
    if (!source || !activeEditLayer) return;

    let draw: Draw | null = null;
    let modify: Modify | null = null;
    let select: Select | null = null;
    let snap: Snap | null = null;

    const syncDraft = () => {
      const features = source.getFeatures();
      const wkt = featuresToWkt5181(features);
      setDraft({
        hasGeometry: features.length > 0,
        wkt5181: wkt,
        saveMessage: null,
      });
    };

    const recordMoveSnapshot = () => {
      const features = source.getFeatures();
      const wkt = featuresToWkt5181(features);
      syncDraft();
      recordGeometrySnapshot('move', { hasGeometry: features.length > 0, wkt5181: wkt });
      rebuildPendingOverlayRef.current();
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

    const detachSelect = () => {
      if (select) {
        map.removeInteraction(select);
        select.dispose();
        select = null;
        selectRef.current = null;
      }
    };

    const attachSelect = () => {
      detachSelect();
      const layer = vectorLayerRef.current;
      if (!layer) return;
      select = new Select({
        layers: [layer],
        condition: click,
        style: selectedStyle,
      });
      select.on('select', (e) => {
        const f = e.selected[0] ?? null;
        if (f) pickFeature(f);
        else if (e.deselected.length > 0) pickFeature(null);
      });
      map.addInteraction(select);
      selectRef.current = select;
    };

    const attachModify = () => {
      detachModify();
      const selectInteraction = selectRef.current;
      modify = new Modify(
        selectInteraction
          ? { features: selectInteraction.getFeatures() }
          : { source }
      );
      modify.on('modifyend', recordMoveSnapshot);
      map.addInteraction(modify);
    };

    const detachSnap = () => {
      if (snap) {
        map.removeInteraction(snap);
        snap.dispose();
        snap = null;
      }
    };

    const attachSnap = () => {
      detachSnap();
      const snapSource = snapSourceRef.current;
      if (!snapWorkLayer || !snapSource || editMode !== 'new') return;
      snap = new Snap({
        source: snapSource,
        pixelTolerance: 12,
        vertex: true,
        edge: true,
      });
      map.addInteraction(snap);
    };

    if (toolMode === 'draw' && editMode === 'new') {
      detachSelect();
      detachModify();
      detachDraw();
      dblClickZoom?.setActive(false);
      draw = new Draw({
        source,
        type: shpTypeToDrawType(activeEditLayer.shpType),
        stopClick: true,
      });
      draw.on('drawend', (e) => {
        const feature = e.feature;
        const fields = attributeFieldsRef.current;
        writeFeatureAttributes(feature, emptyAttributeValues(fields));
        const wkt = featuresToWkt5181([feature]);
        const attributeValues = readFeatureAttributes(feature, fields);
        const featureId = getUid(feature);
        detachDraw();
        attachSelect();
        attachModify();
        attachSnap();
        pickFeature(feature);
        setToolMode('select');
        recordGeometrySnapshot('create', {
          hasGeometry: true,
          wkt5181: wkt,
          changeKind: 'insert',
          rowKey: null,
          wmsFeatureId: null,
          selectedFeatureId: featureId,
          attributeValues,
          originalAttributeValues: { ...attributeValues },
        });
      });
      map.addInteraction(draw);
      attachSnap();
    } else if (editMode === 'new') {
      detachDraw();
      attachSelect();
      attachModify();
      attachSnap();
    } else {
      detachDraw();
      detachModify();
      detachSelect();
      detachSnap();
    }

    return () => {
      detachDraw();
      detachModify();
      detachSelect();
      detachSnap();
      dblClickZoom?.setActive(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, activeEditLayer, editMode, toolMode, snapWorkLayer, setDraft, setToolMode, recordGeometrySnapshot]);

  useEffect(() => {
    const handler = () => clearFeaturesRef.current?.();
    window.addEventListener('shape-editor:clear-geometry', handler);
    return () => window.removeEventListener('shape-editor:clear-geometry', handler);
  }, []);

  /** 선택 모드: WMS(기존) 도형 클릭 → 우측 속성 패널 */
  useEffect(() => {
    if (toolMode !== 'select' || editMode !== 'new' || !activeEditLayer) return;

    const handleMapClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      const editVectorLayer = vectorLayerRef.current;
      const pendingLayer = pendingLayerRef.current;
      if (!editVectorLayer) return;

      let hitDraft = false;
      let pendingSessionKey: string | null = null;
      evt.map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
        if (layer === editVectorLayer) {
          hitDraft = true;
          return true;
        }
        if (layer === pendingLayer) {
          pendingSessionKey = String(feature.get('sessionKey') ?? '').trim() || null;
          return true;
        }
        return false;
      });
      if (hitDraft) return;
      if (pendingSessionKey) {
        reactivateHistorySession(pendingSessionKey);
        return;
      }

      const layer = activeEditLayer;
      let fields = attributeFieldsRef.current;
      if (fields.length === 0) {
        fields = await loadAttributeFields(layer.tableName, layer.schema);
        attributeFieldsRef.current = fields;
      }

      const zoom = evt.map.getView().getZoom() ?? 10;
      const [x, y] = evt.coordinate as [number, number];

      try {
        const results = await identifyFeaturesAtCoordinate(
          x,
          y,
          zoom,
          [layer.tableName],
          layer.schema
        );
        const layerHit =
          results.find((r) => r.tableName.toLowerCase() === layer.tableName.toLowerCase()) ??
          results[0];
        const hit = layerHit?.features?.[0];
        const source = sourceRef.current;
        if (!source) return;

        if (!hit) {
          source.clear();
          pickFeature(null);
          syncDraftRef.current?.();
          return;
        }

        const attributeValues = rowToAttributeValues(hit.data, fields);
        const wmsKey = extractFeatureKeyForWms(
          hit.data,
          preferredKeyFieldRef.current,
          wmsKeyCandidatesRef.current
        );
        const featureId = identifyFeatureKey(
          hit.data,
          preferredKeyFieldRef.current,
          wmsKeyCandidatesRef.current
        );
        const olFeature = featureFromIdentifyRow(hit.data, attributeValues);

        if (olFeature) {
          rebuildPendingOverlayRef.current({ includeCanvasInPending: true });
          source.clear();
          source.addFeature(olFeature);
          const wkt = featuresToWkt5181(source.getFeatures());
          pickFeature(
            olFeature,
            wmsKey && isWmsCqlSafeKeyField(wmsKey.keyField)
              ? { featureId, ...wmsKey }
              : undefined
          );
          syncDraftRef.current?.();
          recordGeometrySnapshot('select', {
            hasGeometry: true,
            wkt5181: wkt,
            changeKind: wmsKey ? 'update' : 'insert',
            rowKey: wmsKey ? { keyField: wmsKey.keyField, keyValue: wmsKey.keyValue } : null,
            wmsFeatureId: wmsKey ? featureId : null,
            selectedFeatureId: featureId,
            attributeValues,
            originalAttributeValues: { ...attributeValues },
          });
          rebuildPendingOverlayRef.current();
          return;
        }

        selectedFeatureRef.current = null;
        selectRef.current?.getFeatures().clear();
        editVectorLayer.changed();
        onFeatureSelected({
          featureId,
          attributeValues,
          changeKind: wmsKey ? 'update' : 'insert',
          rowKey: wmsKey ? { keyField: wmsKey.keyField, keyValue: wmsKey.keyValue } : null,
          originalAttributeValues: { ...attributeValues },
        });
      } catch (err) {
        console.error('[ShapeEditor] identify failed', err);
      }
    };

    const key = map.on('singleclick', handleMapClick as never);
    return () => {
      if (key) unByKey(key);
    };
  }, [map, toolMode, editMode, activeEditLayer, onFeatureSelected, hideWmsFeature, tryReleaseWmsHide, recordGeometrySnapshot, reactivateHistorySession]);

  return null;
}
