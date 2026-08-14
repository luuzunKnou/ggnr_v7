'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Map as OLMap } from 'ol';
import type {
  EditHistoryAction,
  EditHistoryEntry,
  ShapeEditorDraftState,
  ShapeEditorEditMode,
  ShapeEditorLayerItem,
  ShapeEditorToolMode,
  ShapeEditorWorkLayer,
  PendingShapeChange,
} from './types';
import type { WmsFeatureKey } from './_lib/wmsFeatureKey';
import { isWmsCqlSafeKeyField } from './_lib/wmsFeatureKey';
import {
  attributesEqual,
  buildHistoryEntry,
  buildDeleteHistoryEntry,
  buildSessionKey,
  collectDirtySaveItems,
  collectPendingOverlayGeometries,
  countSessionMoves,
  draftFromHistoryEntry,
  latestMeaningfulEntry,
  shouldHideWmsForHistoryEntry,
} from './_lib/editHistory';
import { savePendingChangesBatch } from './_lib/shapeEditorSave';
import { parseWmsFeatureId } from './_lib/mapIdentify';
import { pendingRowKeyId } from './_lib/pendingChange';
import { DEFAULT_JIJUK_WORK_LAYER, isReadOnlyWorkLayer } from './_lib/defaultWorkLayers';

export type HiddenWmsFeature = WmsFeatureKey;

function hiddenFeatureId(key: WmsFeatureKey): string {
  return `${key.keyField.toLowerCase()}:${key.keyValue}`;
}

export type ShapeEditorFeatureSelection = {
  featureId: string;
  attributeValues: Record<string, string>;
  changeKind?: 'insert' | 'update';
  rowKey?: { keyField: string; keyValue: string } | null;
  originalAttributeValues?: Record<string, string>;
};

export type ShapeEditorEngineBridge = {
  applyAttributeValues: (values: Record<string, string>) => void;
  restoreFromHistory: (entry: EditHistoryEntry) => void;
};

type HistoryState = {
  entries: EditHistoryEntry[];
  index: number;
};

type ShapeEditorContextValue = {
  mapInstanceRef: RefObject<OLMap | null>;
  mapReady: boolean;
  registerMap: (map: OLMap | null) => void;
  workLayers: ShapeEditorWorkLayer[];
  addWorkLayer: (layer: ShapeEditorLayerItem) => void;
  removeWorkLayer: (id: string) => void;
  setWorkLayerView: (id: string, view: boolean) => void;
  setWorkLayerEdit: (id: string) => void;
  setWorkLayerSnap: (id: string, snap: boolean) => void;
  activeEditLayer: ShapeEditorLayerItem | null;
  /** 자석 켜진 작업 레이어 (최대 1개) */
  snapWorkLayer: ShapeEditorLayerItem | null;
  visibleLayerNames: Set<string>;
  /** 보이는 작업 레이어 기하 타입 (WMS 쌓음 순서) */
  layerGeometryTypes: Record<string, 'POINT' | 'LINE' | 'POLYGON'>;
  snapLayerNames: Set<string>;
  toolMode: ShapeEditorToolMode;
  setToolMode: (mode: ShapeEditorToolMode) => void;
  editMode: ShapeEditorEditMode;
  setEditMode: (mode: ShapeEditorEditMode) => void;
  draft: ShapeEditorDraftState;
  setDraft: (patch: Partial<ShapeEditorDraftState>) => void;
  setAttributeValue: (field: string, value: string) => void;
  onFeatureSelected: (selection: ShapeEditorFeatureSelection | null) => void;
  registerEngineBridge: (bridge: ShapeEditorEngineBridge | null) => void;
  refreshWms: () => void;
  wmsRefreshToken: number;
  confirmDirtyOrProceed: () => boolean;
  hiddenWmsFeaturesByLayer: Map<string, HiddenWmsFeature[]>;
  hideWmsFeature: (tableName: string, key: WmsFeatureKey) => void;
  unhideWmsFeature: (tableName: string, key: WmsFeatureKey) => void;
  clearHiddenWmsFeatures: (tableName?: string) => void;
  /** dirty 가 아니면 WMS 숨김 해제 */
  tryReleaseWmsHide: (tableName: string, wmsFeatureId: string | null) => void;
  editHistory: EditHistoryEntry[];
  historyIndex: number;
  recordGeometrySnapshot: (
    action: EditHistoryAction,
    snapshot?: Partial<ShapeEditorDraftState>
  ) => void;
  recordDeleteSnapshot: (snapshot?: Partial<ShapeEditorDraftState>) => void;
  deleteCurrentGeometry: () => void;
  reactivateHistorySession: (sessionKey: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirtySaveItems: PendingShapeChange[];
  bulkSavePending: () => Promise<void>;
  bulkSaving: boolean;
  bulkSaveMessage: string | null;
  hasUnsavedWork: boolean;
};

const ShapeEditorContext = createContext<ShapeEditorContextValue | null>(null);

const initialDraft: ShapeEditorDraftState = {
  hasGeometry: false,
  wkt5181: null,
  saving: false,
  saveMessage: null,
  attributeValues: {},
  selectedFeatureId: null,
  changeKind: 'insert',
  rowKey: null,
  wmsFeatureId: null,
  originalAttributeValues: {},
};

const emptyHistory: HistoryState = { entries: [], index: -1 };

function workLayerId(layer: ShapeEditorLayerItem): string {
  return layer.id;
}

export function ShapeEditorProvider({ children }: { children: ReactNode }) {
  const mapInstanceRef = useRef<OLMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [workLayers, setWorkLayers] = useState<ShapeEditorWorkLayer[]>([DEFAULT_JIJUK_WORK_LAYER]);
  const [toolMode, setToolMode] = useState<ShapeEditorToolMode>('select');
  const [editMode, setEditModeState] = useState<ShapeEditorEditMode>('new');
  const [draft, setDraftState] = useState<ShapeEditorDraftState>(initialDraft);
  const [wmsRefreshToken, setWmsRefreshToken] = useState(0);
  const [hiddenWmsFeatures, setHiddenWmsFeatures] = useState<Map<string, HiddenWmsFeature[]>>(
    () => new Map()
  );
  const [historyState, setHistoryState] = useState<HistoryState>(emptyHistory);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkSaveMessage, setBulkSaveMessage] = useState<string | null>(null);
  const historyRef = useRef(historyState);
  historyRef.current = historyState;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const workLayersRef = useRef(workLayers);
  workLayersRef.current = workLayers;
  const engineBridgeRef = useRef<ShapeEditorEngineBridge | null>(null);
  const isRestoringHistoryRef = useRef(false);
  const attributeHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const registerEngineBridge = useCallback((bridge: ShapeEditorEngineBridge | null) => {
    engineBridgeRef.current = bridge;
  }, []);

  const registerMap = useCallback((map: OLMap | null) => {
    mapInstanceRef.current = map;
    setMapReady(map != null);
  }, []);

  const setDraft = useCallback((patch: Partial<ShapeEditorDraftState>) => {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const onFeatureSelected = useCallback((selection: ShapeEditorFeatureSelection | null) => {
    if (attributeHistoryTimerRef.current) {
      clearTimeout(attributeHistoryTimerRef.current);
      attributeHistoryTimerRef.current = null;
    }
    if (!selection) {
      setDraftState((prev) => ({
        ...prev,
        selectedFeatureId: null,
        attributeValues: {},
        changeKind: 'insert',
        rowKey: null,
        wmsFeatureId: null,
        originalAttributeValues: {},
      }));
      return;
    }
    const changeKind = selection.changeKind ?? (selection.rowKey ? 'update' : 'insert');
    setDraftState((prev) => ({
      ...prev,
      selectedFeatureId: selection.featureId,
      attributeValues: selection.attributeValues,
      changeKind,
      rowKey: selection.rowKey ?? null,
      wmsFeatureId: changeKind === 'update' ? selection.featureId : null,
      originalAttributeValues:
        selection.originalAttributeValues ?? { ...selection.attributeValues },
    }));
  }, []);

  const recordAttributeSnapshot = useCallback(() => {
    if (isRestoringHistoryRef.current) return;
    const layer = workLayersRef.current.find((w) => w.edit)?.layer ?? null;
    if (!layer) return;

    let d: ShapeEditorDraftState = { ...draftRef.current };
    if (!d.selectedFeatureId && !d.rowKey) return;

    if (!d.wkt5181?.trim()) {
      const { entries, index } = historyRef.current;
      const sessionKey = buildSessionKey(layer, d);
      const latest = latestMeaningfulEntry(entries, index, sessionKey);
      if (latest?.wkt5181?.trim()) {
        d = { ...d, hasGeometry: true, wkt5181: latest.wkt5181 };
      }
    }
    if (!d.wkt5181?.trim()) return;

    setHistoryState((prev) => {
      const sessionKey = buildSessionKey(layer, d);
      const truncated = prev.entries.slice(0, prev.index + 1);
      const last = truncated[truncated.length - 1];
      const compareBase =
        last?.sessionKey === sessionKey && last.action === 'attribute'
          ? truncated[truncated.length - 2]
          : last?.sessionKey === sessionKey
            ? last
            : latestMeaningfulEntry(truncated, truncated.length - 1, sessionKey);

      if (
        compareBase?.sessionKey === sessionKey &&
        compareBase.wkt5181 === d.wkt5181 &&
        attributesEqual(compareBase.attributeValues, d.attributeValues)
      ) {
        // 직전 속성 이력만 있고 내용이 원복된 경우 해당 이력 제거
        if (last?.sessionKey === sessionKey && last.action === 'attribute') {
          const entries = truncated.slice(0, -1);
          const index = entries.length - 1;
          const next = { entries, index };
          historyRef.current = next;
          dirtySaveItemsRef.current = collectDirtySaveItems(entries, index);
          return next;
        }
        return prev;
      }

      const entry = buildHistoryEntry(layer, d, 'attribute');
      if (!entry) return prev;

      let entries: EditHistoryEntry[];
      if (last?.sessionKey === sessionKey && last.action === 'attribute') {
        entries = [...truncated.slice(0, -1), entry];
      } else {
        entries = [...truncated, entry];
      }
      const index = entries.length - 1;
      const next = { entries, index };
      historyRef.current = next;
      dirtySaveItemsRef.current = collectDirtySaveItems(entries, index);
      return next;
    });
    setBulkSaveMessage(null);
  }, []);

  const cancelAttributeHistoryTimer = useCallback(() => {
    if (attributeHistoryTimerRef.current) {
      clearTimeout(attributeHistoryTimerRef.current);
      attributeHistoryTimerRef.current = null;
    }
  }, []);

  const flushAttributeHistory = useCallback(() => {
    cancelAttributeHistoryTimer();
    recordAttributeSnapshot();
  }, [cancelAttributeHistoryTimer, recordAttributeSnapshot]);

  const setAttributeValue = useCallback(
    (field: string, value: string) => {
      setDraftState((prev) => {
        const attributeValues = { ...prev.attributeValues, [field]: value };
        engineBridgeRef.current?.applyAttributeValues(attributeValues);
        const next = { ...prev, attributeValues };
        draftRef.current = next;
        return next;
      });
      cancelAttributeHistoryTimer();
      attributeHistoryTimerRef.current = setTimeout(() => {
        attributeHistoryTimerRef.current = null;
        recordAttributeSnapshot();
      }, 400);
    },
    [cancelAttributeHistoryTimer, recordAttributeSnapshot]
  );

  const dirtySaveItems = useMemo(
    () => collectDirtySaveItems(historyState.entries, historyState.index),
    [historyState.entries, historyState.index]
  );
  const dirtySaveItemsRef = useRef(dirtySaveItems);
  dirtySaveItemsRef.current = dirtySaveItems;

  /** 창 닫기 등 이탈 시에만 사용 — 도형/레이어 전환에는 호출하지 않음 */
  const confirmDirtyOrProceed = useCallback(() => {
    if (dirtySaveItemsRef.current.length > 0) {
      return window.confirm(
        `저장하지 않은 편집 ${dirtySaveItemsRef.current.length}건이 있습니다. 계속할까요?`
      );
    }
    return true;
  }, []);

  const clearHistory = useCallback(() => {
    setHistoryState(emptyHistory);
  }, []);

  const resetAllEditingState = useCallback(() => {
    setDraftState(initialDraft);
    setToolMode('select');
    setHiddenWmsFeatures(new Map());
    clearHistory();
    window.dispatchEvent(new Event('shape-editor:clear-geometry'));
  }, [clearHistory]);

  /** 캔버스만 비움 — 전역 이력·WMS 숨김·dirty 유지 */
  const clearEditingCanvas = useCallback(() => {
    cancelAttributeHistoryTimer();
    window.dispatchEvent(new Event('shape-editor:clear-geometry'));
    setDraftState(initialDraft);
  }, [cancelAttributeHistoryTimer]);

  const hideWmsFeature = useCallback((tableName: string, key: WmsFeatureKey) => {
    const keyField = String(key.keyField).trim();
    const keyValue = String(key.keyValue).trim();
    if (!tableName || !keyField || !keyValue || !isWmsCqlSafeKeyField(keyField)) return;
    setHiddenWmsFeatures((prev) => {
      const next = new Map(prev);
      const list = [...(next.get(tableName) ?? [])];
      const id = hiddenFeatureId({ keyField, keyValue });
      if (list.some((item) => hiddenFeatureId(item) === id)) return prev;
      list.push({ keyField, keyValue });
      next.set(tableName, list);
      return next;
    });
    setWmsRefreshToken((t) => t + 1);
  }, []);

  const unhideWmsFeature = useCallback((tableName: string, key: WmsFeatureKey) => {
    const keyField = String(key.keyField).trim();
    const keyValue = String(key.keyValue).trim();
    if (!tableName || !keyField || !keyValue) return;
    const id = hiddenFeatureId({ keyField, keyValue });
    setHiddenWmsFeatures((prev) => {
      const list = prev.get(tableName);
      if (!list?.some((item) => hiddenFeatureId(item) === id)) return prev;
      const next = new Map(prev);
      const nextList = list.filter((item) => hiddenFeatureId(item) !== id);
      if (nextList.length === 0) next.delete(tableName);
      else next.set(tableName, nextList);
      return next;
    });
    setWmsRefreshToken((t) => t + 1);
  }, []);

  const clearHiddenWmsFeatures = useCallback((tableName?: string) => {
    setHiddenWmsFeatures((prev) => {
      if (!tableName) return new Map();
      if (!prev.has(tableName)) return prev;
      const next = new Map(prev);
      next.delete(tableName);
      return next;
    });
  }, []);

  const tryReleaseWmsHide = useCallback(
    (tableName: string, wmsFeatureId: string | null) => {
      if (!wmsFeatureId) return;
      const key = parseWmsFeatureId(wmsFeatureId);
      if (!key) return;
      const rowId = pendingRowKeyId(key);
      const dirtyItems = collectDirtySaveItems(
        historyRef.current.entries,
        historyRef.current.index
      );
      const stillDirty = dirtyItems.some(
        (item) =>
          item.layer.tableName === tableName &&
          item.rowKey &&
          pendingRowKeyId(item.rowKey) === rowId
      );
      if (!stillDirty) unhideWmsFeature(tableName, key);
    },
    [unhideWmsFeature]
  );

  const ensureEditLayerForEntry = useCallback((entry: EditHistoryEntry) => {
    setWorkLayers((prev) => {
      const targetId = entry.layer.id;
      if (prev.find((w) => w.edit)?.id === targetId) return prev;
      return prev.map((w) => ({
        ...w,
        edit: w.id === targetId,
        view: w.id === targetId ? true : w.view,
      }));
    });
  }, []);

  const hiddenWmsFeaturesByLayer = useMemo(() => new Map(hiddenWmsFeatures), [hiddenWmsFeatures]);

  const applyHistoryEntry = useCallback(
    (entry: EditHistoryEntry | null, atIndex: number) => {
      if (!entry) {
        clearEditingCanvas();
        return;
      }
      ensureEditLayerForEntry(entry);
      isRestoringHistoryRef.current = true;
      setDraftState(draftFromHistoryEntry(entry));
      engineBridgeRef.current?.restoreFromHistory(entry);
      const tableName = entry.layer.tableName;
      const entries = historyRef.current.entries;
      clearHiddenWmsFeatures(tableName);
      if (
        entry.rowKey &&
        isWmsCqlSafeKeyField(entry.rowKey.keyField) &&
        shouldHideWmsForHistoryEntry(entries, atIndex, entry)
      ) {
        hideWmsFeature(tableName, entry.rowKey);
      }
      requestAnimationFrame(() => {
        isRestoringHistoryRef.current = false;
      });
    },
    [clearEditingCanvas, clearHiddenWmsFeatures, ensureEditLayerForEntry, hideWmsFeature]
  );

  const recordGeometrySnapshot = useCallback(
    (action: EditHistoryAction, snapshot?: Partial<ShapeEditorDraftState>) => {
      if (isRestoringHistoryRef.current) return;
      // 도형 이력이 최신 속성을 포함하므로 대기 중 속성 타이머는 취소
      if (attributeHistoryTimerRef.current) {
        clearTimeout(attributeHistoryTimerRef.current);
        attributeHistoryTimerRef.current = null;
      }
      const layer = workLayersRef.current.find((w) => w.edit)?.layer ?? null;
      if (!layer) return;
      const d: ShapeEditorDraftState = { ...draftRef.current, ...snapshot };
      if (!d.wkt5181?.trim()) return;

      setHistoryState((prev) => {
        const sessionKey = buildSessionKey(layer, d);
        const last = prev.entries[prev.index];
        if (last?.wkt5181 === d.wkt5181 && last.action === 'move' && action === 'move') {
          return prev;
        }
        const moveIndex =
          action === 'move'
            ? countSessionMoves(prev.entries.slice(0, prev.index + 1), sessionKey) + 1
            : undefined;
        const entry = buildHistoryEntry(layer, d, action, moveIndex);
        if (!entry) return prev;
        const truncated = prev.entries.slice(0, prev.index + 1);
        const entries = [...truncated, entry];
        const index = entries.length - 1;
        const next = { entries, index };
        historyRef.current = next;
        dirtySaveItemsRef.current = collectDirtySaveItems(entries, index);
        return next;
      });
      setBulkSaveMessage(null);
    },
    []
  );

  const recordDeleteSnapshot = useCallback(
    (snapshot?: Partial<ShapeEditorDraftState>) => {
      if (isRestoringHistoryRef.current) return;
      if (attributeHistoryTimerRef.current) {
        clearTimeout(attributeHistoryTimerRef.current);
        attributeHistoryTimerRef.current = null;
      }
      const layer = workLayersRef.current.find((w) => w.edit)?.layer ?? null;
      if (!layer) return;
      let d: ShapeEditorDraftState = { ...draftRef.current, ...snapshot };

      // draft 가 비어 있으면 현재 세션의 마지막 도형 스냅샷으로 보완
      if (!d.wkt5181?.trim() || (d.changeKind !== 'insert' && !d.rowKey)) {
        const { entries, index } = historyRef.current;
        const sessionKey = buildSessionKey(layer, d);
        const latest =
          latestMeaningfulEntry(entries, index, sessionKey) ??
          (index >= 0 && entries[index]?.layer.tableName === layer.tableName
            ? latestMeaningfulEntry(entries, index, entries[index]!.sessionKey)
            : null);
        if (latest?.wkt5181?.trim()) {
          d = {
            ...d,
            hasGeometry: true,
            wkt5181: latest.wkt5181,
            changeKind: latest.kind === 'insert' ? 'insert' : 'update',
            rowKey: d.rowKey ?? (latest.rowKey ? { ...latest.rowKey } : null),
            wmsFeatureId: d.wmsFeatureId ?? latest.wmsFeatureId,
            selectedFeatureId: d.selectedFeatureId ?? latest.featureId,
            attributeValues:
              Object.keys(d.attributeValues).length > 0
                ? d.attributeValues
                : { ...latest.attributeValues },
            originalAttributeValues:
              Object.keys(d.originalAttributeValues).length > 0
                ? d.originalAttributeValues
                : { ...latest.originalAttributeValues },
          };
        }
      }

      if (!d.wkt5181?.trim()) return;

      const entry = buildDeleteHistoryEntry(layer, d);
      if (!entry) return;

      setHistoryState((prev) => {
        const truncated = prev.entries.slice(0, prev.index + 1);
        const entries = [...truncated, entry];
        const index = entries.length - 1;
        const next = { entries, index };
        historyRef.current = next;
        dirtySaveItemsRef.current = collectDirtySaveItems(entries, index);
        return next;
      });
      setBulkSaveMessage(null);
    },
    []
  );

  const deleteCurrentGeometry = useCallback(() => {
    recordDeleteSnapshot();
    window.dispatchEvent(new Event('shape-editor:clear-geometry'));
    setDraftState(initialDraft);
  }, [recordDeleteSnapshot]);

  const reactivateHistorySession = useCallback(
    (sessionKey: string) => {
      const { entries, index } = historyRef.current;
      const entry = latestMeaningfulEntry(entries, index, sessionKey);
      if (!entry?.wkt5181?.trim()) return;

      ensureEditLayerForEntry(entry);
      isRestoringHistoryRef.current = true;
      setDraftState(draftFromHistoryEntry(entry));
      engineBridgeRef.current?.restoreFromHistory(entry);

      const tableName = entry.layer.tableName;
      if (
        entry.rowKey &&
        isWmsCqlSafeKeyField(entry.rowKey.keyField) &&
        shouldHideWmsForHistoryEntry(entries, index, entry)
      ) {
        hideWmsFeature(tableName, entry.rowKey);
      }

      requestAnimationFrame(() => {
        isRestoringHistoryRef.current = false;
      });
    },
    [ensureEditLayerForEntry, hideWmsFeature]
  );

  const undo = useCallback(() => {
    cancelAttributeHistoryTimer();
    const prev = historyRef.current;
    if (prev.index < 0) return;
    const newIndex = prev.index - 1;
    setHistoryState({ entries: prev.entries, index: newIndex });
    applyHistoryEntry(newIndex >= 0 ? prev.entries[newIndex]! : null, newIndex);
  }, [applyHistoryEntry, cancelAttributeHistoryTimer]);

  const redo = useCallback(() => {
    cancelAttributeHistoryTimer();
    const prev = historyRef.current;
    if (prev.index >= prev.entries.length - 1) return;
    const newIndex = prev.index + 1;
    const entry = prev.entries[newIndex];
    if (!entry) return;
    setHistoryState({ entries: prev.entries, index: newIndex });
    applyHistoryEntry(entry, newIndex);
  }, [applyHistoryEntry, cancelAttributeHistoryTimer]);

  useEffect(() => {
    return () => {
      if (attributeHistoryTimerRef.current) {
        clearTimeout(attributeHistoryTimerRef.current);
        attributeHistoryTimerRef.current = null;
      }
    };
  }, []);

  const canUndo = historyState.index >= 0;
  const canRedo = historyState.index < historyState.entries.length - 1;

  const bulkSavePending = useCallback(async () => {
    flushAttributeHistory();
    const items = collectDirtySaveItems(historyRef.current.entries, historyRef.current.index);
    if (items.length === 0) {
      window.alert('저장할 변경 사항이 없습니다.');
      return;
    }

    setBulkSaving(true);
    setBulkSaveMessage(null);

    try {
      const { savedIds, failed } = await savePendingChangesBatch(items);

      if (savedIds.length > 0) {
        setHiddenWmsFeatures(new Map());
        setWmsRefreshToken((t) => t + 1);
        resetAllEditingState();
      }

      if (failed.length > 0) {
        setBulkSaveMessage(
          `${savedIds.length}건 저장, ${failed.length}건 실패 — ${failed[0]!.error}`
        );
      } else {
        setBulkSaveMessage(`${savedIds.length}건 저장 완료`);
      }
    } catch {
      setBulkSaveMessage('일괄 저장 요청에 실패했습니다.');
    } finally {
      setBulkSaving(false);
    }
  }, [flushAttributeHistory, resetAllEditingState]);

  const hasUnsavedWork = dirtySaveItems.length > 0;

  const addWorkLayer = useCallback(
    (layer: ShapeEditorLayerItem) => {
      const id = workLayerId(layer);
      setWorkLayers((prev) => {
        if (prev.some((w) => w.id === id)) return prev;
        if (id === DEFAULT_JIJUK_WORK_LAYER.id) return prev;
        const hasEdit = prev.some((w) => w.edit);
        return [
          ...prev,
          {
            id,
            layer,
            view: true,
            edit: !hasEdit,
            snap: false,
          },
        ];
      });
      if (draftRef.current.hasGeometry) clearEditingCanvas();
    },
    [clearEditingCanvas]
  );

  const removeWorkLayer = useCallback(
    (id: string) => {
      setWorkLayers((prev) => {
        const target = prev.find((w) => w.id === id);
        if (target && isReadOnlyWorkLayer(target)) return prev;
        const next = prev.filter((w) => w.id !== id);
        if (next.length > 0 && !next.some((w) => w.edit)) {
          const firstEditable = next.find((w) => !isReadOnlyWorkLayer(w));
          if (firstEditable) {
            return next.map((w) => ({
              ...w,
              edit: w.id === firstEditable.id,
              view: w.id === firstEditable.id ? true : w.view,
            }));
          }
        }
        return next;
      });
      clearEditingCanvas();
    },
    [clearEditingCanvas]
  );

  const setWorkLayerView = useCallback((id: string, view: boolean) => {
    setWorkLayers((prev) => prev.map((w) => (w.id === id ? { ...w, view } : w)));
  }, []);

  const setWorkLayerEdit = useCallback(
    (id: string) => {
      const target = workLayers.find((w) => w.id === id);
      if (target && isReadOnlyWorkLayer(target)) return;
      const current = workLayers.find((w) => w.edit);
      if (current?.id === id) return;
      clearEditingCanvas();
      setWorkLayers((prev) =>
        prev.map((w) => ({
          ...w,
          edit: w.id === id,
          view: w.id === id ? true : w.view,
        }))
      );
      setEditModeState('new');
    },
    [clearEditingCanvas, workLayers]
  );

  const setWorkLayerSnap = useCallback((id: string, snap: boolean) => {
    setWorkLayers((prev) =>
      prev.map((w) => {
        if (w.id === id) {
          if (!snap) return { ...w, snap: false };
          return { ...w, snap: true, view: true };
        }
        return { ...w, snap: false };
      })
    );
  }, []);

  const setEditMode = useCallback((mode: ShapeEditorEditMode) => {
    setEditModeState(mode);
    setToolMode('select');
  }, []);

  const refreshWms = useCallback(() => {
    setWmsRefreshToken((t) => t + 1);
  }, []);

  const activeEditLayer = useMemo(
    () => workLayers.find((w) => w.edit)?.layer ?? null,
    [workLayers]
  );

  const visibleLayerNames = useMemo(
    () => new Set(workLayers.filter((w) => w.view).map((w) => w.layer.tableName)),
    [workLayers]
  );

  /** 작업 레이어 shpType → WMS 면·선·점 쌓음 순서 */
  const layerGeometryTypes = useMemo(() => {
    const out: Record<string, 'POINT' | 'LINE' | 'POLYGON'> = {};
    for (const w of workLayers) {
      if (!w.view) continue;
      const t = String(w.layer.shpType ?? '').toUpperCase();
      if (t.includes('POINT')) out[w.layer.tableName] = 'POINT';
      else if (t.includes('LINE')) out[w.layer.tableName] = 'LINE';
      else out[w.layer.tableName] = 'POLYGON';
    }
    return out;
  }, [workLayers]);

  const snapWorkLayer = useMemo(
    () => workLayers.find((w) => w.snap)?.layer ?? null,
    [workLayers]
  );

  const snapLayerNames = useMemo(
    () =>
      snapWorkLayer
        ? new Set([snapWorkLayer.tableName])
        : new Set<string>(),
    [snapWorkLayer]
  );

  const value = useMemo(
    () => ({
      mapInstanceRef,
      mapReady,
      registerMap,
      workLayers,
      addWorkLayer,
      removeWorkLayer,
      setWorkLayerView,
      setWorkLayerEdit,
      setWorkLayerSnap,
      activeEditLayer,
      snapWorkLayer,
      visibleLayerNames,
      layerGeometryTypes,
      snapLayerNames,
      toolMode,
      setToolMode,
      editMode,
      setEditMode,
      draft,
      setDraft,
      setAttributeValue,
      onFeatureSelected,
      registerEngineBridge,
      refreshWms,
      wmsRefreshToken,
      confirmDirtyOrProceed,
      hiddenWmsFeaturesByLayer,
      hideWmsFeature,
      unhideWmsFeature,
      clearHiddenWmsFeatures,
      tryReleaseWmsHide,
      editHistory: historyState.entries,
      historyIndex: historyState.index,
      recordGeometrySnapshot,
      recordDeleteSnapshot,
      deleteCurrentGeometry,
      reactivateHistorySession,
      undo,
      redo,
      canUndo,
      canRedo,
      dirtySaveItems,
      bulkSavePending,
      bulkSaving,
      bulkSaveMessage,
      hasUnsavedWork,
    }),
    [
      mapReady,
      registerMap,
      workLayers,
      addWorkLayer,
      removeWorkLayer,
      setWorkLayerView,
      setWorkLayerEdit,
      setWorkLayerSnap,
      activeEditLayer,
      snapWorkLayer,
      visibleLayerNames,
      layerGeometryTypes,
      snapLayerNames,
      toolMode,
      editMode,
      draft,
      setDraft,
      setAttributeValue,
      onFeatureSelected,
      registerEngineBridge,
      refreshWms,
      wmsRefreshToken,
      confirmDirtyOrProceed,
      hiddenWmsFeaturesByLayer,
      hideWmsFeature,
      unhideWmsFeature,
      clearHiddenWmsFeatures,
      tryReleaseWmsHide,
      historyState.entries,
      historyState.index,
      recordGeometrySnapshot,
      recordDeleteSnapshot,
      deleteCurrentGeometry,
      reactivateHistorySession,
      undo,
      redo,
      canUndo,
      canRedo,
      dirtySaveItems,
      bulkSavePending,
      bulkSaving,
      bulkSaveMessage,
      hasUnsavedWork,
    ]
  );

  return <ShapeEditorContext.Provider value={value}>{children}</ShapeEditorContext.Provider>;
}

export function useShapeEditorContext(): ShapeEditorContextValue {
  const ctx = useContext(ShapeEditorContext);
  if (!ctx) throw new Error('useShapeEditorContext must be used within ShapeEditorProvider');
  return ctx;
}
