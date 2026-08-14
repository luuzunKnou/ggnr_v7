"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { call } from "@/lib/api";
import {
  LAYER_ROW_EDIT_PRESETS,
  LAYER_ROW_NEW_ID,
  LayerParcelTextSection,
  LayerRowAttributeSection,
  LayerRowEditHeader,
  useLayerRowEdit,
  useLayerRowFormFields,
  useLayerParcelNavigation,
  type LayerRowDetailAttr,
  type LayerRowParcelItem,
} from "../../../_mapComponents/layerRowEdit";
import { ROAD_USE_LEDGER_JIJUK_WMS_LAYER_ID } from "./roadUseLedgerLayerId";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";

type Props = {
  detailId: string;
  onClose: () => void;
  onSaved?: () => void;
  onCreated?: (newId: string) => void;
  onDeleted?: () => void;
};

export function RoadUseLedgerDetailPanel({
  detailId,
  onClose,
  onSaved,
  onCreated,
  onDeleted,
}: Props) {
  const preset = LAYER_ROW_EDIT_PRESETS.roadUseLedger;
  const isCreateMode = detailId === LAYER_ROW_NEW_ID;
  const [loading, setLoading] = useState(!isCreateMode);
  const [error, setError] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<LayerRowDetailAttr[]>([]);
  const [parcels, setParcels] = useState<LayerRowParcelItem[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const { navigateToParcel, movingParcelIdx } = useLayerParcelNavigation(ROAD_USE_LEDGER_JIJUK_WMS_LAYER_ID);

  const { formAttributes, formFieldsLoading } = useLayerRowFormFields(preset, isCreateMode);

  const loadDetail = useCallback(async () => {
    const id = String(detailId ?? "").trim();
    if (!id || id === LAYER_ROW_NEW_ID) {
      setAttributes([]);
      setParcels([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await call("", "POST", {
        service: "roadUseLedgerService",
        action: "getRoadUseLedgerDetailById",
        params: { id },
      });
      const data = res?.data ?? res;
      if (data?.error) {
        setAttributes([]);
        setParcels([]);
        setError(String(data.error));
        return;
      }
      setAttributes(Array.isArray(data?.attributes) ? data.attributes : []);
      const items = Array.isArray(data?.parcelItems)
        ? data.parcelItems
            .map((x: Record<string, unknown>) => {
              const address = String(x?.address ?? "").trim();
              const extRaw = x?.extent3857 as unknown;
              const extent3857 =
                Array.isArray(extRaw) && extRaw.length === 4 && extRaw.every((v) => Number.isFinite(Number(v)))
                  ? (extRaw.map((v) => Number(v)) as [number, number, number, number])
                  : null;
              if (!address) return null;
              return { address, extent3857 };
            })
            .filter((x: LayerRowParcelItem | null): x is LayerRowParcelItem => x != null)
        : [];
      if (items.length > 0) {
        setParcels(items);
      } else {
        const lines = Array.isArray(data?.parcels) ? data.parcels : [];
        setParcels(
          lines
            .map((line: unknown) => String(line ?? "").trim())
            .filter(Boolean)
            .map((address: string) => ({ address, extent3857: null }))
        );
      }
    } catch {
      setAttributes([]);
      setParcels([]);
      setError("상세 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [detailId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, reloadToken]);

  const handleReload = useCallback(async () => {
    if (!isCreateMode) setReloadToken((t) => t + 1);
    onSaved?.();
  }, [isCreateMode, onSaved]);

  const formAttributesForEdit = useMemo(
    () => (isCreateMode ? formAttributes : attributes),
    [attributes, formAttributes, isCreateMode]
  );

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
    onDeleted: () => onDeleted?.(),
    onCancelCreate: onClose,
    wmsLayerId: ROAD_USE_LEDGER_JIJUK_WMS_LAYER_ID,
  });

  const showLoading = (loading && !isCreateMode) || (isCreateMode && formFieldsLoading);
  const showBody = !showLoading && !error && formAttributesForEdit.length > 0;

  return (
    <div className="flex min-h-0 h-full flex-col bg-white">
      <LayerRowEditHeader
        title="도로점용 상세"
        isEditing={isEditing}
        isCreateMode={isCreateMode}
        saving={saving}
        deleting={deleting}
        onEdit={() => void handleEdit()}
        onSave={() => void handleSave()}
        onCancel={handleCancel}
        onDelete={isCreateMode ? undefined : () => void handleDelete()}
        onClose={onClose}
      />

      <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
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
            <LayerRowAttributeSection
              attributes={formAttributesForEdit}
              isEditing={isEditing}
              draft={draft}
              readOnlyFields={readOnlyFields}
              dateFields={dateFields}
              onDraftChange={handleDraftChange}
            />
            {(isEditing || !isCreateMode) && (
              <LayerParcelTextSection
                isEditing={isEditing}
                draftParcels={draftParcels}
                onAddParcel={addDraftParcel}
                onRemoveParcel={removeDraftParcel}
                parcels={parcels}
                movingParcelIdx={movingParcelIdx}
                onParcelClick={(item, idx) => void navigateToParcel(item, idx)}
              />
            )}
          </>
        )}
        {!showLoading && !error && isCreateMode && !formFieldsLoading && formAttributesForEdit.length === 0 && (
          <div className="rounded border border-dashed border-slate-200 bg-slate-50/80 px-2 py-3 text-slate-500">
            등록할 필드 정의를 불러오지 못했습니다.
          </div>
        )}
      </MapSideDetailScroll>
    </div>
  );
}
