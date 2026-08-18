"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { call } from "@/lib/api";
import { tryFormatToYmd } from "@/lib/formatDateYmd";
import { useMapContext } from "../MapContext";
import { refreshServiceWmsLayer } from "../layerFactory/serviceLayerFactory";
import { LAYER_ROW_GEOM_CLEAR_SENTINEL } from "./LayerRowGeomEditHandler";
import { fetchReadOnlyFieldSet } from "./buildFormAttributes";
import { parcelAddressesFromItems, fitMapToLayerRowParcel } from "./layerRowParcelUtils";
import { resolveParcelGeoms } from "./resolveParcelGeoms";
import {
  validateDefineRequiredFields,
  validateOccupationPeriodAndGeom,
} from "./validateOccupationPeriodAndGeom";
import type { LayerRowDetailAttr, LayerRowEditPreset, LayerRowParcelItem } from "./types";

function toDateInputValue(raw: string): string {
  const ymd = tryFormatToYmd(raw);
  return ymd ?? "";
}

function buildDraftFromRow(
  attributes: LayerRowDetailAttr[],
  row: Record<string, string>,
  dateFields: Set<string>
): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const attr of attributes) {
    const key = attr.field;
    const raw = row[key] ?? row[Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase()) ?? ""] ?? "";
    draft[key] = dateFields.has(key.toLowerCase()) ? toDateInputValue(raw) : String(raw ?? "");
  }
  return draft;
}

function buildEmptyDraft(attributes: LayerRowDetailAttr[]): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const attr of attributes) draft[attr.field] = "";
  return draft;
}

function draftValueEqual(a: string, b: string): boolean {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

type UseLayerRowEditArgs = {
  preset: LayerRowEditPreset;
  rowKey: string;
  attributes: LayerRowDetailAttr[];
  initialParcels?: LayerRowParcelItem[];
  isCreateMode?: boolean;
  onReload: (savedKey?: string) => void | Promise<void>;
  onCreated?: (newKey: string) => void;
  onDeleted?: () => void;
  onCancelCreate?: () => void;
  /** 추가 필지 지도 이동 시 WMS 레이어 표시용 */
  wmsLayerId?: string;
};

export function useLayerRowEdit({
  preset,
  rowKey,
  attributes,
  initialParcels = [],
  isCreateMode = false,
  onReload,
  onCreated,
  onDeleted,
  onCancelCreate,
  wmsLayerId,
}: UseLayerRowEditArgs) {
  const { data: session } = useSession();
  const logUser = useMemo(() => {
    const id = String(session?.user?.id ?? "").trim();
    const name = String(session?.user?.name ?? "").trim();
    if (id && name) return `${id}(${name})`;
    return id || name || undefined;
  }, [session?.user?.id, session?.user?.name]);

  const mapContext = useMapContext();
  const setLayerRowGeomEdit = mapContext?.setLayerRowGeomEdit;
  const layerRowGeomEditWktRef = mapContext?.layerRowGeomEditWktRef;
  const layerRowGeomEditDirtyRef = mapContext?.layerRowGeomEditDirtyRef;
  const layerRowParcelApplyRef = mapContext?.layerRowParcelApplyRef;
  const layerRowParcelRemoveRef = mapContext?.layerRowParcelRemoveRef;
  const setLayerRowDraftParcels = mapContext?.setLayerRowDraftParcels;

  const [isEditing, setIsEditing] = useState(isCreateMode);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [readOnlyFields, setReadOnlyFields] = useState<Set<string>>(new Set());
  const [draftParcels, setDraftParcels] = useState<LayerRowParcelItem[]>([]);
  const prevEditingRef = useRef(false);
  const baselineDraftRef = useRef<Record<string, string>>({});

  const dateFields = useMemo(
    () => new Set((preset.dateFields ?? []).map((f) => f.toLowerCase())),
    [preset.dateFields]
  );

  const keyFieldLower = String(preset.keyField ?? "id").toLowerCase();
  const activeGeomSessionRef = useRef<string | null>(null);

  const stopGeomEdit = useCallback(() => {
    activeGeomSessionRef.current = null;
    setLayerRowGeomEdit?.(null);
    if (layerRowGeomEditWktRef) layerRowGeomEditWktRef.current = null;
    if (layerRowGeomEditDirtyRef) layerRowGeomEditDirtyRef.current = false;
  }, [layerRowGeomEditDirtyRef, layerRowGeomEditWktRef, setLayerRowGeomEdit]);

  const startGeomEdit = useCallback(
    (mode: "draw" | "modify", keyValue: string) => {
      if (!setLayerRowGeomEdit) return;
      const sessionKey = `${preset.tableName}|${mode}|${keyValue}|${preset.keyField ?? "id"}|${preset.schema ?? ""}`;
      if (activeGeomSessionRef.current === sessionKey) return;
      activeGeomSessionRef.current = sessionKey;
      mapContext?.clearMapDrawInteractionsRef?.current?.("layerRowGeomEdit");
      mapContext?.setSpatialDrawRequest?.(null);
      if (layerRowGeomEditWktRef) layerRowGeomEditWktRef.current = null;
      if (layerRowGeomEditDirtyRef) layerRowGeomEditDirtyRef.current = false;
      setLayerRowGeomEdit({
        layerName: preset.tableName,
        schema: preset.schema,
        keyField: preset.keyField ?? "id",
        keyValue,
        mode,
        allowEmptyGeom:
          preset.allowEmptyGeom === true || !!preset.requirePeriodAndGeomOnSave,
      });
    },
    [
      layerRowGeomEditDirtyRef,
      layerRowGeomEditWktRef,
      mapContext?.clearMapDrawInteractionsRef,
      mapContext?.setSpatialDrawRequest,
      preset.allowEmptyGeom,
      preset.keyField,
      preset.requirePeriodAndGeomOnSave,
      preset.schema,
      preset.tableName,
      setLayerRowGeomEdit,
    ]
  );

  useEffect(() => {
    if (isCreateMode) {
      startGeomEdit("draw", "");
      return () => stopGeomEdit();
    }
    if (!isEditing) stopGeomEdit();
  }, [isCreateMode, isEditing, startGeomEdit, stopGeomEdit]);

  useEffect(() => () => stopGeomEdit(), [stopGeomEdit]);

  useEffect(() => {
    if (isEditing && !prevEditingRef.current) {
      // DB 필지는 자동목록 — 수동(추가)만 showMapGeom:true. 그래야 도형수정 replaceAuto가 갱신됨
      const base = isCreateMode
        ? []
        : initialParcels.map((p) => ({ ...p, showMapGeom: false as const }));
      setDraftParcels(base);
      if (base.length > 0) {
        void resolveParcelGeoms(base).then((resolved) => {
          // 도형교차 자동목록이 먼저 반영된 경우 덮어쓰지 않고 주소별 geom만 병합
          setDraftParcels((prev) => {
            if (prev.length === 0) return prev;
            const byKey = new Map(
              resolved.map((r) => [String(r.address ?? "").toLowerCase(), r])
            );
            return prev.map((p) => {
              const r = byKey.get(String(p.address ?? "").toLowerCase());
              if (!r) return p;
              return {
                ...p,
                pnu: r.pnu ?? p.pnu,
                extent3857: r.extent3857 ?? p.extent3857,
                geometry3857: r.geometry3857 ?? p.geometry3857,
              };
            });
          });
        });
      }
    }
    // 빈 배열을 매번 setState 하면 참조가 바뀌어 Maximum update depth 유발
    if (!isEditing) {
      setDraftParcels((prev) => (prev.length === 0 ? prev : []));
    }
    prevEditingRef.current = isEditing;
  }, [initialParcels, isCreateMode, isEditing]);

  useEffect(() => {
    if (!setLayerRowDraftParcels) return;
    if (isEditing) {
      setLayerRowDraftParcels(draftParcels);
    } else {
      setLayerRowDraftParcels([]);
    }
  }, [draftParcels, isEditing, setLayerRowDraftParcels]);

  useLayoutEffect(() => {
    if (!isEditing || !layerRowParcelApplyRef) return;
    layerRowParcelApplyRef.current = (items, options) => {
      setDraftParcels((prev) => {
        const autoItems = items.map((item) => ({ ...item, showMapGeom: false as const }));
        if (options?.replaceAuto) {
          const manual = prev.filter((p) => p.showMapGeom === true);
          const seen = new Set(manual.map((p) => p.address.toLowerCase()));
          const merged = [...manual];
          for (const item of autoItems) {
            const key = item.address.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(item);
          }
          return merged;
        }
        const seen = new Set(prev.map((p) => p.address.toLowerCase()));
        const merged = [...prev];
        for (const item of autoItems) {
          const key = item.address.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(item);
        }
        return merged;
      });
    };
    return () => {
      layerRowParcelApplyRef.current = null;
    };
  }, [isEditing, layerRowParcelApplyRef]);

  useEffect(() => {
    if (isCreateMode) {
      setIsEditing(true);
      setEditError(null);
      let cancelled = false;
      void fetchReadOnlyFieldSet(preset).then((locked) => {
        if (cancelled) return;
        if (preset.keyFieldEditableOnCreate && preset.keyField) {
          locked.delete(String(preset.keyField).toLowerCase());
        }
        setReadOnlyFields(locked);
        /**
         * attributes 참조가 바뀔 때마다(키·허가번호 미리보기 등) draft를 통째로
         * 비우면 도형 중심주소·사용자 입력이 사라짐 → 기존 값은 유지하고 빈 칸만 채움.
         */
        setDraft((prev) => {
          const had = Object.keys(prev).length > 0;
          if (!had) {
            const empty = buildEmptyDraft(attributes);
            baselineDraftRef.current = { ...empty };
            return empty;
          }
          const next = { ...prev };
          for (const attr of attributes) {
            if (!(attr.field in next)) next[attr.field] = "";
            if (!(attr.field in baselineDraftRef.current)) {
              baselineDraftRef.current[attr.field] = "";
            }
          }
          return next;
        });
      });
      return () => {
        cancelled = true;
      };
    }
    setIsEditing(false);
    setDraft({});
    baselineDraftRef.current = {};
    setEditError(null);
  }, [attributes, isCreateMode, preset, rowKey]);

  const handleEdit = useCallback(async () => {
    const id = String(rowKey ?? "").trim();
    if (!id || isCreateMode) return;
    setEditError(null);
    try {
      const res = await call("", "POST", {
        service: "layerRowService",
        action: "getTableRowForEdit",
        params: {
          table: preset.tableName,
          schema: preset.schema,
          keyField: preset.keyField,
          keyValue: id,
        },
      });
      const data = res?.data ?? res;
      if (data?.error) {
        setEditError(String(data.error));
        return;
      }
      const row = (data?.row ?? null) as Record<string, string> | null;
      if (!row) {
        setEditError("수정용 데이터를 불러오지 못했습니다.");
        return;
      }

      const locked = await fetchReadOnlyFieldSet(preset);
      setReadOnlyFields(locked);
      const nextDraft = buildDraftFromRow(attributes, row, dateFields);
      baselineDraftRef.current = { ...nextDraft };
      setDraft(nextDraft);
      setIsEditing(true);
      startGeomEdit("modify", id);
    } catch {
      setEditError("수정 모드 전환에 실패했습니다.");
    }
  }, [attributes, dateFields, isCreateMode, preset, rowKey, startGeomEdit]);

  const handleCancel = useCallback(() => {
    stopGeomEdit();
    if (isCreateMode) {
      onCancelCreate?.();
      return;
    }
    setIsEditing(false);
    setDraft({});
    baselineDraftRef.current = {};
    setEditError(null);
  }, [isCreateMode, onCancelCreate, stopGeomEdit]);

  const handleDraftChange = useCallback((field: string, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const collectChanges = useCallback(() => {
    const changes: Record<string, string> = {};
    const baseline = baselineDraftRef.current;
    for (const attr of attributes) {
      const field = attr.field;
      if (readOnlyFields.has(field.toLowerCase())) continue;
      if (!(field in draft)) continue;
      const next = draft[field] ?? "";
      const prev = baseline[field] ?? "";
      if (draftValueEqual(next, prev)) continue;
      changes[field] = next;
    }
    return changes;
  }, [attributes, draft, readOnlyFields]);

  const addDraftParcel = useCallback((item: LayerRowParcelItem) => {
    const key = item.address.toLowerCase();
    const nextItem: LayerRowParcelItem = { ...item, showMapGeom: true };
    setDraftParcels((prev) => {
      if (prev.some((p) => p.address.toLowerCase() === key)) return prev;
      return [...prev, nextItem];
    });
    void resolveParcelGeoms([nextItem]).then(([resolved]) => {
      if (!resolved?.geometry3857) return;
      const merged: LayerRowParcelItem = {
        ...nextItem,
        extent3857: resolved.extent3857 ?? nextItem.extent3857,
        geometry3857: resolved.geometry3857,
        showMapGeom: true,
      };
      setDraftParcels((prev) =>
        prev.map((p) => (p.address.toLowerCase() === key ? merged : p))
      );
      const map = mapContext?.mapInstanceRef?.current;
      if (map) {
        fitMapToLayerRowParcel(map, merged, {
          wmsLayerId,
          setVisibleLayerNames: mapContext?.setVisibleLayerNames,
          applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
        });
      }
    });
  }, [mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef, mapContext?.setVisibleLayerNames, wmsLayerId]);

  const removeDraftParcel = useCallback(
    (index: number) => {
      let removed: LayerRowParcelItem | undefined;
      setDraftParcels((prev) => {
        removed = prev[index];
        return prev.filter((_, i) => i !== index);
      });
      if (!removed) return;
      void (async () => {
        let target = removed!;
        const hasSubtractGeom =
          target.geometry3857 != null ||
          String(target.pnu ?? "").trim().length >= 18;
        if (!hasSubtractGeom) {
          const [resolved] = await resolveParcelGeoms([target]);
          if (resolved) target = resolved;
        }
        void layerRowParcelRemoveRef?.current?.(target);
      })();
    },
    [layerRowParcelRemoveRef]
  );

  const syncChildParcels = useCallback(
    async (parentId: string) => {
      const childTableName = String(preset.childTableName ?? "").trim();
      if (!childTableName) return { ok: true as const };
      const addresses = parcelAddressesFromItems(draftParcels);
      const parcels = draftParcels.map((p) => ({
        address: String(p.address ?? "").trim(),
        pnu: String(p.pnu ?? "").trim() || undefined,
      }));
      const res = await call("", "POST", {
        service: "layerRowService",
        action: "syncChildParcelsByParentId",
        params: {
          schema: preset.schema,
          childTableName,
          childParentField: preset.childParentField,
          childAddressField: preset.childAddressField,
          parentId,
          parcels,
          addresses,
        },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.success === false) {
        return { ok: false as const, error: String(data?.error ?? "필지목록 저장에 실패했습니다.") };
      }
      return { ok: true as const };
    },
    [draftParcels, preset.childAddressField, preset.childParentField, preset.childTableName, preset.schema]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setEditError(null);
    try {
      const changes = collectChanges();
      const wktRaw = layerRowGeomEditWktRef?.current;
      const geomDirty = layerRowGeomEditDirtyRef?.current === true;
      const geomClear = geomDirty && wktRaw === LAYER_ROW_GEOM_CLEAR_SENTINEL;
      const geomWkt5181 =
        geomDirty && wktRaw != null && wktRaw !== LAYER_ROW_GEOM_CLEAR_SENTINEL
          ? wktRaw
          : null;

      const defineRequiredMsg = validateDefineRequiredFields(attributes, draft);
      if (defineRequiredMsg) {
        setEditError(defineRequiredMsg);
        return;
      }

      const periodGeomMsg = validateOccupationPeriodAndGeom(preset, draft, wktRaw);
      if (periodGeomMsg) {
        setEditError(periodGeomMsg);
        return;
      }

      if (isCreateMode) {
        const res = await call("", "POST", {
          service: "layerRowService",
          action: "insertTableRow",
          params: {
            table: preset.tableName,
            schema: preset.schema,
            keyField: preset.keyField,
            values: changes,
            excludeFields: preset.excludeFields,
            includeHiddenDetail: preset.includeHiddenDetail,
            geomWkt5181,
            logUser,
          },
        });
        const data = res?.data ?? res;
        if (data?.error || data?.success === false) {
          setEditError(String(data?.error ?? "등록에 실패했습니다."));
          return;
        }
        const newKey = String(data?.keyValue ?? "").trim();
        if (!newKey) {
          setEditError("등록 후 키를 확인하지 못했습니다.");
          return;
        }
        const parcelSync = await syncChildParcels(newKey);
        if (!parcelSync.ok) {
          setEditError(parcelSync.error ?? "필지목록 저장에 실패했습니다.");
          return;
        }
        onCreated?.(newKey);
        stopGeomEdit();
        await onReload(newKey);
        return;
      }

      const id = String(rowKey ?? "").trim();
      if (!id) return;

      if (Object.keys(changes).length === 0 && !geomWkt5181 && !geomClear) {
        // 속성·도형 변경 없음 — 필지목록만 동기화 가능
        const parcelSync = await syncChildParcels(id);
        if (!parcelSync.ok) {
          setEditError(parcelSync.error ?? "필지목록 저장에 실패했습니다.");
          return;
        }
        setIsEditing(false);
        setDraft({});
        baselineDraftRef.current = {};
        stopGeomEdit();
        await onReload();
        return;
      }

      const res = await call("", "POST", {
        service: "layerRowService",
        action: "updateTableRowByKey",
        params: {
          table: preset.tableName,
          schema: preset.schema,
          keyField: preset.keyField,
          keyValue: id,
          changes,
          excludeFields: preset.excludeFields,
          includeHiddenDetail: preset.includeHiddenDetail,
          geomWkt5181,
          geomClear,
          logUser,
        },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.success === false) {
        setEditError(String(data?.error ?? "저장에 실패했습니다."));
        return;
      }
      const parcelSync = await syncChildParcels(id);
      if (!parcelSync.ok) {
        setEditError(parcelSync.error ?? "필지목록 저장에 실패했습니다.");
        return;
      }
      setIsEditing(false);
      setDraft({});
      baselineDraftRef.current = {};
      stopGeomEdit();
      await onReload(id);
    } catch {
      setEditError(isCreateMode ? "등록에 실패했습니다." : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }, [
    attributes,
    collectChanges,
    draft,
    isCreateMode,
    layerRowGeomEditDirtyRef,
    layerRowGeomEditWktRef,
    logUser,
    onCreated,
    onReload,
    preset,
    rowKey,
    stopGeomEdit,
    syncChildParcels,
  ]);

  const handleDelete = useCallback(async () => {
    const id = String(rowKey ?? "").trim();
    if (!id || isCreateMode) return;
    const deleteConfirmMsg = preset.additionalChildTableNames?.length
      ? "이 항목을 삭제하시겠습니까?\n연결된 필지·물건지 정보도 함께 삭제됩니다."
      : "이 항목을 삭제하시겠습니까?\n연결된 필지 정보도 함께 삭제됩니다.";
    if (!window.confirm(deleteConfirmMsg)) return;

    setDeleting(true);
    setEditError(null);
    try {
      const childTableNames = [
        preset.childTableName,
        ...(preset.additionalChildTableNames ?? []),
      ]
        .map((name) => String(name ?? "").trim())
        .filter(Boolean);
      const res = await call("", "POST", {
        service: "layerRowService",
        action: "deleteTableRowByKey",
        params: {
          table: preset.tableName,
          schema: preset.schema,
          keyField: preset.keyField,
          keyValue: id,
          childTableName: preset.childTableName,
          childTableNames,
          childParentField: preset.childParentField,
          logUser,
        },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.success === false) {
        setEditError(String(data?.error ?? "삭제에 실패했습니다."));
        return;
      }
      stopGeomEdit();
      const map = mapContext?.mapInstanceRef?.current;
      refreshServiceWmsLayer(map);
      requestAnimationFrame(() => refreshServiceWmsLayer(map));
      onDeleted?.();
    } catch {
      setEditError("삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }, [isCreateMode, logUser, mapContext?.mapInstanceRef, onDeleted, preset, rowKey, stopGeomEdit]);

  return {
    isEditing,
    isCreateMode,
    saving,
    deleting,
    editError,
    draft,
    readOnlyFields,
    dateFields,
    handleEdit,
    handleCancel,
    handleSave,
    handleDelete,
    handleDraftChange,
    draftParcels,
    addDraftParcel,
    removeDraftParcel,
  };
}
