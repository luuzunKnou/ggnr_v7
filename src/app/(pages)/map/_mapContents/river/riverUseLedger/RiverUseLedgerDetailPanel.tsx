"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { call } from "@/lib/api";
import {
  LAYER_ROW_EDIT_PRESETS,
  LAYER_ROW_NEW_ID,
  LayerParcelAddModal,
  LayerParcelTextSection,
  LayerRowAttributeSection,
  LayerRowEditHeader,
  LayerRowPanelButton,
  useLayerRowEdit,
  useLayerParcelNavigation,
  useLayerRowFormFields,
  type LayerRowDetailAttr,
  type LayerRowEditPresetKey,
  type LayerRowParcelItem,
} from "../../../_mapComponents/layerRowEdit";
import {
  RIVER_USE_LEDGER_JIJUK_WMS_LAYER_ID,
  RIVER_USE_LEDGER_MULGUNJI_WMS_LAYER_ID,
  RIVER_USAGE_DATA_SOLO_WMS_LAYER_ID,
} from "./riverUseLedgerLayerId";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";

type Props = {
  detailId: string;
  onClose: () => void;
  onSaved?: () => void;
  onCreated?: (newId: string) => void;
  onDeleted?: () => void;
};

type ModeConfig = {
  editPresetKey: LayerRowEditPresetKey;
  parcelsEditable: boolean;
  showMulgunji: boolean;
  jijukLayerId: string;
  mulgunjiLayerId: string | null;
};

const DEFAULT_MODE: ModeConfig = {
  editPresetKey: "riverUseLedger",
  parcelsEditable: true,
  showMulgunji: true,
  jijukLayerId: RIVER_USE_LEDGER_JIJUK_WMS_LAYER_ID,
  mulgunjiLayerId: RIVER_USE_LEDGER_MULGUNJI_WMS_LAYER_ID,
};

/** 매 렌더 `[]` 새 참조 → useLayerRowEdit 무한 setState 방지 */
const EMPTY_PARCELS: LayerRowParcelItem[] = [];

export function RiverUseLedgerDetailPanel({
  detailId,
  onClose,
  onSaved,
  onCreated,
  onDeleted,
}: Props) {
  const mapContext = useMapContext();
  const isCreateMode = detailId === LAYER_ROW_NEW_ID;

  const [mode, setMode] = useState<ModeConfig>(DEFAULT_MODE);
  const [modeReady, setModeReady] = useState(false);

  const [loading, setLoading] = useState(!isCreateMode);
  const [error, setError] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<LayerRowDetailAttr[]>([]);
  const [parcels, setParcels] = useState<LayerRowParcelItem[]>([]);
  const [mulgunjiItems, setMulgunjiItems] = useState<LayerRowParcelItem[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  const [draftMulgunji, setDraftMulgunji] = useState<LayerRowParcelItem[]>([]);
  const draftMulgunjiRef = useRef<LayerRowParcelItem[]>([]);
  const mulgunjiDirtyRef = useRef(false);
  const [mulgunjiAddModalOpen, setMulgunjiAddModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await call("", "POST", {
          service: "riverUseLedgerService",
          action: "getRiverUseLedgerConfig",
          params: {},
        });
        const data = res?.data ?? res;
        if (cancelled || data?.error) {
          if (!cancelled) setModeReady(true);
          return;
        }
        const presetKey: LayerRowEditPresetKey =
          data?.editPresetKey === "riverUsageData" || data?.editPresetKey === "usageDataAs"
            ? "usageDataAs"
            : "riverUseLedger";
        const isUsageVariant = presetKey === "usageDataAs";
        setMode({
          editPresetKey: presetKey,
          parcelsEditable: Boolean(data?.parcelsEditable),
          showMulgunji: Boolean(data?.showMulgunji),
          jijukLayerId: String(
            data?.jijukLayerId ??
              (isUsageVariant
                ? RIVER_USAGE_DATA_SOLO_WMS_LAYER_ID
                : RIVER_USE_LEDGER_JIJUK_WMS_LAYER_ID)
          ),
          mulgunjiLayerId: data?.mulgunjiLayerId
            ? String(data.mulgunjiLayerId)
            : isUsageVariant
              ? null
              : RIVER_USE_LEDGER_MULGUNJI_WMS_LAYER_ID,
        });
      } catch {
        /* defaults */
      } finally {
        if (!cancelled) setModeReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const preset = LAYER_ROW_EDIT_PRESETS[mode.editPresetKey];

  const { navigateToParcel: navigateToJijukParcel, movingParcelIdx: movingJijukIdx } =
    useLayerParcelNavigation(mode.jijukLayerId);
  const { navigateToParcel: navigateToMulgunjiParcel, movingParcelIdx: movingMulgunjiIdx } =
    useLayerParcelNavigation(mode.mulgunjiLayerId ?? RIVER_USE_LEDGER_MULGUNJI_WMS_LAYER_ID);

  const { formAttributes, formFieldsLoading } = useLayerRowFormFields(preset, isCreateMode && modeReady);

  const loadDetail = useCallback(async () => {
    const id = String(detailId ?? "").trim();
    if (!id || id === LAYER_ROW_NEW_ID) {
      setAttributes([]);
      setParcels([]);
      setMulgunjiItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await call("", "POST", {
        service: "riverUseLedgerService",
        action: "getRiverUseLedgerDetailById",
        params: { id },
      });
      const data = res?.data ?? res;
      if (data?.error) {
        setAttributes([]);
        setParcels([]);
        setMulgunjiItems([]);
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
              Array.isArray(extRaw) &&
              extRaw.length === 4 &&
              extRaw.every((v) => Number.isFinite(Number(v)))
                ? (extRaw.map((v) => Number(v)) as [number, number, number, number])
                : null;
            return { address, extent3857 };
          })
          .filter((x): x is LayerRowParcelItem => x != null);
      };

      setParcels(toParcelItems(data?.parcelItems));
      setMulgunjiItems(toParcelItems(data?.mulgunjiItems));
    } catch {
      setAttributes([]);
      setParcels([]);
      setMulgunjiItems([]);
      setError("상세 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [detailId]);

  useEffect(() => {
    if (!modeReady) return;
    void loadDetail();
  }, [loadDetail, reloadToken, modeReady]);

  const handleReload = useCallback(async () => {
    const id = String(detailId ?? "").trim();
    if (
      !isCreateMode &&
      id &&
      id !== LAYER_ROW_NEW_ID &&
      mode.showMulgunji &&
      mulgunjiDirtyRef.current
    ) {
      try {
        await call("", "POST", {
          service: "riverUseLedgerService",
          action: "syncRiverUseLedgerMulgunjiByParentId",
          params: {
            parentId: id,
            items: draftMulgunjiRef.current.map((p) => ({
              address: p.address,
              x4326: p.point4326?.x,
              y4326: p.point4326?.y,
            })),
          },
        });
      } catch {
        /* ignore */
      }
      mulgunjiDirtyRef.current = false;
    }
    setReloadToken((t) => t + 1);
    onSaved?.();
  }, [detailId, isCreateMode, mode.showMulgunji, onSaved]);

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
    initialParcels: mode.parcelsEditable ? parcels : EMPTY_PARCELS,
    isCreateMode,
    onReload: handleReload,
    onCreated: (newKey) => onCreated?.(newKey),
    onDeleted: () => onDeleted?.(),
    onCancelCreate: onClose,
    wmsLayerId: mode.jijukLayerId,
  });

  useEffect(() => {
    if (isEditing && mode.showMulgunji) {
      const base = [...mulgunjiItems];
      setDraftMulgunji(base);
      draftMulgunjiRef.current = base;
      mulgunjiDirtyRef.current = false;
    } else {
      setDraftMulgunji((prev) => (prev.length === 0 ? prev : []));
      draftMulgunjiRef.current = [];
    }
  }, [isEditing, mulgunjiItems, mode.showMulgunji]);

  useEffect(() => {
    draftMulgunjiRef.current = draftMulgunji;
  }, [draftMulgunji]);

  const handleAddMulgunji = useCallback((item: LayerRowParcelItem) => {
    const key = item.address.toLowerCase();
    setDraftMulgunji((prev) => {
      if (prev.some((p) => p.address.toLowerCase() === key)) return prev;
      const next = [...prev, item];
      mulgunjiDirtyRef.current = true;
      return next;
    });
  }, []);

  const handleRemoveMulgunji = useCallback((index: number) => {
    setDraftMulgunji((prev) => {
      const next = prev.filter((_, i) => i !== index);
      mulgunjiDirtyRef.current = true;
      return next;
    });
  }, []);

  const vworldApiKey = mapContext?.vworldApiKey ?? "";
  const showLoading =
    !modeReady || (loading && !isCreateMode) || (isCreateMode && formFieldsLoading);
  const showBody = !showLoading && !error && formAttributesForEdit.length > 0;
  const mulgunjiList = isEditing ? draftMulgunji : mulgunjiItems;
  const showParcelSection = isEditing || !isCreateMode;
  const parcelEditing = isEditing && mode.parcelsEditable;

  return (
    <div className="flex min-h-0 h-full flex-col bg-background">
      <LayerRowEditHeader
        title="하천점용 상세"
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
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
            불러오는 중…
          </div>
        )}
        {!showLoading && error && (
          <div className="rounded border border-destructive/20 bg-destructive/10 px-2 py-2 text-destructive">{error}</div>
        )}
        {!showLoading && editError && (
          <div className="mb-2 rounded border border-destructive/20 bg-destructive/10 px-2 py-2 text-destructive">{editError}</div>
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

            {showParcelSection && (
              <LayerParcelTextSection
                isEditing={parcelEditing}
                draftParcels={parcelEditing ? draftParcels : parcels}
                onAddParcel={addDraftParcel}
                onRemoveParcel={removeDraftParcel}
                parcels={parcels}
                movingParcelIdx={movingJijukIdx}
                onParcelClick={(item, idx) => void navigateToJijukParcel(item, idx)}
              />
            )}

            {mode.showMulgunji && !isCreateMode && (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    물건지목록
                  </div>
                  {isEditing && (
                    <LayerRowPanelButton
                      className="h-6 px-2 text-[10px]"
                      onClick={() => setMulgunjiAddModalOpen(true)}
                    >
                      <Plus className="h-3 w-3 shrink-0" aria-hidden />
                      추가
                    </LayerRowPanelButton>
                  )}
                </div>

                {mulgunjiList.length === 0 ? (
                  <div className="rounded border border-dashed border-border bg-muted/50 px-2 py-3 text-muted-foreground">
                    {isEditing
                      ? "「추가」로 주소를 검색해 물건지를 등록합니다."
                      : "등록된 물건지가 없습니다."}
                  </div>
                ) : (
                  <ul className="list-none space-y-0 rounded border border-border bg-background">
                    {mulgunjiList.map((item, i) => (
                      <li
                        key={`m-${i}-${item.address.slice(0, 24)}`}
                        className="flex items-start gap-1 border-b border-border px-2 py-2 text-foreground last:border-b-0"
                      >
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-start gap-1 text-left text-xs text-foreground hover:text-primary disabled:cursor-default disabled:opacity-70"
                              disabled={!item.extent3857}
                              onClick={() => void navigateToMulgunjiParcel(item, i)}
                              title={item.extent3857 ? "클릭 시 위치 이동" : "위치 정보 없음"}
                            >
                              <span className="mr-1 shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
                              <span className="min-w-0 flex-1 break-words">{item.address}</span>
                              {movingMulgunjiIdx === i && (
                                <span className="ml-1 shrink-0 text-[11px] text-muted-foreground">이동 중…</span>
                              )}
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => handleRemoveMulgunji(i)}
                              aria-label="물건지 삭제"
                              title="삭제"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="w-full text-left text-foreground hover:text-primary disabled:cursor-default disabled:opacity-70"
                            disabled={!item.extent3857}
                            onClick={() => void navigateToMulgunjiParcel(item, i)}
                            title={item.extent3857 ? "클릭 시 위치 이동" : "위치 정보 없음"}
                          >
                            <span className="mr-2 tabular-nums text-muted-foreground">{i + 1}.</span>
                            {item.address}
                            {movingMulgunjiIdx === i && (
                              <span className="ml-2 text-[11px] text-muted-foreground">이동 중…</span>
                            )}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
        {!showLoading &&
          !error &&
          isCreateMode &&
          !formFieldsLoading &&
          formAttributesForEdit.length === 0 && (
            <div className="rounded border border-dashed border-border bg-muted/50 px-2 py-3 text-muted-foreground">
              등록할 필드 정의를 불러오지 못했습니다.
            </div>
          )}
      </MapSideDetailScroll>

      {mode.showMulgunji && (
        <LayerParcelAddModal
          open={mulgunjiAddModalOpen}
          onOpenChange={setMulgunjiAddModalOpen}
          vworldApiKey={vworldApiKey}
          onAdd={handleAddMulgunji}
        />
      )}
    </div>
  );
}
