'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as OLMap, MapBrowserEvent } from 'ol';
import Overlay from 'ol/Overlay';
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
  identityFromWmsKey,
  readFeatureAttributes,
  readFeatureIdentity,
  writeFeatureAttributes,
  writeFeatureIdentity,
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
import {
  buildSortedHitCandidates,
  filterIdentifyHitsExcludingKeys,
  hitRowKeyId,
  type HitListDisplayField,
  type ShapeEditorHitCandidate,
} from '../_lib/hitCandidates';
import { fetchFormAttributesForPreset } from '../../map/_mapComponents/layerRowEdit/buildFormAttributes';
import { buildSessionKey, collectPendingOverlayGeometries } from '../_lib/editHistory';
import { useShapeEditorSnap } from '../_hooks/useShapeEditorSnap';
import type { EditHistoryEntry, ShapeEditorLayerItem } from '../types';
import type { PendingOverlayGeometry } from '../_lib/editHistory';
import { ShapeEditorHitPicker } from './ShapeEditorHitPicker';

const EDIT_LAYER_Z = 1201;
const PENDING_LAYER_Z = 1200;
const ATTR_FIELDS_CACHE = new Map<string, { field: string }[]>();

type HitPickerState = {
  candidates: ShapeEditorHitCandidate[];
  tableName: string;
};

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
    hiddenWmsFeaturesByLayer,
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
  const listDisplayFieldsRef = useRef<HitListDisplayField[]>([]);
  const draftSelectedIdRef = useRef(draft.selectedFeatureId);
  const draftRef = useRef(draft);
  const editHistoryRef = useRef(editHistory);
  const historyIndexRef = useRef(historyIndex);
  const activeEditLayerRef = useRef(activeEditLayer);
  const hiddenWmsRef = useRef(hiddenWmsFeaturesByLayer);
  draftSelectedIdRef.current = draft.selectedFeatureId;
  draftRef.current = draft;
  editHistoryRef.current = editHistory;
  historyIndexRef.current = historyIndex;
  activeEditLayerRef.current = activeEditLayer;
  hiddenWmsRef.current = hiddenWmsFeaturesByLayer;

  const rebuildPendingOverlayRef = useRef<
    (options?: { includeCanvasInPending?: boolean }) => void
  >(() => {});

  const [hitPicker, setHitPicker] = useState<HitPickerState | null>(null);
  const hitOverlayRef = useRef<Overlay | null>(null);
  const hitPopupElRef = useRef<HTMLDivElement | null>(null);

  const clearHitPicker = useCallback(() => {
    setHitPicker(null);
    hitOverlayRef.current?.setPosition(undefined);
  }, []);

  useEffect(() => {
    const el = document.createElement('div');
    hitPopupElRef.current = el;
    const overlay = new Overlay({
      element: el,
      positioning: 'top-left',
      stopEvent: true,
      offset: [12, 12],
    });
    map.addOverlay(overlay);
    hitOverlayRef.current = overlay;
    return () => {
      map.removeOverlay(overlay);
      hitOverlayRef.current = null;
      hitPopupElRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!activeEditLayer) {
      attributeFieldsRef.current = [];
      preferredKeyFieldRef.current = null;
      wmsKeyCandidatesRef.current = [];
      listDisplayFieldsRef.current = [];
      clearHitPicker();
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
        listDisplayFieldsRef.current = fields
          .filter(
            (f: {
              define_field_show_list?: string;
              define_field_type?: string;
              define_field_name?: string;
            }) => {
              const name = String(f.define_field_name ?? '').trim().toLowerCase();
              const type = String(f.define_field_type ?? '').toUpperCase();
              if (!name || name === 'geom' || type === 'GEOMETRY') return false;
              return String(f.define_field_show_list ?? '').toLowerCase() === 'true';
            }
          )
          .sort(
            (
              a: { define_field_idx?: string | number },
              b: { define_field_idx?: string | number }
            ) => Number(a.define_field_idx ?? 0) - Number(b.define_field_idx ?? 0)
          )
          .map(
            (f: { define_field_name?: string; define_field_kor_name?: string }) => {
              const field = String(f.define_field_name ?? '').trim();
              const korName = String(f.define_field_kor_name ?? '').trim() || field;
              return { field, korName };
            }
          );
      })
      .catch(() => {
        if (!cancelled) {
          preferredKeyFieldRef.current = null;
          wmsKeyCandidatesRef.current = [];
          listDisplayFieldsRef.current = [];
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeEditLayer?.id, activeEditLayer?.tableName, activeEditLayer?.schema, clearHitPicker]);

  const pickFeature = (
    feature: Feature | null,
    wms?: WmsFeatureKey & { featureId: string }
  ) => {
    const nextFeatureId = feature
      ? (wms?.featureId ??
          readFeatureIdentity(feature)?.featureId ??
          getUid(feature))
      : null;
    const prevId = draftSelectedIdRef.current;
    if (prevId && prevId !== nextFeatureId && activeEditLayer) {
      tryReleaseWmsHide(activeEditLayer.tableName, prevId);
    }

    selectedFeatureRef.current = feature;
    if (!feature) {
      const select = selectRef.current;
      if (select) select.getFeatures().clear();
      vectorLayerRef.current?.changed();
      onFeatureSelected(null);
      draftSelectedIdRef.current = null;
      return;
    }

    const stored = readFeatureIdentity(feature);
    const fallbackId = getUid(feature);
    const identity = wms
      ? identityFromWmsKey(wms, wms.featureId || fallbackId)
      : stored ?? identityFromWmsKey(null, fallbackId);

    // Select 이벤트보다 먼저 메타를 심어야 재선택 시 insert 로 덮이지 않음
    writeFeatureIdentity(feature, identity);

    const select = selectRef.current;
    if (select) {
      select.getFeatures().clear();
      select.getFeatures().push(feature);
    }
    vectorLayerRef.current?.changed();

    const fields = attributeFieldsRef.current;
    const attributeValues = readFeatureAttributes(feature, fields);
    const featureId = identity.featureId ?? fallbackId;
    draftSelectedIdRef.current = featureId;
    onFeatureSelected({
      featureId,
      attributeValues,
      changeKind: identity.changeKind === 'update' ? 'update' : 'insert',
      rowKey: identity.rowKey,
      originalAttributeValues: { ...attributeValues },
    });
    if (
      identity.rowKey &&
      activeEditLayer &&
      isWmsCqlSafeKeyField(identity.rowKey.keyField)
    ) {
      hideWmsFeature(activeEditLayer.tableName, identity.rowKey);
    }
  };

  const loadIdentifyHitRef = useRef<
    (hitData: Record<string, unknown>, layer: ShapeEditorLayerItem) => void
  >(() => {});
  loadIdentifyHitRef.current = (hitData, layer) => {
    const fields = attributeFieldsRef.current;
    const attributeValues = rowToAttributeValues(hitData, fields);
    const wmsKey = extractFeatureKeyForWms(
      hitData,
      preferredKeyFieldRef.current,
      wmsKeyCandidatesRef.current,
      layer.tableName
    );
    const featureId = identifyFeatureKey(
      hitData,
      preferredKeyFieldRef.current,
      wmsKeyCandidatesRef.current,
      layer.tableName
    );
    const olFeature = featureFromIdentifyRow(hitData, attributeValues);
    const source = sourceRef.current;
    if (!source) return;

    if (olFeature) {
      rebuildPendingOverlayRef.current({ includeCanvasInPending: true });
      source.clear();
      writeFeatureIdentity(
        olFeature,
        identityFromWmsKey(wmsKey ? { ...wmsKey, featureId } : null, featureId)
      );
      source.addFeature(olFeature);
      const wkt = featuresToWkt5181(source.getFeatures());
      pickFeature(olFeature, wmsKey ? { featureId, ...wmsKey } : undefined);
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
    vectorLayerRef.current?.changed();
    onFeatureSelected({
      featureId,
      attributeValues,
      changeKind: wmsKey ? 'update' : 'insert',
      rowKey: wmsKey ? { keyField: wmsKey.keyField, keyValue: wmsKey.keyValue } : null,
      originalAttributeValues: { ...attributeValues },
    });
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
        writeFeatureIdentity(feature, {
          changeKind: entry.kind === 'insert' ? 'insert' : 'update',
          rowKey: entry.rowKey,
          featureId: entry.featureId,
        });
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
    clearHitPicker();
    setDraft({ hasGeometry: false, wkt5181: null, saveMessage: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEditLayer?.id, setDraft, clearHitPicker]);

  useEffect(() => {
    if (toolMode !== 'select') clearHitPicker();
  }, [toolMode, clearHitPicker]);

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
        writeFeatureIdentity(feature, {
          changeKind: 'insert',
          rowKey: null,
          featureId,
        });
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

  /** 선택 모드: WMS(기존) 도형 클릭 → 우측 속성 패널 (겹침 시 후보 목록) */
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
      if (hitDraft) {
        clearHitPicker();
        return;
      }
      if (pendingSessionKey) {
        clearHitPicker();
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
        const rawFeatures = layerHit?.features ?? [];
        const source = sourceRef.current;
        if (!source) return;

        const excludeKeyIds = new Set<string>();
        const draftKey = draftRef.current.rowKey;
        if (draftKey) {
          excludeKeyIds.add(hitRowKeyId(draftKey.keyField, draftKey.keyValue));
        }
        for (const hidden of hiddenWmsRef.current.get(layer.tableName) ?? []) {
          excludeKeyIds.add(hitRowKeyId(hidden.keyField, hidden.keyValue));
        }
        for (const entry of editHistoryRef.current.slice(0, historyIndexRef.current + 1)) {
          if (
            entry.layer.tableName.toLowerCase() === layer.tableName.toLowerCase() &&
            entry.rowKey
          ) {
            excludeKeyIds.add(
              hitRowKeyId(entry.rowKey.keyField, entry.rowKey.keyValue)
            );
          }
        }

        const features = filterIdentifyHitsExcludingKeys(
          rawFeatures,
          layer.tableName,
          excludeKeyIds,
          preferredKeyFieldRef.current,
          wmsKeyCandidatesRef.current
        );

        if (rawFeatures.length === 0) {
          clearHitPicker();
          source.clear();
          pickFeature(null);
          syncDraftRef.current?.();
          return;
        }

        // 옛 DB 좌표만 맞은 편집 중·미저장 건 → 목록에 넣지 않고 현재 편집 유지
        if (features.length === 0) {
          clearHitPicker();
          return;
        }

        if (features.length >= 2) {
          const candidates = buildSortedHitCandidates(
            features,
            layer.tableName,
            preferredKeyFieldRef.current,
            wmsKeyCandidatesRef.current,
            listDisplayFieldsRef.current
          );
          // 후보만 띄움 — 옮기던 캔버스는 지우지 않음 (행 선택 시 이력으로 넘김)
          setHitPicker({
            candidates,
            tableName: layer.tableName,
          });
          hitOverlayRef.current?.setPosition(evt.coordinate);
          return;
        }

        clearHitPicker();
        const hit = features[0]!;
        loadIdentifyHitRef.current(hit.data, layer);
      } catch (err) {
        console.error('[ShapeEditor] identify failed', err);
      }
    };

    const key = map.on('singleclick', handleMapClick as never);
    return () => {
      if (key) unByKey(key);
    };
  }, [
    map,
    toolMode,
    editMode,
    activeEditLayer,
    onFeatureSelected,
    hideWmsFeature,
    tryReleaseWmsHide,
    recordGeometrySnapshot,
    reactivateHistorySession,
    clearHitPicker,
  ]);

  const handleHitSelect = (item: ShapeEditorHitCandidate) => {
    const layer = activeEditLayerRef.current;
    if (!layer) return;
    clearHitPicker();
    loadIdentifyHitRef.current(item.data, layer);
  };

  return hitPicker && hitPopupElRef.current ? (
    <ShapeEditorHitPicker
      tableName={hitPicker.tableName}
      candidates={hitPicker.candidates}
      portalTarget={hitPopupElRef.current}
      onSelect={handleHitSelect}
      onClose={clearHitPicker}
    />
  ) : null;
}
