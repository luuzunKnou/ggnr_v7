"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { call } from "@/lib/api";
import {
  LAYER_ROW_EDIT_PRESETS,
  LAYER_ROW_NEW_ID,
  LayerParcelAddModal,
  LayerRowEditFooter,
  LayerRowEditHeader,
  useLayerRowEdit,
  useLayerParcelNavigation,
  useLayerRowFormFields,
  type LayerRowDetailAttr,
  type LayerRowParcelItem,
} from "../../../_mapComponents/layerRowEdit";
import { UsageDataAsAttributeSection } from "./UsageDataAsAttributeSection";
import { fitMapToLayerRowParcel } from "../../../_mapComponents/layerRowEdit/layerRowParcelUtils";
import { resolveParcelGeoms } from "../../../_mapComponents/layerRowEdit/resolveParcelGeoms";
import {
  USAGE_DATA_AS_MGJ_WMS_LAYER_ID,
  USAGE_DATA_AS_SOLO_WMS_LAYER_ID,
  USAGE_DATA_AS_WMS_LAYER_ID,
} from "./usageDataAsLayerId";
import { UsageDataAsAddressList } from "./UsageDataAsAddressList";
import { useLayerRowParcelHighlight, type LayerRowParcelHighlightVariant } from "../../../_mapComponents/layerRowEdit/useLayerRowParcelHighlight";
import { useLayerRowParcelDraftPreview } from "../../../_mapComponents/layerRowEdit/useLayerRowParcelDraftPreview";
import { useUsageDataAsParentGeomHighlight } from "./useUsageDataAsParentGeomHighlight";
import {
  ensureUsageDataAsWmsLayersVisible,
  refreshUsageDataAsMapView,
} from "./usageDataAsMapSync";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { resolveParcelItemIntersectParentForHighlight } from "../../../_mapComponents/layerRowEdit/resolveParcelItemIntersectParentForHighlight";

type Props = {
  detailId: string;
  onClose: () => void;
  onSaved?: () => void;
  onCreated?: (newKey: string) => void;
  onDeleted?: () => void;
};

export function UsageDataAsDetailPanel({
  detailId,
  onClose,
  onSaved,
  onCreated,
  onDeleted,
}: Props) {
  const mapContext = useMapContext();
  const preset = LAYER_ROW_EDIT_PRESETS.usageDataAs;
  const isCreateMode = detailId === LAYER_ROW_NEW_ID;

  const [loading, setLoading] = useState(!isCreateMode);
  const [error, setError] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<LayerRowDetailAttr[]>([]);
  const [parcels, setParcels] = useState<LayerRowParcelItem[]>([]);
  const [mgjItems, setMgjItems] = useState<LayerRowParcelItem[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  const [draftMgj, setDraftMgj] = useState<LayerRowParcelItem[]>([]);
  const draftMgjRef = useRef<LayerRowParcelItem[]>([]);
  const mgjDirtyRef = useRef(false);
  const [mgjAddModalOpen, setMgjAddModalOpen] = useState(false);
  const [parcelAddModalOpen, setParcelAddModalOpen] = useState(false);
  const [nextConsCode, setNextConsCode] = useState("");
  const [highlightParcel, setHighlightParcel] = useState<LayerRowParcelItem | null>(null);
  const [highlightVariant, setHighlightVariant] = useState<LayerRowParcelHighlightVariant>("blue");
  const [showParentGeom, setShowParentGeom] = useState(true);

  const {
    selectParcel: selectSoloParcel,
    selectedParcelIdx: selectedSoloIdx,
    clearSelection: clearSoloSelection,
  } = useLayerParcelNavigation(USAGE_DATA_AS_SOLO_WMS_LAYER_ID);
  const {
    selectParcel: selectMgjParcel,
    selectedParcelIdx: selectedMgjIdx,
    clearSelection: clearMgjSelection,
  } = useLayerParcelNavigation(USAGE_DATA_AS_MGJ_WMS_LAYER_ID);

  const { formAttributes, formFieldsLoading } = useLayerRowFormFields(preset, isCreateMode);

  const loadDetail = useCallback(async () => {
    const key = String(detailId ?? "").trim();
    if (!key || key === LAYER_ROW_NEW_ID) {
      setAttributes([]);
      setParcels([]);
      setMgjItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await call("", "POST", {
        service: "usageDataAsService",
        action: "getUsageDataAsDetailByKey",
        params: { key },
      });
      const data = res?.data ?? res;
      if (data?.error) {
        setAttributes([]);
        setParcels([]);
        setMgjItems([]);
        setError(String(data.error));
        return;
      }
      setAttributes(Array.isArray(data?.attributes) ? data.attributes : []);

      const toParcelItems = (arr: unknown): LayerRowParcelItem[] => {
        if (!Array.isArray(arr)) return [];
        return arr
          .map((x: Record<string, unknown>) => {
            const address = String(x?.address ?? "").trim();
            if (!address) return null;
            const extRaw = x?.extent3857 as unknown;
            const extent3857: [number, number, number, number] | null =
              Array.isArray(extRaw) && extRaw.length === 4 && extRaw.every((v) => Number.isFinite(Number(v)))
                ? (extRaw.map((v) => Number(v)) as [number, number, number, number])
                : null;
            const wmsRaw = x?.wmsRowKey as { keyField?: string; keyValue?: string } | undefined;
            const keyField = String(wmsRaw?.keyField ?? "").trim();
            const keyValue = String(wmsRaw?.keyValue ?? "").trim();
            const wmsRowKey = keyField && keyValue ? { keyField, keyValue } : undefined;
            return { address, extent3857, ...(wmsRowKey ? { wmsRowKey } : {}) };
          })
          .filter((x): x is LayerRowParcelItem => x != null);
      };

      setParcels(toParcelItems(data?.parcelItems));
      setMgjItems(toParcelItems(data?.mgjItems));
    } catch {
      setAttributes([]);
      setParcels([]);
      setMgjItems([]);
      setError("상세 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [detailId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, reloadToken]);

  useEffect(() => {
    setHighlightParcel(null);
    setHighlightVariant("blue");
    setShowParentGeom(true);
    clearSoloSelection();
    clearMgjSelection();
  }, [detailId, clearMgjSelection, clearSoloSelection]);

  const handleReload = useCallback(async (savedKey?: string) => {
    const key = String(savedKey ?? detailId ?? "").trim();
    if (key && key !== LAYER_ROW_NEW_ID && mgjDirtyRef.current) {
      try {
        await call("", "POST", {
          service: "usageDataAsService",
          action: "syncUsageDataAsMgjByConsCode",
          params: {
            consCode: key,
            items: draftMgjRef.current.map((p) => ({
              address: p.address,
              pnu: p.pnu,
              x4326: p.point4326?.x,
              y4326: p.point4326?.y,
            })),
          },
        });
      } catch {
        /* ignore */
      }
      mgjDirtyRef.current = false;
    }
    setHighlightParcel(null);
    setShowParentGeom(true);
    clearSoloSelection();
    clearMgjSelection();
    setReloadToken((t) => t + 1);
    if (key && key !== LAYER_ROW_NEW_ID) {
      await refreshUsageDataAsMapView({
        map: mapContext?.mapInstanceRef?.current,
        detailId: key,
        setVisibleLayerNames: mapContext?.setVisibleLayerNames,
        applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current ?? null,
      });
    }
    onSaved?.();
  }, [
    clearMgjSelection,
    clearSoloSelection,
    detailId,
    mapContext?.applyMapViewPaddingRef,
    mapContext?.mapInstanceRef,
    mapContext?.setVisibleLayerNames,
    onSaved,
  ]);

  const formAttributesForEdit = useMemo(() => {
    const base = isCreateMode ? formAttributes : attributes;
    if (!isCreateMode) return base;
    return base.map((row) =>
      row.field.toLowerCase() === "cons_code"
        ? { ...row, value: nextConsCode || row.value || "" }
        : row
    );
  }, [attributes, formAttributes, isCreateMode, nextConsCode]);

  useEffect(() => {
    if (!isCreateMode) {
      setNextConsCode("");
      return;
    }
    let cancelled = false;
    void call("", "POST", {
      service: "usageDataAsService",
      action: "getNextUsageDataAsConsCode",
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setNextConsCode(String(data?.consCode ?? "").trim());
      })
      .catch(() => {
        if (!cancelled) setNextConsCode("");
      });
    return () => {
      cancelled = true;
    };
  }, [isCreateMode]);

  const {
    isEditing,
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
  } = useLayerRowEdit({
    preset,
    rowKey: isCreateMode ? "" : detailId,
    attributes: formAttributesForEdit,
    initialParcels: parcels,
    isCreateMode,
    onReload: handleReload,
    onCreated: (newKey) => onCreated?.(newKey),
    onDeleted: () => {
      setHighlightParcel(null);
      setShowParentGeom(false);
      onDeleted?.();
    },
    onCancelCreate: onClose,
    wmsLayerId: USAGE_DATA_AS_SOLO_WMS_LAYER_ID,
  });

  useLayerRowParcelHighlight(
    showParentGeom ? null : highlightParcel,
    highlightVariant
  );
  useLayerRowParcelDraftPreview(draftMgj, "red", isEditing);
  const { parentExtentRef } = useUsageDataAsParentGeomHighlight(
    detailId,
    showParentGeom && !isCreateMode,
    isEditing,
    reloadToken
  );

  useEffect(() => {
    if (!isEditing) setShowParentGeom(true);
  }, [isEditing]);

  const focusParentGeomOnMap = useCallback(() => {
    setShowParentGeom(true);
    setHighlightParcel(null);
    if (isEditing) return;

    const map = mapContext?.mapInstanceRef?.current;
    const ext = parentExtentRef.current;
    if (!map || !ext) return;
    ensureUsageDataAsWmsLayersVisible(mapContext?.setVisibleLayerNames);
    scheduleFitMapToExtent3857(map, ext, {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });
  }, [isEditing, mapContext, parentExtentRef]);

  useEffect(() => {
    if (isEditing) {
      const base = [...mgjItems];
      setDraftMgj(base);
      draftMgjRef.current = base;
      mgjDirtyRef.current = false;
    } else {
      setDraftMgj([]);
      draftMgjRef.current = [];
    }
  }, [isEditing, mgjItems]);

  useEffect(() => {
    draftMgjRef.current = draftMgj;
  }, [draftMgj]);

  const handleAddMgj = useCallback(
    (item: LayerRowParcelItem) => {
      const addrKey = item.address.toLowerCase();
      const nextItem: LayerRowParcelItem = { ...item, showMapGeom: true };
      setDraftMgj((prev) => {
        if (prev.some((p) => p.address.toLowerCase() === addrKey)) return prev;
        mgjDirtyRef.current = true;
        return [...prev, nextItem];
      });
      void resolveParcelGeoms([nextItem]).then(([resolved]) => {
        if (!resolved?.geometry3857) return;
        const merged: LayerRowParcelItem = {
          ...nextItem,
          pnu: resolved.pnu ?? nextItem.pnu,
          extent3857: resolved.extent3857 ?? nextItem.extent3857,
          geometry3857: resolved.geometry3857,
          showMapGeom: true,
        };
        setDraftMgj((prev) =>
          prev.map((p) => (p.address.toLowerCase() === addrKey ? merged : p))
        );
        setShowParentGeom(false);
        setHighlightVariant("red");
        setHighlightParcel(merged);
        clearSoloSelection();
        ensureUsageDataAsWmsLayersVisible(mapContext?.setVisibleLayerNames);
        const map = mapContext?.mapInstanceRef?.current;
        if (map) {
          fitMapToLayerRowParcel(map, merged, {
            applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
            enableWmsLayer: false,
          });
        }
      });
    },
    [clearSoloSelection, mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef, mapContext?.setVisibleLayerNames]
  );

  const handleRemoveMgj = useCallback((index: number) => {
    setDraftMgj((prev) => {
      const next = prev.filter((_, i) => i !== index);
      mgjDirtyRef.current = true;
      return next;
    });
  }, []);

  const handleSelectSoloParcel = useCallback(
    (item: LayerRowParcelItem, idx: number) => {
      if (selectedSoloIdx === idx) {
        clearSoloSelection();
        focusParentGeomOnMap();
        return;
      }
      clearMgjSelection();
      setShowParentGeom(false);
      setHighlightVariant("blue");
      ensureUsageDataAsWmsLayersVisible(mapContext?.setVisibleLayerNames);
      void (async () => {
        const clipped = await resolveParcelItemIntersectParentForHighlight(item, {
          childTable: USAGE_DATA_AS_SOLO_WMS_LAYER_ID,
          parentTable: USAGE_DATA_AS_WMS_LAYER_ID,
          parentKeyField: preset.keyField,
          parentKeyValue: detailId,
        });
        void selectSoloParcel(clipped, idx, {
          onHighlight: setHighlightParcel,
          enableWmsLayer: false,
          useItemGeometry: true,
        });
      })();
    },
    [
      clearMgjSelection,
      clearSoloSelection,
      detailId,
      focusParentGeomOnMap,
      mapContext?.setVisibleLayerNames,
      preset.keyField,
      selectSoloParcel,
      selectedSoloIdx,
    ]
  );

  const handleSelectMgjParcel = useCallback(
    (item: LayerRowParcelItem, idx: number) => {
      if (selectedMgjIdx === idx) {
        clearMgjSelection();
        focusParentGeomOnMap();
        return;
      }
      clearSoloSelection();
      setShowParentGeom(false);
      setHighlightVariant("red");
      ensureUsageDataAsWmsLayersVisible(mapContext?.setVisibleLayerNames);
      void selectMgjParcel(item, idx, {
        onHighlight: setHighlightParcel,
        enableWmsLayer: false,
      });
    },
    [
      clearMgjSelection,
      clearSoloSelection,
      focusParentGeomOnMap,
      mapContext?.setVisibleLayerNames,
      selectMgjParcel,
      selectedMgjIdx,
    ]
  );

  const vworldApiKey = mapContext?.vworldApiKey ?? "";
  const showLoading = (loading && !isCreateMode) || (isCreateMode && formFieldsLoading);
  const showBody = !showLoading && !error && formAttributesForEdit.length > 0;
  const mgjList = isEditing ? draftMgj : mgjItems;
  const parcelList = isEditing ? draftParcels : parcels;

  const editToolbarProps = {
    isEditing,
    isCreateMode,
    saving,
    deleting,
    onEdit: () => void handleEdit(),
    onSave: () => void handleSave(),
    onCancel: handleCancel,
    onDelete: isCreateMode ? undefined : () => void handleDelete(),
  };

  return (
    <div className="flex min-h-0 h-full flex-col bg-white">
      <LayerRowEditHeader
        title="하천점용 상세"
        actionsPlacement="footer"
        onClose={onClose}
        {...editToolbarProps}
      />

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        {showLoading && (
          <div className="flex items-center gap-2 py-6 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
            불러오는 중…
          </div>
        )}
        {!showLoading && error && (
          <div className="rounded border border-red-100 bg-red-50 px-2 py-2 text-red-700">{error}</div>
        )}
        {!showLoading && editError && (
          <div className="mb-2 rounded border border-red-100 bg-red-50 px-2 py-2 text-red-700">{editError}</div>
        )}
        {showBody && (
          <>
            <UsageDataAsAttributeSection
              attributes={formAttributesForEdit}
              isEditing={isEditing}
              draft={draft}
              readOnlyFields={readOnlyFields}
              dateFields={dateFields}
              onDraftChange={handleDraftChange}
              resetKey={detailId}
            />

            {(isEditing || !isCreateMode) && (
              <UsageDataAsAddressList
                title="필지목록"
                isEditing={isEditing}
                items={parcelList}
                selectedIdx={selectedSoloIdx}
                onAdd={isEditing ? () => setParcelAddModalOpen(true) : undefined}
                onRemove={isEditing ? removeDraftParcel : undefined}
                onClick={handleSelectSoloParcel}
                emptyHintEdit="도형을 그리거나 수정하면 필지목록이 자동으로 채워집니다. 「추가」로 직접 등록할 수도 있습니다."
                emptyHintView="등록된 필지가 없습니다."
              />
            )}

            {(isEditing || !isCreateMode) && (
              <UsageDataAsAddressList
                title="물건지목록"
                isEditing={isEditing}
                items={mgjList}
                selectedIdx={selectedMgjIdx}
                selectionTone="primary"
                onAdd={isEditing ? () => setMgjAddModalOpen(true) : undefined}
                onRemove={isEditing ? handleRemoveMgj : undefined}
                onClick={handleSelectMgjParcel}
                emptyHintEdit="「추가」로 주소를 검색해 물건지를 등록합니다."
                emptyHintView="등록된 물건지가 없습니다."
              />
            )}

            {!isCreateMode && (
              <div className="mt-4">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  점사용료 이력
                </div>
                <div className="rounded border border-dashed border-slate-200 bg-slate-50/80 px-2 py-4 text-center text-slate-500">
                  연계된 점사용료가 없습니다.
                </div>
              </div>
            )}
          </>
        )}
        {!showLoading && !error && isCreateMode && !formFieldsLoading && formAttributesForEdit.length === 0 && (
          <div className="rounded border border-dashed border-slate-200 bg-slate-50/80 px-2 py-3 text-slate-500">
            등록할 필드 정의를 불러오지 못했습니다.
          </div>
        )}
      </div>

      <LayerRowEditFooter {...editToolbarProps} />

      <LayerParcelAddModal
        open={parcelAddModalOpen}
        onOpenChange={setParcelAddModalOpen}
        vworldApiKey={vworldApiKey}
        title="필지 추가"
        onAdd={addDraftParcel}
      />
      <LayerParcelAddModal
        open={mgjAddModalOpen}
        onOpenChange={setMgjAddModalOpen}
        vworldApiKey={vworldApiKey}
        title="물건지 추가"
        onAdd={handleAddMgj}
      />
    </div>
  );
}
