'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { call } from '@/lib/api';
import { getOccupationLedgerBinding } from './occupationLedgerBinding';
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
  type LayerRowEditPresetKey,
  type LayerRowParcelItem,
} from '../../_mapComponents/layerRowEdit';
import { UsageDataAsAddressList } from '../river/usageDataAs/UsageDataAsAddressList';
import { OccupationLedgerAttributeSection } from './OccupationLedgerAttributeSection';
import { fitMapToLayerRowParcel } from '../../_mapComponents/layerRowEdit/layerRowParcelUtils';
import { resolveParcelGeoms } from '../../_mapComponents/layerRowEdit/resolveParcelGeoms';
import { resolveParcelItemIntersectParentForHighlight } from '../../_mapComponents/layerRowEdit/resolveParcelItemIntersectParentForHighlight';
import {
  useLayerRowParcelHighlight,
  type LayerRowParcelHighlightVariant,
} from '../../_mapComponents/layerRowEdit/useLayerRowParcelHighlight';
import { useLayerRowParcelDraftPreview } from '../../_mapComponents/layerRowEdit/useLayerRowParcelDraftPreview';
import { useMapContext } from '../../_mapComponents/MapContext';
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults';
import {
  ensureOccupationLedgerWmsLayers,
  refreshOccupationLedgerMapView,
} from './occupationLedgerMapSync';
import { useOccupationLedgerParentGeomHighlight } from './useOccupationLedgerParentGeomHighlight';
import { deriveOccupationPeriodState } from '@/lib/occupationLedgerPeriodState';

function draftFieldValue(draft: Record<string, string>, fieldLower: string): string {
  if (fieldLower in draft) return draft[fieldLower] ?? '';
  const key = Object.keys(draft).find((k) => k.toLowerCase() === fieldLower);
  return key ? (draft[key] ?? '') : '';
}

function draftFieldKey(draft: Record<string, string>, fieldLower: string): string {
  return Object.keys(draft).find((k) => k.toLowerCase() === fieldLower) ?? fieldLower;
}

type Props = {
  detailId: string;
  serEng: string;
  onClose: () => void;
  onSaved?: () => void;
  onCreated?: (newKey: string) => void;
  onDeleted?: () => void;
};

function toParcelItems(arr: unknown): LayerRowParcelItem[] {
  if (!Array.isArray(arr)) return [];
  const out: LayerRowParcelItem[] = [];
  for (const raw of arr) {
    const x = raw as Record<string, unknown>;
    const address = String(x?.address ?? '').trim();
    if (!address) continue;
    const extRaw = x?.extent3857 as unknown;
    const extent3857: [number, number, number, number] | null =
      Array.isArray(extRaw) &&
      extRaw.length === 4 &&
      extRaw.every((v) => Number.isFinite(Number(v)))
        ? (extRaw.map((v) => Number(v)) as [number, number, number, number])
        : null;
    const wmsRaw = x?.wmsRowKey as { keyField?: string; keyValue?: string } | undefined;
    const keyField = String(wmsRaw?.keyField ?? '').trim();
    const keyValue = String(wmsRaw?.keyValue ?? '').trim();
    const item: LayerRowParcelItem = {
      address,
      extent3857,
    };
    if (x?.pnu != null && String(x.pnu).trim()) item.pnu = String(x.pnu);
    if (keyField && keyValue) item.wmsRowKey = { keyField, keyValue };
    out.push(item);
  }
  return out;
}

export function OccupationLedgerDetailPanel({
  detailId,
  serEng,
  onClose,
  onSaved,
  onCreated,
  onDeleted,
}: Props) {
  const mapContext = useMapContext();
  const binding = getOccupationLedgerBinding({ serEng });
  const presetKey = (binding?.editPresetKey ?? 'waterOccupationLedger') as LayerRowEditPresetKey;
  const preset = LAYER_ROW_EDIT_PRESETS[presetKey] ?? LAYER_ROW_EDIT_PRESETS.waterOccupationLedger;
  const mainTable = binding?.mainTable ?? preset.tableName;
  const jijukTable = binding?.jijukTable ?? preset.childTableName ?? '';
  const mgjTable = binding?.mgjTable ?? '';
  const keyField = binding?.fields.keyField ?? preset.keyField;
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
  const [highlightParcel, setHighlightParcel] = useState<LayerRowParcelItem | null>(null);
  const [highlightVariant, setHighlightVariant] = useState<LayerRowParcelHighlightVariant>('blue');
  const [showParentGeom, setShowParentGeom] = useState(true);

  const {
    selectParcel: selectSoloParcel,
    selectedParcelIdx: selectedSoloIdx,
    clearSelection: clearSoloSelection,
  } = useLayerParcelNavigation(jijukTable);
  const {
    selectParcel: selectMgjParcel,
    selectedParcelIdx: selectedMgjIdx,
    clearSelection: clearMgjSelection,
  } = useLayerParcelNavigation(mgjTable);

  const { formAttributes, formFieldsLoading } = useLayerRowFormFields(preset, isCreateMode);

  const loadDetail = useCallback(async () => {
    const key = String(detailId ?? '').trim();
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
      const res = await call('', 'POST', {
        service: 'occupationLedgerService',
        action: 'getOccupationLedgerDetailByKey',
        params: { key, serEng },
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
      setParcels(toParcelItems(data?.parcelItems));
      setMgjItems(toParcelItems(data?.mgjItems));
    } catch {
      setAttributes([]);
      setParcels([]);
      setMgjItems([]);
      setError('상세 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [detailId, serEng]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, reloadToken]);

  useEffect(() => {
    setHighlightParcel(null);
    setHighlightVariant('blue');
    setShowParentGeom(true);
    clearSoloSelection();
    clearMgjSelection();
  }, [detailId, clearMgjSelection, clearSoloSelection]);

  const handleReload = useCallback(
    async (savedKey?: string) => {
      const key = String(savedKey ?? detailId ?? '').trim();
      if (key && key !== LAYER_ROW_NEW_ID && mgjDirtyRef.current) {
        try {
          await call('', 'POST', {
            service: 'occupationLedgerService',
            action: 'syncOccupationLedgerMgjByKey',
            params: {
              key,
              serEng,
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
        await refreshOccupationLedgerMapView({
          map: mapContext?.mapInstanceRef?.current,
          detailId: key,
          serEng,
          setVisibleLayerNames: mapContext?.setVisibleLayerNames,
          applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current ?? null,
        });
      }
      onSaved?.();
    },
    [
      clearMgjSelection,
      clearSoloSelection,
      detailId,
      mapContext?.applyMapViewPaddingRef,
      mapContext?.mapInstanceRef,
      mapContext?.setVisibleLayerNames,
      onSaved,
      serEng,
    ]
  );

  const formAttributesForEdit = useMemo(() => {
    if (isCreateMode) return formAttributes;
    return attributes;
  }, [attributes, formAttributes, isCreateMode]);

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
    rowKey: isCreateMode ? '' : detailId,
    attributes: formAttributesForEdit,
    initialParcels: parcels,
    isCreateMode,
    onReload: handleReload,
    onCreated: (newKey) => {
      ensureOccupationLedgerWmsLayers(mapContext?.setVisibleLayerNames, { serEng });
      onCreated?.(newKey);
    },
    onDeleted: () => {
      setHighlightParcel(null);
      setShowParentGeom(false);
      onDeleted?.();
    },
    onCancelCreate: onClose,
    wmsLayerId: jijukTable,
  });

  const handleOccupationDraftChange = useCallback(
    (field: string, value: string) => {
      handleDraftChange(field, value);
      const fl = field.toLowerCase();
      if (fl !== 'perm_end_date' && fl !== 'perm_start_date') return;
      const endVal =
        fl === 'perm_end_date' ? value : draftFieldValue(draft, 'perm_end_date');
      handleDraftChange(draftFieldKey(draft, 'state'), deriveOccupationPeriodState(endVal));
    },
    [draft, handleDraftChange]
  );

  /** 편집 진입·건 전환 시 종료일 기준으로 상태 맞춤 */
  useEffect(() => {
    if (!isEditing) return;
    const endVal = draftFieldValue(draft, 'perm_end_date');
    const stateKey = draftFieldKey(draft, 'state');
    const next = deriveOccupationPeriodState(endVal);
    if ((draft[stateKey] ?? '') === next) return;
    handleDraftChange(stateKey, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 편집 모드·건 전환 시에만
  }, [isEditing, detailId]);

  useLayerRowParcelHighlight(showParentGeom ? null : highlightParcel, highlightVariant);
  useLayerRowParcelDraftPreview(draftMgj, 'red', isEditing);
  const { parentExtentRef } = useOccupationLedgerParentGeomHighlight(
    detailId,
    mainTable,
    keyField,
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
    ensureOccupationLedgerWmsLayers(mapContext?.setVisibleLayerNames, { serEng });
    scheduleFitMapToExtent3857(map, ext, {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });
  }, [isEditing, mapContext, parentExtentRef, serEng]);

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
        setHighlightVariant('red');
        setHighlightParcel(merged);
        clearSoloSelection();
        ensureOccupationLedgerWmsLayers(mapContext?.setVisibleLayerNames, { serEng });
        const map = mapContext?.mapInstanceRef?.current;
        if (map) {
          fitMapToLayerRowParcel(map, merged, {
            applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
            enableWmsLayer: false,
          });
        }
      });
    },
    [
      clearSoloSelection,
      mapContext?.applyMapViewPaddingRef,
      mapContext?.mapInstanceRef,
      mapContext?.setVisibleLayerNames,
      serEng,
    ]
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
      setHighlightVariant('blue');
      ensureOccupationLedgerWmsLayers(mapContext?.setVisibleLayerNames, { serEng });
      void (async () => {
        const clipped = await resolveParcelItemIntersectParentForHighlight(item, {
          childTable: jijukTable,
          parentTable: mainTable,
          parentKeyField: keyField,
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
      jijukTable,
      keyField,
      mainTable,
      mapContext?.setVisibleLayerNames,
      selectSoloParcel,
      selectedSoloIdx,
      serEng,
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
      setHighlightVariant('red');
      ensureOccupationLedgerWmsLayers(mapContext?.setVisibleLayerNames, { serEng });
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
      serEng,
    ]
  );

  const vworldApiKey = mapContext?.vworldApiKey ?? '';
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
        title={`${binding?.title ?? '점용'} 상세`}
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
          <div className="mb-2 rounded border border-red-100 bg-red-50 px-2 py-2 text-red-700">
            {editError}
          </div>
        )}
        {showBody && (
          <>
            <OccupationLedgerAttributeSection
              attributes={formAttributesForEdit}
              isEditing={isEditing}
              draft={draft}
              readOnlyFields={readOnlyFields}
              dateFields={dateFields}
              vworldApiKey={mapContext?.vworldApiKey ?? ''}
              onDraftChange={handleOccupationDraftChange}
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
        {!showLoading &&
          !error &&
          isCreateMode &&
          !formFieldsLoading &&
          formAttributesForEdit.length === 0 && (
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
