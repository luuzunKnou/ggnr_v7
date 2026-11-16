'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { call } from '@/lib/api';
import { recordDataViewLog } from '@/lib/recordDataViewLog';
import { getOccupationLedgerBinding } from './occupationLedgerBinding';
import {
  LAYER_ROW_EDIT_PRESETS,
  LAYER_ROW_NEW_ID,
  LayerParcelAddModal,
  LayerRowEditFooter,
  LayerRowEditHeader,
  useLayerRowEdit,
  useLayerParcelNavigation,
  type LayerRowDetailAttr,
  type LayerRowEditPresetKey,
  type LayerRowParcelItem,
} from '../../_mapComponents/layerRowEdit';
import { UsageDataAsAttachmentSection } from '../river/usageDataAs/UsageDataAsAttachmentSection';
import { RoadRewardAttrTable } from '../road/roadReward/RoadRewardAttrTable';
import { OccupationLedgerAttributeSection } from './OccupationLedgerAttributeSection';
import { OccupationLedgerCollapsibleSection } from './OccupationLedgerCollapsibleSection';
import { OccupationLedgerDetailSection } from './OccupationLedgerDetailSection';
import { isOccupationLedgerExtraFullWidth } from './occupationLedgerAttrLayout';
import { OccupationLedgerChildModal } from './OccupationLedgerChildModal';
import {
  OccupationLedgerParcelEditModal,
  type OccupationParcelFieldDef,
} from './OccupationLedgerParcelEditModal';
import {
  enrichOccupationParcelFromAddress,
  mergeJijukIntoOccupationParcels,
  type OccupationJijukAutoParcel,
} from './occupationLedgerParcelFromJijuk';
import {
  OccupationLedgerParcelList,
  type OccupationLedgerChildColumn,
} from './OccupationLedgerParcelList';
import {
  LayerExtraFieldsEditor,
  type LayerExtraEditorItem,
  type LayerExtraDefOption,
} from '../../_mapComponents/layerExtra/LayerExtraFieldsEditor';
import { resolveParcelGeoms } from '../../_mapComponents/layerRowEdit/resolveParcelGeoms';
import { resolveParcelItemIntersectParentForHighlight } from '../../_mapComponents/layerRowEdit/resolveParcelItemIntersectParentForHighlight';
import {
  useLayerRowParcelHighlight,
  type LayerRowParcelHighlightVariant,
} from '../../_mapComponents/layerRowEdit/useLayerRowParcelHighlight';
import { useMapContext } from '../../_mapComponents/MapContext';
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults';
import {
  ensureOccupationLedgerWmsLayers,
  refreshOccupationLedgerMapView,
} from './occupationLedgerMapSync';
import { useOccupationLedgerParentGeomHighlight } from './useOccupationLedgerParentGeomHighlight';
import { MapHitOverlapSelect } from '../../_mapComponents/MapHitOverlapSelect';
import { MapSideDetailScroll } from '../../_mapComponents/MapSideDetailScroll';
import { deriveOccupationPeriodState } from '@/lib/occupationLedgerPeriodState';
import { currentPermitYear } from '@/lib/occupationPermitNo';
import { useAutoOccupationPermitNo } from '../../_mapComponents/layerRowEdit/useAutoOccupationPermitNo';
import { useLayerRowPlaceFromGeom } from '../../_mapComponents/layerRowEdit/useLayerRowPlaceFromGeom';
import { computeAreaSqmFromWkt5181 } from '../../_mapComponents/analysisArea';

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
  onSelectDetailId?: (id: string) => void;
  onSaved?: () => void;
  onCreated?: (newKey: string) => void;
  onDeleted?: () => void;
  /** 필지·물건지 상세 모달 — 목록+상세 패널 폭만 덮는 위치 (없으면 화면 전체) */
  overlayLeftPx?: number;
  overlayWidthPx?: number;
};

function toChildColumns(arr: unknown): OccupationLedgerChildColumn[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((c) => ({
      field: String((c as { field?: unknown })?.field ?? '').trim(),
      label: String((c as { label?: unknown })?.label ?? '').trim(),
    }))
    .filter((c) => c.field)
    .map((c) => ({ ...c, label: c.label || c.field }));
}

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
    const vals = x?.listValues;
    if (vals && typeof vals === 'object') {
      item.listValues = Object.fromEntries(
        Object.entries(vals as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])
      );
    }
    out.push(item);
  }
  return out;
}

export function OccupationLedgerDetailPanel({
  detailId,
  serEng,
  onClose,
  onSelectDetailId,
  onSaved,
  onCreated,
  onDeleted,
  overlayLeftPx = 0,
  overlayWidthPx = 0,
}: Props) {
  const mapContext = useMapContext();
  const hitOptions = mapContext?.occupationLedgerMapHitOptions ?? [];
  const binding = getOccupationLedgerBinding({ serEng });
  const presetKey = (binding?.editPresetKey ?? 'waterOccupationLedger') as LayerRowEditPresetKey;
  const preset = LAYER_ROW_EDIT_PRESETS[presetKey] ?? LAYER_ROW_EDIT_PRESETS.waterOccupationLedger;
  const mainTable = binding?.mainTable ?? preset.tableName;
  const jijukTable = binding?.jijukTable ?? preset.childTableName ?? '';
  const mgjTable = binding?.mgjTable ?? '';
  const keyField = binding?.fields.keyField ?? preset.keyField;
  const ledgerFields = binding?.fields;
  const permitFieldLower = String(ledgerFields?.permitField ?? 'permit_no').toLowerCase();
  const startFieldLower = String(ledgerFields?.startField ?? '').toLowerCase();
  const endFieldLower = String(ledgerFields?.endField ?? '').toLowerCase();
  const stateFieldLower = String(ledgerFields?.stateField ?? 'state').toLowerCase();
  const placeFieldLower = String(ledgerFields?.placeField ?? '').toLowerCase();
  const autoCodeFieldLower = String(binding?.autoCodeField ?? '').toLowerCase();
  const isCreateMode = detailId === LAYER_ROW_NEW_ID;

  const [loading, setLoading] = useState(!isCreateMode);
  const [error, setError] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<LayerRowDetailAttr[]>([]);
  const [parcels, setParcels] = useState<LayerRowParcelItem[]>([]);
  const [mgjItems, setMgjItems] = useState<LayerRowParcelItem[]>([]);
  /** 필지·물건지 목록 열 — 필드 정의 «목록» */
  const [parcelColumns, setParcelColumns] = useState<OccupationLedgerChildColumn[]>([]);
  const [mgjColumns, setMgjColumns] = useState<OccupationLedgerChildColumn[]>([]);
  /** 필지·물건지 상세 모달 */
  const [childModal, setChildModal] = useState<{
    role: 'jijuk' | 'mgj';
    ogcFid: string;
    address: string;
  } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [draftMgj, setDraftMgj] = useState<LayerRowParcelItem[]>([]);
  const draftMgjRef = useRef<LayerRowParcelItem[]>([]);
  const mgjDirtyRef = useRef(false);
  const [mgjAddModalOpen, setMgjAddModalOpen] = useState(false);
  const [parcelAddModalOpen, setParcelAddModalOpen] = useState(false);
  const [parcelFieldDefs, setParcelFieldDefs] = useState<OccupationParcelFieldDef[]>([]);
  const [mgjFieldDefs, setMgjFieldDefs] = useState<OccupationParcelFieldDef[]>([]);
  const [parcelEditModal, setParcelEditModal] = useState<{
    role: 'jijuk' | 'mgj';
    index: number;
    values: Record<string, string>;
  } | null>(null);
  const [highlightParcel, setHighlightParcel] = useState<LayerRowParcelItem | null>(null);
  const [highlightVariant, setHighlightVariant] = useState<LayerRowParcelHighlightVariant>('blue');
  const [showParentGeom, setShowParentGeom] = useState(true);
  const [nextKey, setNextKey] = useState('');
  const [nextPermitNo, setNextPermitNo] = useState('');
  const [extraItems, setExtraItems] = useState<LayerExtraEditorItem[]>([]);
  /** 첨부파일 폴더 키 — 본표 키 값 (하천·도로 관리번호, 국공유지 고유키) */
  const [attachmentKey, setAttachmentKey] = useState('');
  /** 새 건 자동 채번 키 미리보기 (하천·도로 관리번호) */
  const [nextAutoCode, setNextAutoCode] = useState('');
  const extraItemsRef = useRef<LayerExtraEditorItem[]>([]);
  const [extraDefs, setExtraDefs] = useState<LayerExtraDefOption[]>([]);
  const [formAttributes, setFormAttributes] = useState<LayerRowDetailAttr[]>([]);
  const [formFieldsLoading, setFormFieldsLoading] = useState(false);

  useEffect(() => {
    extraItemsRef.current = extraItems;
  }, [extraItems]);

  useEffect(() => {
    if (extraDefs.length === 0) return;
    setExtraItems((prev) => {
      let changed = false;
      const next = prev.map((it) => {
        const def = extraDefs.find(
          (d) => d.fieldName.toLowerCase() === it.fieldName.toLowerCase()
        );
        if (!def) return it;
        const dt = String(def.dataType ?? 'text').trim() || 'text';
        if (it.dataType.toLowerCase() === dt.toLowerCase()) return it;
        changed = true;
        return { ...it, dataType: dt };
      });
      return changed ? next : prev;
    });
  }, [extraDefs]);

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

  /** 등록 칸 — 공통 칸(연결 설정 순서) + 필드 정의 나머지. 필드 정의가 옛 칸 이름이어도 공통 칸이 보인다 */
  useEffect(() => {
    if (!isCreateMode) {
      setFormAttributes([]);
      return;
    }
    let cancelled = false;
    setFormFieldsLoading(true);
    void call('', 'POST', {
      service: 'occupationLedgerService',
      action: 'getOccupationLedgerFieldList',
      params: { serEng },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const list = Array.isArray(data?.fields) ? data.fields : [];
        setFormAttributes(
          list.map(
            (f: { field: string; label: string; type?: string; readOnly?: boolean; required?: boolean; showDetail?: boolean }) => ({
              field: f.field,
              label: f.label,
              value: '',
              type: f.type,
              readOnly: f.readOnly,
              required: f.required,
              showDetail: f.showDetail,
            })
          )
        );
      })
      .catch(() => {
        if (!cancelled) setFormAttributes([]);
      })
      .finally(() => {
        if (!cancelled) setFormFieldsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCreateMode, serEng]);

  const loadDetail = useCallback(async () => {
    const key = String(detailId ?? '').trim();
    if (!key || key === LAYER_ROW_NEW_ID) {
      setAttributes([]);
      setParcels([]);
      setMgjItems([]);
      setExtraItems([]);
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
        setExtraItems([]);
        setError(String(data.error));
        return;
      }
      setAttributes(Array.isArray(data?.attributes) ? data.attributes : []);
      setAttachmentKey(String(data?.fileKey ?? key).trim());
      setParcels(toParcelItems(data?.parcelItems));
      setMgjItems(toParcelItems(data?.mgjItems));
      setParcelColumns(toChildColumns(data?.parcelColumns));
      setMgjColumns(toChildColumns(data?.mgjColumns));

      const extraRes = await call('', 'POST', {
        service: 'layerExtraService',
        action: 'getLayerRowExtra',
        params: {
          tableName: mainTable,
          tableSchema: binding?.schema ?? 'layer',
          keyField,
          keyValue: key,
        },
      });
      const extraData = extraRes?.data ?? extraRes;
      const fields = Array.isArray(extraData?.fields) ? extraData.fields : [];
      setExtraItems(
        fields.map(
          (
            f: { fieldName?: string; dataType?: string; value?: string; sortOrder?: number },
            idx: number
          ) => ({
            fieldName: String(f.fieldName ?? '').trim(),
            dataType: String(f.dataType ?? 'text').trim() || 'text',
            value: f.value == null ? '' : String(f.value),
            sortOrder: Number(f.sortOrder) || idx + 1,
          })
        )
      );
    } catch {
      setAttributes([]);
      setParcels([]);
      setMgjItems([]);
      setExtraItems([]);
      setError('상세 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [detailId, serEng, mainTable, binding?.schema, keyField]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    const loadChildFields = async (role: 'jijuk' | 'mgj') => {
      const res = await call('', 'POST', {
        service: 'occupationLedgerService',
        action: 'getOccupationLedgerChildFieldList',
        params: { serEng, role },
      });
      const data = res?.data ?? res;
      const list = Array.isArray(data?.fields) ? data.fields : [];
      const mapped: OccupationParcelFieldDef[] = list.map(
        (f: { field?: string; label?: string; type?: string; readOnly?: boolean; required?: boolean }) => ({
          field: String(f.field ?? '').trim(),
          label: String(f.label ?? f.field ?? '').trim(),
          type: String(f.type ?? 'text'),
          readOnly: f.readOnly === true,
          required: f.required === true,
        })
      ).filter((f: OccupationParcelFieldDef) => f.field);
      return mapped;
    };
    void Promise.all([loadChildFields('jijuk'), loadChildFields('mgj')]).then(([jijuk, mgj]) => {
      if (cancelled) return;
      setParcelFieldDefs(jijuk);
      setMgjFieldDefs(mgj);
    });
    return () => {
      cancelled = true;
    };
  }, [serEng]);

  // 데이터 이력관리에 조회 저장을 위해 추가
  useEffect(() => {
    if (isCreateMode) return;
    const key = String(detailId ?? '').trim();
    if (!key) return;
    recordDataViewLog({
      tableName: mainTable,
      keyField,
      keyValue: key,
      serviceName: '점용대장',
    });
  }, [detailId, isCreateMode, mainTable, keyField]);

  useEffect(() => {
    setHighlightParcel(null);
    setHighlightVariant('blue');
    setShowParentGeom(true);
    setChildModal(null);
    setParcelEditModal(null);
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

  useEffect(() => {
    if (!isCreateMode) {
      setNextKey('');
      setNextPermitNo('');
      setNextAutoCode('');
      return;
    }
    let cancelled = false;
    if (autoCodeFieldLower) {
      void call('', 'POST', {
        service: 'occupationLedgerService',
        action: 'getNextOccupationLedgerAutoCode',
        params: { serEng },
      })
        .then((res) => {
          if (cancelled) return;
          const data = res?.data ?? res;
          setNextAutoCode(String(data?.code ?? '').trim());
        })
        .catch(() => {
          if (!cancelled) setNextAutoCode('');
        });
    }
    void call('', 'POST', {
      service: 'occupationLedgerService',
      action: 'getNextOccupationLedgerKey',
      params: { serEng },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setNextKey(String(data?.key ?? '').trim());
      })
      .catch(() => {
        if (!cancelled) setNextKey('');
      });
    void call('', 'POST', {
      service: 'occupationLedgerService',
      action: 'getNextOccupationLedgerPermitNo',
      params: { year: currentPermitYear(), serEng },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setNextPermitNo(String(data?.permitNo ?? '').trim());
      })
      .catch(() => {
        if (!cancelled) setNextPermitNo('');
      });
    return () => {
      cancelled = true;
    };
  }, [autoCodeFieldLower, isCreateMode, serEng]);

  /** 신규: 정의 테이블 → 추가속성 초기 목록 / 수정: 정의 이름만(수동 추가용) */
  useEffect(() => {
    let cancelled = false;
    void call('', 'POST', {
      service: 'layerExtraService',
      action: 'getLayerExtraDefs',
      params: {
        tableName: mainTable,
        tableSchema: binding?.schema ?? 'layer',
      },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const items = Array.isArray(data?.items) ? data.items : [];
        const defs: LayerExtraDefOption[] = items
          .map((it: { fieldName?: string; dataType?: string }) => ({
            fieldName: String(it.fieldName ?? '').trim(),
            dataType: String(it.dataType ?? 'text').trim() || 'text',
          }))
          .filter((it: LayerExtraDefOption) => it.fieldName);
        setExtraDefs(defs);
        if (isCreateMode) {
          setExtraItems(
            items.map(
              (
                it: { fieldName?: string; dataType?: string; sortOrder?: number },
                idx: number
              ) => ({
                fieldName: String(it.fieldName ?? '').trim(),
                dataType: String(it.dataType ?? 'text').trim() || 'text',
                value: '',
                sortOrder: Number(it.sortOrder) || idx + 1,
              })
            )
          );
        }
      })
      .catch(() => {
        if (cancelled) return;
        setExtraDefs([]);
        if (isCreateMode) setExtraItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isCreateMode, mainTable, binding?.schema, detailId]);

  const parcelDetailFieldKeys = useMemo(
    () => parcelFieldDefs.map((f) => f.field),
    [parcelFieldDefs]
  );

  const mergeAutoParcels = useCallback(
    (
      prev: LayerRowParcelItem[],
      autoItems: LayerRowParcelItem[],
      options?: { replaceKept?: boolean }
    ) => {
      if (!binding) return autoItems;
      const jijukItems = autoItems as OccupationJijukAutoParcel[];
      return mergeJijukIntoOccupationParcels(
        prev,
        jijukItems,
        binding,
        parcelDetailFieldKeys,
        options
      );
    },
    [binding, parcelDetailFieldKeys]
  );

  const enrichManualParcel = useCallback(
    (item: LayerRowParcelItem) => {
      if (!binding) return item;
      return enrichOccupationParcelFromAddress(item, binding, parcelDetailFieldKeys);
    },
    [binding, parcelDetailFieldKeys]
  );

  const persistExtra = useCallback(
    async (ctx: { keyValue: string; isCreate: boolean }) => {
      const fields = extraItemsRef.current
        .map((it, idx) => ({
          fieldName: String(it.fieldName ?? '').trim(),
          dataType: String(it.dataType ?? 'text').trim() || 'text',
          value: it.value == null ? '' : String(it.value),
          sortOrder: Number(it.sortOrder) || idx + 1,
        }))
        .filter((it) => it.fieldName);
      try {
        const res = await call('', 'POST', {
          service: 'layerExtraService',
          action: 'saveLayerRowExtra',
          params: {
            tableName: mainTable,
            tableSchema: binding?.schema ?? 'layer',
            keyField,
            keyValue: ctx.keyValue,
            fields,
            replaceDefs: ctx.isCreate,
          },
        });
        const data = res?.data ?? res;
        if (data?.success === false || data?.error) {
          return { ok: false as const, error: String(data?.error ?? '추가속성 저장 실패') };
        }
        return { ok: true as const };
      } catch (e: unknown) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : '추가속성 저장 실패',
        };
      }
    },
    [mainTable, binding?.schema, keyField]
  );

  const formAttributesForEdit = useMemo(() => {
    const base = (isCreateMode ? formAttributes : attributes).filter(
      (row) => row.showDetail !== false
    );
    if (!isCreateMode) return base;
    return base.map((row) => {
      const fl = row.field.toLowerCase();
      if (fl === 'id' && nextKey) return { ...row, value: nextKey };
      if (fl === permitFieldLower && nextPermitNo) return { ...row, value: nextPermitNo };
      if (fl === autoCodeFieldLower && nextAutoCode) return { ...row, value: nextAutoCode };
      return row;
    });
  }, [
    attributes,
    autoCodeFieldLower,
    formAttributes,
    isCreateMode,
    nextAutoCode,
    nextKey,
    nextPermitNo,
    permitFieldLower,
  ]);

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
    updateDraftParcel,
    removeDraftParcel,
  } = useLayerRowEdit({
    preset,
    rowKey: isCreateMode ? '' : detailId,
    attributes: formAttributesForEdit,
    initialParcels: parcels,
    isCreateMode,
    mergeAutoParcels: binding ? mergeAutoParcels : undefined,
    enrichManualParcel: binding ? enrichManualParcel : undefined,
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
    drawChildGeomOnMap: false,
    afterPersist: persistExtra,
  });

  const handleOccupationDraftChange = useCallback(
    (field: string, value: string) => {
      handleDraftChange(field, value);
      const fl = field.toLowerCase();
      if (!fl || (fl !== endFieldLower && fl !== startFieldLower)) return;
      const endVal = fl === endFieldLower ? value : draftFieldValue(draft, endFieldLower);
      handleDraftChange(draftFieldKey(draft, stateFieldLower), deriveOccupationPeriodState(endVal));
    },
    [draft, endFieldLower, handleDraftChange, startFieldLower, stateFieldLower]
  );

  const startDateRaw = startFieldLower ? draftFieldValue(draft, startFieldLower) : '';
  const permitFieldKey = draftFieldKey(draft, permitFieldLower);
  const permitValue = draftFieldValue(draft, permitFieldLower);

  const fetchNextPermitNo = useCallback(
    async (year: number) => {
      try {
        const res = await call('', 'POST', {
          service: 'occupationLedgerService',
          action: 'getNextOccupationLedgerPermitNo',
          params: {
            year,
            serEng,
            excludeKey: isCreateMode ? undefined : detailId,
          },
        });
        const data = res?.data ?? res;
        const next = String(data?.permitNo ?? '').trim();
        return next || null;
      } catch {
        return null;
      }
    },
    [detailId, isCreateMode, serEng]
  );

  useAutoOccupationPermitNo({
    enabled: isCreateMode,
    sessionKey: `${serEng}:${detailId}:${isCreateMode ? 'create' : 'view'}`,
    startDateRaw,
    permitValue,
    permitFieldKey,
    onSetPermit: handleDraftChange,
    fetchNext: fetchNextPermitNo,
    useCurrentYearWhenEmpty: isCreateMode,
  });

  const placeFieldKey = useMemo(() => {
    const fromAttrs = formAttributesForEdit.find(
      (a) => a.field.toLowerCase() === placeFieldLower
    );
    return fromAttrs?.field ?? placeFieldLower;
  }, [formAttributesForEdit, placeFieldLower]);

  useLayerRowPlaceFromGeom({
    enabled: isEditing && Boolean(placeFieldLower),
    placeFieldKey,
    onSetPlace: handleDraftChange,
    parcelAddresses: draftParcels.map((p) => p.address),
    refillOnParcelList: isCreateMode,
  });

  const handleAutoCalcArea = useCallback(
    (field: string): string | null => {
      const wkt = String(mapContext?.layerRowGeomEditWktRef?.current ?? '').trim();
      if (!wkt) return '도형을 먼저 지정하거나 수정해 주세요.';
      const areaSqm = computeAreaSqmFromWkt5181(wkt);
      if (!Number.isFinite(areaSqm) || areaSqm <= 0) {
        return '도형 면적을 계산할 수 없습니다.';
      }
      handleDraftChange(field, String(areaSqm));
      return null;
    },
    [handleDraftChange, mapContext?.layerRowGeomEditWktRef]
  );

  useLayerRowParcelHighlight(showParentGeom ? null : highlightParcel, highlightVariant);
  const { parentExtentRef } = useOccupationLedgerParentGeomHighlight(
    detailId,
    mainTable,
    keyField,
    showParentGeom && !isCreateMode,
    isEditing,
    reloadToken
  );

  useEffect(() => {
    if (!isEditing) {
      setShowParentGeom(true);
      ensureOccupationLedgerWmsLayers(mapContext?.setVisibleLayerNames, { serEng });
      return;
    }
    setHighlightParcel(null);
    setShowParentGeom(true);
    clearSoloSelection();
    clearMgjSelection();
    ensureOccupationLedgerWmsLayers(mapContext?.setVisibleLayerNames, {
      serEng,
      omitMain: Boolean(mapContext?.layerRowGeomEdit),
    });
  }, [
    clearMgjSelection,
    clearSoloSelection,
    isEditing,
    mapContext?.layerRowGeomEdit,
    mapContext?.setVisibleLayerNames,
    serEng,
  ]);

  const focusParentGeomOnMap = useCallback(() => {
    setShowParentGeom(true);
    setHighlightParcel(null);

    const map = mapContext?.mapInstanceRef?.current;
    const cached = parentExtentRef.current;
    if (map && cached) {
      ensureOccupationLedgerWmsLayers(mapContext?.setVisibleLayerNames, {
        serEng,
        omitMain: Boolean(mapContext?.layerRowGeomEdit),
      });
      scheduleFitMapToExtent3857(map, cached, {
        maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      });
      return;
    }

    void refreshOccupationLedgerMapView({
      map,
      detailId,
      serEng,
      setVisibleLayerNames: mapContext?.setVisibleLayerNames,
      applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current ?? null,
    });
  }, [detailId, mapContext, parentExtentRef, serEng]);

  useEffect(() => {
    if (isEditing) {
      const base = mgjItems.map((p) => ({ ...p, showMapGeom: false as const }));
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
      const nextItem: LayerRowParcelItem = { ...item, showMapGeom: false };
      setDraftMgj((prev) => {
        if (prev.some((p) => p.address.toLowerCase() === addrKey)) return prev;
        mgjDirtyRef.current = true;
        return [...prev, nextItem];
      });
      void resolveParcelGeoms([nextItem]).then(([resolved]) => {
        if (!resolved) return;
        const merged: LayerRowParcelItem = {
          ...nextItem,
          pnu: resolved.pnu ?? nextItem.pnu,
          extent3857: resolved.extent3857 ?? nextItem.extent3857,
          geometry3857: resolved.geometry3857 ?? nextItem.geometry3857,
          showMapGeom: false,
        };
        setDraftMgj((prev) =>
          prev.map((p) => (p.address.toLowerCase() === addrKey ? merged : p))
        );
      });
    },
    []
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
      ensureOccupationLedgerWmsLayers(mapContext?.setVisibleLayerNames, {
        serEng,
        omitMain: Boolean(mapContext?.layerRowGeomEdit),
      });
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
      mapContext?.layerRowGeomEdit,
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
      ensureOccupationLedgerWmsLayers(mapContext?.setVisibleLayerNames, {
        serEng,
        omitMain: Boolean(mapContext?.layerRowGeomEdit),
      });
      void selectMgjParcel(item, idx, {
        onHighlight: setHighlightParcel,
        enableWmsLayer: false,
      });
    },
    [
      clearMgjSelection,
      clearSoloSelection,
      focusParentGeomOnMap,
      mapContext?.layerRowGeomEdit,
      mapContext?.setVisibleLayerNames,
      selectMgjParcel,
      selectedMgjIdx,
      serEng,
    ]
  );

  const parcelValuesFromItem = useCallback(
    (item: LayerRowParcelItem, role: 'jijuk' | 'mgj') => {
      const defs = role === 'mgj' ? mgjFieldDefs : parcelFieldDefs;
      const values: Record<string, string> = { ...(item.listValues ?? {}) };
      for (const def of defs) {
        const fl = def.field.toLowerCase();
        if (values[def.field] != null && String(values[def.field]).trim()) continue;
        const fromList = item.listValues?.[def.field] ?? item.listValues?.[fl];
        if (fromList != null && String(fromList).trim()) {
          values[def.field] = String(fromList);
        }
      }
      const addrField = String(binding?.fields.childAddressField ?? '').toLowerCase();
      if (addrField && !String(values[defs.find((d) => d.field.toLowerCase() === addrField)?.field ?? ''] ?? '').trim()) {
        const key = defs.find((d) => d.field.toLowerCase() === addrField)?.field;
        if (key) values[key] = item.address;
      }
      return values;
    },
    [binding?.fields.childAddressField, mgjFieldDefs, parcelFieldDefs]
  );

  const openParcelEditModal = useCallback(
    (role: 'jijuk' | 'mgj', item: LayerRowParcelItem, idx: number) => {
      setParcelEditModal({
        role,
        index: idx,
        values: parcelValuesFromItem(item, role),
      });
    },
    [parcelValuesFromItem]
  );

  /** 조회: 지도 + 읽기 모달. 수정: 지도 + 필지·물건지 편집 모달 */
  const openChildRow = useCallback(
    (
      role: 'jijuk' | 'mgj',
      item: LayerRowParcelItem,
      idx: number,
      selectedIdx: number | null,
      select: (item: LayerRowParcelItem, idx: number) => void
    ) => {
      if (selectedIdx !== idx) select(item, idx);
      if (isEditing) {
        openParcelEditModal(role, item, idx);
        return;
      }
      const ogcFid = String(item.wmsRowKey?.keyValue ?? '').trim();
      if (/^\d+$/.test(ogcFid)) setChildModal({ role, ogcFid, address: item.address });
    },
    [isEditing, openParcelEditModal]
  );

  /** 조회 모달 닫기 — 선택한 필지·물건지 해제 후 본표 전체 도형으로 복귀 */
  const handleCloseChildModal = useCallback(() => {
    setChildModal(null);
    clearSoloSelection();
    clearMgjSelection();
    focusParentGeomOnMap();
  }, [clearMgjSelection, clearSoloSelection, focusParentGeomOnMap]);

  /** 조회 모달 «수정» — 수정 모드로 전환한 뒤 같은 필지·물건지 편집 모달을 연다 */
  const pendingEditChildRef = useRef<{ role: 'jijuk' | 'mgj'; ogcFid: string } | null>(null);

  const handleEditFromChildModal = useCallback(() => {
    const modal = childModal;
    if (!modal) return;
    pendingEditChildRef.current = { role: modal.role, ogcFid: modal.ogcFid };
    setChildModal(null);
    void handleEdit();
  }, [childModal, handleEdit]);

  useEffect(() => {
    const pending = pendingEditChildRef.current;
    if (!pending) return;
    if (editError) {
      pendingEditChildRef.current = null;
      return;
    }
    if (!isEditing) return;
    const list = pending.role === 'mgj' ? draftMgj : draftParcels;
    if (list.length === 0) return;
    pendingEditChildRef.current = null;
    const idx = list.findIndex(
      (p) => String(p.wmsRowKey?.keyValue ?? '').trim() === pending.ogcFid
    );
    if (idx < 0) return;
    openParcelEditModal(pending.role, list[idx]!, idx);
  }, [draftMgj, draftParcels, editError, isEditing, openParcelEditModal]);

  useEffect(() => {
    pendingEditChildRef.current = null;
  }, [detailId]);

  const handleParcelEditFieldChange = useCallback((field: string, value: string) => {
    setParcelEditModal((m) => (m ? { ...m, values: { ...m.values, [field]: value } } : m));
  }, []);

  const handleSaveParcelEditModal = useCallback(() => {
    const modal = parcelEditModal;
    if (!modal) return;
    const list = modal.role === 'mgj' ? draftMgj : draftParcels;
    const item = list[modal.index];
    if (!item) {
      setParcelEditModal(null);
      return;
    }
    const next: LayerRowParcelItem = {
      ...item,
      listValues: { ...modal.values },
    };
    if (modal.role === 'mgj') {
      const updated = draftMgj.map((p, i) => (i === modal.index ? next : p));
      draftMgjRef.current = updated;
      setDraftMgj(updated);
      mgjDirtyRef.current = true;
    } else {
      updateDraftParcel(modal.index, next);
    }
    setParcelEditModal(null);
  }, [draftMgj, draftParcels, parcelEditModal, updateDraftParcel]);

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
    <div className="flex min-h-0 h-full flex-col bg-background">
      <LayerRowEditHeader
        title={`${binding?.title ?? '점용'} 상세`}
        actionsPlacement="footer"
        onClose={() => {
          mapContext?.setOccupationLedgerMapHitOptions?.([]);
          onClose();
        }}
        {...editToolbarProps}
      />
      <MapHitOverlapSelect
        fieldLabel="허가번호"
        options={hitOptions}
        value={detailId}
        onChange={(id) => onSelectDetailId?.(id)}
      />

      <MapSideDetailScroll className="min-h-0 flex-1 px-3 py-2 text-xs">
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
          <div className="mb-2 rounded border border-destructive/20 bg-destructive/10 px-2 py-2 text-destructive">
            {editError}
          </div>
        )}
        {showBody && ledgerFields && (
          <>
            <OccupationLedgerDetailSection title="속성정보">
              <OccupationLedgerAttributeSection
                attributes={formAttributesForEdit}
                fields={ledgerFields}
                isEditing={isEditing}
                draft={draft}
                readOnlyFields={readOnlyFields}
                dateFields={dateFields}
                vworldApiKey={mapContext?.vworldApiKey ?? ''}
                onDraftChange={handleOccupationDraftChange}
                resetKey={detailId}
                onAutoCalcArea={handleAutoCalcArea}
              />
            </OccupationLedgerDetailSection>

            {(isEditing || extraItems.length > 0) && (
              <OccupationLedgerDetailSection
                title="추가속성"
                className="mt-3"
                headerActions={
                  isEditing ? (
                    <span className="whitespace-nowrap text-[10px] leading-none text-muted-foreground">
                      * 드래그 시 순서가 변경됩니다.
                    </span>
                  ) : undefined
                }
              >
                {isEditing ? (
                  <LayerExtraFieldsEditor
                    items={extraItems}
                    isEditing
                    onChange={setExtraItems}
                    availableDefs={isCreateMode ? [] : extraDefs}
                    hideHeader
                  />
                ) : (
                  <RoadRewardAttrTable
                    stringValueMaxLines={2}
                    entries={extraItems.map((it, idx) => {
                      const text = String(it.value ?? '').trim() || '—';
                      return {
                        fieldKey: `${it.fieldName}-${idx}`,
                        label: it.fieldName,
                        value: text,
                        fullWidth: isOccupationLedgerExtraFullWidth(text),
                      };
                    })}
                  />
                )}
              </OccupationLedgerDetailSection>
            )}

            {(isEditing || !isCreateMode) && (
              <OccupationLedgerParcelList
                key={`jijuk:${detailId}`}
                title="필지목록"
                isEditing={isEditing}
                items={parcelList}
                columns={parcelColumns}
                selectedIdx={selectedSoloIdx}
                onAdd={isEditing ? () => setParcelAddModalOpen(true) : undefined}
                onRemove={isEditing ? removeDraftParcel : undefined}
                onClick={(item, idx) =>
                  openChildRow('jijuk', item, idx, selectedSoloIdx, handleSelectSoloParcel)
                }
                emptyHintEdit="도형을 그리거나 수정하면 필지목록이 자동으로 채워집니다. 「추가」로 직접 등록할 수도 있습니다."
                emptyHintView="등록된 필지가 없습니다."
              />
            )}

            {(isEditing || !isCreateMode) && (
              <OccupationLedgerParcelList
                key={`mgj:${detailId}`}
                title="물건지목록"
                isEditing={isEditing}
                items={mgjList}
                columns={mgjColumns}
                selectedIdx={selectedMgjIdx}
                onAdd={isEditing ? () => setMgjAddModalOpen(true) : undefined}
                onRemove={isEditing ? handleRemoveMgj : undefined}
                onClick={(item, idx) =>
                  openChildRow('mgj', item, idx, selectedMgjIdx, handleSelectMgjParcel)
                }
                emptyHintEdit="「추가」로 주소를 검색해 물건지를 등록합니다."
                emptyHintView="등록된 물건지가 없습니다."
              />
            )}

            {!isCreateMode && (
              <OccupationLedgerCollapsibleSection key={`fee:${detailId}`} title="점사용료 이력" count={0}>
                <div className="rounded border border-dashed border-border bg-muted/50 px-2 py-4 text-center text-[11px] text-muted-foreground">
                  연계된 점사용료가 없습니다.
                </div>
              </OccupationLedgerCollapsibleSection>
            )}

            {binding ? (
              <UsageDataAsAttachmentSection
                fileKey={isCreateMode ? '' : attachmentKey}
                zipLabel={binding.title}
                ready={!isCreateMode && !loading}
                serEng={binding.serEng}
                layer={binding.fileLayer}
              />
            ) : null}
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

      <LayerRowEditFooter {...editToolbarProps} />

      {childModal ? (
        <OccupationLedgerChildModal
          serEng={serEng}
          role={childModal.role}
          ogcFid={childModal.ogcFid}
          address={childModal.address}
          onClose={handleCloseChildModal}
          onEdit={handleEditFromChildModal}
          overlayLeftPx={overlayLeftPx}
          overlayWidthPx={overlayWidthPx}
        />
      ) : null}

      {parcelEditModal ? (
        <OccupationLedgerParcelEditModal
          title={parcelEditModal.role === 'mgj' ? '물건지 정보' : '필지 정보'}
          address={
            (parcelEditModal.role === 'mgj' ? draftMgj : draftParcels)[parcelEditModal.index]?.address ??
            ''
          }
          fieldDefs={parcelEditModal.role === 'mgj' ? mgjFieldDefs : parcelFieldDefs}
          values={parcelEditModal.values}
          onFieldChange={handleParcelEditFieldChange}
          onSave={handleSaveParcelEditModal}
          onClose={() => setParcelEditModal(null)}
          overlayLeftPx={overlayLeftPx}
          overlayWidthPx={overlayWidthPx}
        />
      ) : null}

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
