'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Crosshair,
  Loader2,
  X,
} from 'lucide-react';
import { call } from '@/lib/api';
import { formatDefineFieldDisplayValue, isDefineFieldCodeType } from '@/lib/defineLayerCodeDisplay';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import type { WaterPlayChildKind, WaterPlayChildPoint, WaterPlaySignListItem } from '@/service/waterPlaySignService';
import { LAYER_ROW_NEW_ID } from '../../../_mapComponents/layerRowEdit';
import {
  DetailAttrRow,
  DetailAttrTable,
  LayerRowEditFooter,
} from '../../../_mapComponents/layerRowEdit';
import {
  getDefineFieldDisplayLabel,
  getRowValueByDefineField,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils';
import { useDefineLayerCodesByFieldNames } from '../../../_mapComponents/standard/useDefineLayerCodes';
import { AddressSearchPanel } from '../../../_mapComponents/addressSearch/AddressSearchPanel';
import { useMapPointPick } from '../../../_mapComponents/addressSearch/useMapPointPick';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { WATER_PLAY_BOX_LIST_GEO_TABLE, WATER_PLAY_SIGN_GEO_TABLE, WATER_PLAY_SIGN_LIST_GEO_TABLE, refreshSafetyMapGeoLayer } from '../../../_mapComponents/layerFactory/safetydataMapLayerFactory';
import { formatWaterPlaySignAddressDisplay } from './waterPlaySignAddressDisplay';
import { parseSidoSggFromAddress } from './waterPlaySignAddressParts';
import {
  flyToWaterPlayChildGeom,
  flyToWaterPlaySignLonLat,
  flyToWaterPlaySignRow,
} from './waterPlaySignMapFly';
import { WaterPlayChildPointList } from './WaterPlayChildPointList';
import { usePublicLayerAddressPrefixes } from '../usePublicLayerAddressPrefixes';
import { useSafetyLayerDetailColumns } from '../useSafetyLayerDetailColumns';
import { SafetyFacHistorySection } from '../safetyFac/SafetyFacHistorySection';

type Props = {
  detailId: number | typeof LAYER_ROW_NEW_ID;
  onClose: () => void;
  onCreated?: (id: number) => void;
  onDeleted?: () => void;
  onListRefresh?: () => void;
};

const ATTRS_SECTION_TITLE = '속성보기';

const DETAIL_ATTR_LABEL_CLASS =
  'bg-slate-100 font-semibold text-slate-500 dark:bg-muted dark:text-muted-foreground';

const DETAIL_ATTR_ROW_COMMON = {
  labelClassName: DETAIL_ATTR_LABEL_CLASS,
} as const;

const FIELD_INPUT_CLASS =
  'h-8 w-full rounded border border-border bg-background px-2 text-[11px] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const FIELD_TEXTAREA_CLASS =
  'min-h-[4rem] w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-[11px] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

function emptyFormFromFields(fields: DefineFieldLike[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const f of fields) {
    const name = String(f.define_field_name ?? '').trim();
    if (name) next[name] = '';
  }
  return next;
}

function formFromItem(item: WaterPlaySignListItem): Record<string, string> {
  const fmt = (v: string) => (v && v !== '-' ? v : '');
  const fmtNum = (n: number | null) =>
    n != null && Number.isFinite(n) ? String(n) : '';
  return {
    sido: fmt(item.sido),
    sgg: fmt(item.sgg),
    addr: fmt(item.addr),
    addr_detail: fmt(item.addrDetail),
    gubun: fmt(item.gubun),
    is_warnig: fmt(item.isWarnig),
    safebox_cnt: fmtNum(item.safeboxCnt),
    sign_cnt: fmtNum(item.signCnt),
    remark: fmt(item.remark),
  };
}

function lonLatFromGeomJson(geomJson: unknown): { lon: number | null; lat: number | null } {
  if (!geomJson || typeof geomJson !== 'object' || !('type' in geomJson)) {
    return { lon: null, lat: null };
  }
  const g = geomJson as { type?: string; coordinates?: unknown };
  const type = String(g.type ?? '');
  const pickPair = (coords: unknown): { lon: number; lat: number } | null => {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
      return null;
    }
    return pickPair(coords[0]);
  };
  if (type === 'Point') {
    const pair = pickPair(g.coordinates);
    return pair ?? { lon: null, lat: null };
  }
  const pair = pickPair(g.coordinates);
  return pair ?? { lon: null, lat: null };
}

function parseNumberInput(raw: string): number | null {
  const s = String(raw ?? '').replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

export function WaterPlaySignDetailPanel({
  detailId,
  onClose,
  onCreated,
  onDeleted,
  onListRefresh,
}: Props) {
  const isCreateMode = detailId === LAYER_ROW_NEW_ID;
  const mapContext = useMapContext();
  const vworldApiKey = mapContext?.vworldApiKey ?? '';
  const { columns: detailFields, columnsLoading: fieldsLoading } =
    useSafetyLayerDetailColumns('water_play_sign');
  const codeFieldNames = useMemo(
    () =>
      detailFields
        .filter((f) => isDefineFieldCodeType(f.define_field_type))
        .map((f) => String(f.define_field_name ?? '').trim())
        .filter(Boolean),
    [detailFields]
  );
  const codesByField = useDefineLayerCodesByFieldNames('water_play_sign', codeFieldNames);
  const addressPrefixes = usePublicLayerAddressPrefixes();

  const [loading, setLoading] = useState(!isCreateMode);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<WaterPlaySignListItem | null>(null);
  const [attrsOpen, setAttrsOpen] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [lon, setLon] = useState<number | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [boxItems, setBoxItems] = useState<WaterPlayChildPoint[]>([]);
  const [signItems, setSignItems] = useState<WaterPlayChildPoint[]>([]);
  const [childPickKind, setChildPickKind] = useState<WaterPlayChildKind | null>(null);
  const [movingChild, setMovingChild] = useState<{ kind: WaterPlayChildKind; idx: number } | null>(
    null
  );
  const childPickKindRef = useRef<WaterPlayChildKind | null>(null);
  const waitingChildAddrRef = useRef(false);
  childPickKindRef.current = childPickKind;

  const isEditing = isCreateMode || editMode;

  const refreshGeoLayers = useCallback(() => {
    const map = mapContext?.mapInstanceRef?.current ?? null;
    refreshSafetyMapGeoLayer(map, WATER_PLAY_BOX_LIST_GEO_TABLE);
    refreshSafetyMapGeoLayer(map, WATER_PLAY_SIGN_LIST_GEO_TABLE);
  }, [mapContext?.mapInstanceRef]);

  const applyAddressToForm = useCallback((fullAddress: string) => {
    const { addr, sido, sgg } = parseSidoSggFromAddress(fullAddress);
    setForm((prev) => ({ ...prev, addr, sido, sgg }));
  }, []);

  const addChildPointRef = useRef<
    (kind: WaterPlayChildKind, pickedLon: number, pickedLat: number, address: string) => Promise<void>
  >(async () => {});

  const { pickMode, startPick, stopPick, clearDraftPoint } = useMapPointPick({
    vworldApiKey,
    onPicked: ({ lon: pickedLon, lat: pickedLat, address }) => {
      const kind = childPickKindRef.current;
      if (kind) {
        if (!waitingChildAddrRef.current) {
          waitingChildAddrRef.current = true;
          return;
        }
        waitingChildAddrRef.current = false;
        void addChildPointRef.current(kind, pickedLon, pickedLat, address);
        return;
      }
      waitingChildAddrRef.current = false;
      setLon(pickedLon);
      setLat(pickedLat);
      if (address) applyAddressToForm(address);
      flyToWaterPlaySignLonLat(
        mapContext?.mapInstanceRef?.current ?? null,
        pickedLon,
        pickedLat,
        () => mapContext?.applyMapViewPaddingRef?.current?.()
      );
    },
  });

  const addChildPoint = useCallback(
    async (kind: WaterPlayChildKind, pickedLon: number, pickedLat: number, address: string) => {
      if (isCreateMode || typeof detailId !== 'number') {
        setError('관리 구간을 먼저 저장하세요.');
        return;
      }
      try {
        const res = await call('', 'POST', {
          service: 'waterPlaySignService',
          action: 'addChild',
          params: {
            kind,
            id: detailId,
            addr: address,
            lon: pickedLon,
            lat: pickedLat,
          },
        });
        const data = res?.data ?? res;
        if (data?.error || data?.ok === false) {
          setError(String(data?.error ?? '위치를 넣지 못했습니다.'));
          return;
        }
        const next = data?.item as WaterPlayChildPoint | undefined;
        if (next) {
          if (kind === 'box') setBoxItems((prev) => [...prev, next]);
          else setSignItems((prev) => [...prev, next]);
        }
        setChildPickKind(null);
        clearDraftPoint();
        refreshGeoLayers();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [clearDraftPoint, detailId, isCreateMode, refreshGeoLayers]
  );
  addChildPointRef.current = addChildPoint;

  const startParentPick = useCallback(() => {
    setChildPickKind(null);
    startPick();
  }, [startPick]);

  const startChildPick = useCallback(
    (kind: WaterPlayChildKind) => {
      if (isCreateMode || typeof detailId !== 'number') {
        setError('관리 구간을 먼저 저장하세요.');
        return;
      }
      setError(null);
      waitingChildAddrRef.current = false;
      setChildPickKind(kind);
      clearDraftPoint();
      startPick();
    },
    [clearDraftPoint, detailId, isCreateMode, startPick]
  );

  const stopAllPick = useCallback(() => {
    waitingChildAddrRef.current = false;
    setChildPickKind(null);
    stopPick();
    clearDraftPoint();
  }, [clearDraftPoint, stopPick]);

  const resetEditForm = useCallback((row: WaterPlaySignListItem | null) => {
    if (!row) return;
    setForm(formFromItem(row));
    const { lon: l, lat: la } = lonLatFromGeomJson(row.geomJson);
    setLon(l);
    setLat(la);
  }, []);

  const loadDetail = useCallback(async () => {
    if (isCreateMode) return;
    setLoading(true);
    setError(null);
    setItem(null);
    try {
      const res = await call('', 'POST', {
        service: 'waterPlaySignService',
        action: 'get',
        params: { id: detailId },
      });
      const data = res?.data ?? res;
      const row = (data?.item ?? null) as WaterPlaySignListItem | null;
      if (!row) {
        setError('항목을 찾을 수 없습니다.');
        return;
      }
      setItem(row);
      setBoxItems(Array.isArray(data?.boxItems) ? data.boxItems : []);
      setSignItems(Array.isArray(data?.signItems) ? data.signItems : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [detailId, isCreateMode]);

  useEffect(() => {
    if (isCreateMode) {
      setItem(null);
      setBoxItems([]);
      setSignItems([]);
      setLoading(false);
      setError(null);
      setEditMode(false);
      setLon(null);
      setLat(null);
      return;
    }
    setEditMode(false);
    void loadDetail();
  }, [detailId, isCreateMode, loadDetail]);

  useEffect(() => {
    if (!isCreateMode || fieldsLoading) return;
    setForm(emptyFormFromFields(detailFields));
    setLon(null);
    setLat(null);
  }, [isCreateMode, detailFields, fieldsLoading, detailId]);

  useEffect(() => {
    if (isCreateMode || !item || editMode) return;
    resetEditForm(item);
  }, [item, isCreateMode, editMode, resetEditForm]);

  const headerTitle = useMemo(() => {
    if (isEditing) {
      const detail = (form.addr_detail ?? '').trim();
      if (detail) return detail;
      return isCreateMode ? '등록' : '—';
    }
    if (item) {
      const detail = item.addrDetail && item.addrDetail !== '-' ? String(item.addrDetail).trim() : '';
      if (detail) return detail;
    }
    return '—';
  }, [isEditing, form.addr_detail, isCreateMode, item]);

  const updateForm = useCallback((field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const buildSaveParams = useCallback(
    () => ({
      sido: form.sido ?? '',
      sgg: form.sgg ?? '',
      addr: form.addr ?? '',
      addr_detail: form.addr_detail ?? '',
      gubun: form.gubun ?? '',
      is_warnig: form.is_warnig ?? '',
      safebox_cnt: parseNumberInput(form.safebox_cnt ?? ''),
      sign_cnt: parseNumberInput(form.sign_cnt ?? ''),
      remark: form.remark ?? '',
      lon,
      lat,
    }),
    [form, lon, lat]
  );

  const handleCreate = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'waterPlaySignService',
        action: 'create',
        params: buildSaveParams(),
      });
      const data = res?.data ?? res;
      if (data?.error || data?.ok === false) {
        setError(String(data?.error ?? '등록에 실패했습니다.'));
        return;
      }
      const newId = Number(data?.id);
      if (!Number.isFinite(newId) || newId <= 0) {
        setError('등록에 실패했습니다.');
        return;
      }
      stopAllPick();
      refreshGeoLayers();
      const map = mapContext?.mapInstanceRef?.current ?? null;
      const applyPad = () => mapContext?.applyMapViewPaddingRef?.current?.();
      const savedItem = (data?.item ?? null) as WaterPlaySignListItem | null;
      if (savedItem) {
        flyToWaterPlaySignRow(map, savedItem, applyPad);
      } else {
        flyToWaterPlaySignLonLat(map, lon, lat, applyPad);
      }
      onListRefresh?.();
      onCreated?.(newId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [
    buildSaveParams,
    lat,
    lon,
    mapContext?.mapInstanceRef,
    onCreated,
    onListRefresh,
    refreshGeoLayers,
    stopAllPick,
  ]);

  const handleUpdate = useCallback(async () => {
    if (isCreateMode || !item) return;
    setSaving(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'waterPlaySignService',
        action: 'update',
        params: { id: item.id, ...buildSaveParams() },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.ok === false) {
        setError(String(data?.error ?? '저장에 실패했습니다.'));
        return;
      }
      stopAllPick();
      refreshGeoLayers();
      setEditMode(false);
      const map = mapContext?.mapInstanceRef?.current ?? null;
      const applyPad = () => mapContext?.applyMapViewPaddingRef?.current?.();
      const savedItem = (data?.item ?? null) as WaterPlaySignListItem | null;
      if (savedItem) {
        flyToWaterPlaySignRow(map, savedItem, applyPad);
      } else {
        flyToWaterPlaySignLonLat(map, lon, lat, applyPad);
      }
      onListRefresh?.();
      await loadDetail();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [
    buildSaveParams,
    isCreateMode,
    item,
    lat,
    loadDetail,
    lon,
    mapContext?.mapInstanceRef,
    onListRefresh,
    refreshGeoLayers,
    stopAllPick,
  ]);

  const handleDelete = useCallback(async () => {
    if (isCreateMode || !item) return;
    if (!window.confirm('이 물놀이 표지판을 삭제하시겠습니까?')) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'waterPlaySignService',
        action: 'remove',
        params: { id: item.id },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.ok === false) {
        setError(String(data?.error ?? '삭제에 실패했습니다.'));
        return;
      }
      stopAllPick();
      refreshGeoLayers();
      onListRefresh?.();
      onDeleted?.();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }, [isCreateMode, item, onClose, onDeleted, onListRefresh, refreshGeoLayers, stopAllPick]);

  const handleEdit = useCallback(() => {
    if (!item) return;
    resetEditForm(item);
    setEditMode(true);
    setError(null);
  }, [item, resetEditForm]);

  const handleCancelEdit = useCallback(() => {
    if (isCreateMode) {
      stopAllPick();
      refreshGeoLayers();
      onClose();
      return;
    }
    stopAllPick();
    setEditMode(false);
    setError(null);
    if (item) resetEditForm(item);
  }, [isCreateMode, item, onClose, refreshGeoLayers, resetEditForm, stopAllPick]);

  const handleSave = useCallback(() => {
    if (isCreateMode) void handleCreate();
    else void handleUpdate();
  }, [handleCreate, handleUpdate, isCreateMode]);

  const handleRemoveChild = useCallback(
    async (kind: WaterPlayChildKind, row: WaterPlayChildPoint) => {
      try {
        const res = await call('', 'POST', {
          service: 'waterPlaySignService',
          action: 'removeChild',
          params: { kind, fid: row.fid },
        });
        const data = res?.data ?? res;
        if (data?.error || data?.ok === false) {
          setError(String(data?.error ?? '위치를 지우지 못했습니다.'));
          return;
        }
        if (kind === 'box') setBoxItems((prev) => prev.filter((it) => it.fid !== row.fid));
        else setSignItems((prev) => prev.filter((it) => it.fid !== row.fid));
        refreshGeoLayers();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshGeoLayers]
  );

  const handleChildClick = useCallback(
    (kind: WaterPlayChildKind, row: WaterPlayChildPoint, idx: number) => {
      setMovingChild({ kind, idx });
      flyToWaterPlayChildGeom(
        mapContext?.mapInstanceRef?.current ?? null,
        row.geomJson,
        () => mapContext?.applyMapViewPaddingRef?.current?.()
      );
      window.setTimeout(() => setMovingChild(null), 600);
    },
    [mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef]
  );

  const showBody = isCreateMode || (!loading && !error && item != null);
  const showLoading = !isCreateMode && loading && !item;
  const rowRecord = (item ?? {}) as unknown as Record<string, unknown>;

  const renderFieldInput = (field: DefineFieldLike, isLast: boolean) => {
    const fieldName = String(field.define_field_name ?? '');
    const label = getDefineFieldDisplayLabel(fieldName, field.define_field_kor_name);
    const fieldType = String(field.define_field_type ?? '').toUpperCase();

    if (fieldName === 'addr') {
      return (
        <DetailAttrRow key={fieldName} label={label} isLast={isLast} {...DETAIL_ATTR_ROW_COMMON}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <AddressSearchPanel
                layout="field"
                includePlace
                vworldApiKey={vworldApiKey}
                initialQuery={form.addr ?? ''}
                placeholder="주소/지번/장소 검색"
                onSelect={(selected) => {
                  const adr =
                    (selected.roadAddress ?? '').trim() ||
                    (selected.jibunAddress ?? '').trim() ||
                    (selected.title ?? '').trim() ||
                    (selected.address ?? '').trim();
                  const placeTitle = (selected.title ?? '').trim();
                  const pickLon = Number(selected.point?.x);
                  const pickLat = Number(selected.point?.y);
                  const { addr, sido, sgg } = parseSidoSggFromAddress(adr);
                  setForm((prev) => {
                    const next: Record<string, string> = { ...prev, addr, sido, sgg };
                    // 장소(searchPlace) title — 상세주소(시설명 역할) 비어 있을 때만 자동입력
                    if (placeTitle && !(prev.addr_detail ?? '').trim()) {
                      next.addr_detail = placeTitle;
                    }
                    return next;
                  });
                  if (Number.isFinite(pickLon) && Number.isFinite(pickLat)) {
                    setLon(pickLon);
                    setLat(pickLat);
                  }
                }}
                onClear={() => {
                  applyAddressToForm('');
                  setLon(null);
                  setLat(null);
                }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              title={pickMode ? '위치 지정 취소' : '지도에서 위치 찍기'}
              aria-label={pickMode ? '위치 지정 취소' : '지도에서 위치 찍기'}
              onClick={pickMode ? stopAllPick : startParentPick}
              className={cn(
                'h-8 w-8 shrink-0 p-0',
                pickMode
                  ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-50'
                  : 'border-border bg-background text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary'
              )}
            >
              {pickMode ? <X className="h-3.5 w-3.5" /> : <Crosshair className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {pickMode && !childPickKind ? (
            <p className="mt-1 text-[11px] text-muted-foreground">지도를 클릭해 위치를 지정하세요.</p>
          ) : null}
        </DetailAttrRow>
      );
    }

    if (fieldName === 'remark') {
      return (
        <DetailAttrRow key={fieldName} label={label} isLast={isLast} {...DETAIL_ATTR_ROW_COMMON}>
          <textarea
            value={form.remark ?? ''}
            onChange={(e) => updateForm('remark', e.target.value)}
            rows={3}
            className={FIELD_TEXTAREA_CLASS}
            placeholder="-"
          />
        </DetailAttrRow>
      );
    }

    if (fieldType === 'NUMBER') {
      return (
        <DetailAttrRow key={fieldName} label={label} isLast={isLast} {...DETAIL_ATTR_ROW_COMMON}>
          <input
            type="text"
            inputMode="numeric"
            value={form[fieldName] ?? ''}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d]/g, '');
              updateForm(fieldName, v);
            }}
            onBlur={() => {
              const n = parseNumberInput(form[fieldName] ?? '');
              if (n != null) updateForm(fieldName, String(n));
              else updateForm(fieldName, '');
            }}
            className={FIELD_INPUT_CLASS}
            placeholder="-"
          />
        </DetailAttrRow>
      );
    }

    if (isDefineFieldCodeType(fieldType)) {
      const codes = codesByField[fieldName.toLowerCase()] ?? [];
      return (
        <DetailAttrRow key={fieldName} label={label} isLast={isLast} {...DETAIL_ATTR_ROW_COMMON}>
          <select
            value={form[fieldName] ?? ''}
            onChange={(e) => updateForm(fieldName, e.target.value)}
            title={label}
            className={cn(
              FIELD_INPUT_CLASS,
              'cursor-pointer scheme-light dark:scheme-dark'
            )}
          >
            <option value="">선택</option>
            {codes.map((c) => {
              const value = String(c.define_code_name ?? '').trim();
              const optLabel = String(c.define_code_kor_name ?? c.define_code_name ?? '').trim();
              if (!value) return null;
              return (
                <option key={value} value={value}>
                  {optLabel || value}
                </option>
              );
            })}
          </select>
        </DetailAttrRow>
      );
    }

    return (
      <DetailAttrRow key={fieldName} label={label} isLast={isLast} {...DETAIL_ATTR_ROW_COMMON}>
        <input
          type="text"
          value={form[fieldName] ?? ''}
          onChange={(e) => updateForm(fieldName, e.target.value)}
          className={FIELD_INPUT_CLASS}
          placeholder="-"
        />
      </DetailAttrRow>
    );
  };

  const footerProps = {
    isEditing,
    isCreateMode,
    saving,
    deleting,
    onEdit: handleEdit,
    onSave: handleSave,
    onCancel: handleCancelEdit,
    onDelete: isCreateMode ? undefined : () => void handleDelete(),
    editable: showBody && !showLoading && !fieldsLoading,
  };

  return (
    <div className="standard-panel-root flex min-h-0 h-full flex-col">
      <div className="standard-panel-header shrink-0">
        <span className="standard-panel-title truncate" title={headerTitle}>
          {headerTitle}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="standard-panel-close"
          title="닫기"
          aria-label="닫기"
          disabled={saving || deleting}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col py-2 text-xs',
          !isCreateMode && item ? 'overflow-hidden' : 'overflow-auto scrollbar-thin'
        )}
      >
        {showLoading || fieldsLoading ? (
          <div className="flex items-center gap-2 px-3 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            불러오는 중…
          </div>
        ) : null}

        {!isCreateMode && !loading && error && !item ? (
          <div className="mx-3 rounded border border-destructive/20 bg-destructive/10 px-2 py-2 text-destructive">
            {error}
          </div>
        ) : null}

        {showBody ? (
          <section className="standard-detail-section shrink-0">
            <div className="standard-detail-section-header">
              <button
                type="button"
                className="standard-detail-section-toggle"
                onClick={() => setAttrsOpen((v) => !v)}
                title={attrsOpen ? `${ATTRS_SECTION_TITLE} 접기` : `${ATTRS_SECTION_TITLE} 펼치기`}
                aria-expanded={attrsOpen}
              >
                {attrsOpen ? (
                  <ChevronDown className="standard-detail-section-chevron" />
                ) : (
                  <ChevronRight className="standard-detail-section-chevron" />
                )}
                <span className="standard-detail-section-toggle-label">{ATTRS_SECTION_TITLE}</span>
              </button>
            </div>
            {attrsOpen ? (
              <div className="standard-detail-section-body">
                <DetailAttrTable
                  empty={detailFields.length === 0 ? '표시할 속성이 없습니다.' : null}
                >
                  {detailFields.map((field, idx) => {
                    const fieldName = String(field.define_field_name ?? '');
                    const label = getDefineFieldDisplayLabel(
                      fieldName,
                      field.define_field_kor_name
                    );
                    const isLast = idx === detailFields.length - 1;

                    if (isEditing) {
                      return renderFieldInput(field, isLast);
                    }

                    const raw = getRowValueByDefineField(rowRecord, fieldName);
                    let display = formatDefineFieldDisplayValue(
                      raw,
                      field.define_field_type,
                      codesByField[fieldName.toLowerCase()]
                    );
                    if (fieldName === 'addr') {
                      display = formatWaterPlaySignAddressDisplay(display || raw, addressPrefixes);
                    }
                    return (
                      <DetailAttrRow key={fieldName} label={label} isLast={isLast} {...DETAIL_ATTR_ROW_COMMON}>
                        {display || '—'}
                      </DetailAttrRow>
                    );
                  })}
                </DetailAttrTable>
              </div>
            ) : null}
          </section>
        ) : null}

        {!isCreateMode && item ? (
          <section className="standard-detail-section shrink-0">
            <WaterPlayChildPointList
              title="구조함"
              items={boxItems}
              isEditing={isEditing}
              adding={childPickKind === 'box'}
              movingIdx={movingChild?.kind === 'box' ? movingChild.idx : null}
              onAdd={() => startChildPick('box')}
              onRemove={(row) => void handleRemoveChild('box', row)}
              onItemClick={(row, idx) => handleChildClick('box', row, idx)}
            />
            <WaterPlayChildPointList
              title="표지판"
              items={signItems}
              isEditing={isEditing}
              adding={childPickKind === 'sign'}
              movingIdx={movingChild?.kind === 'sign' ? movingChild.idx : null}
              onAdd={() => startChildPick('sign')}
              onRemove={(row) => void handleRemoveChild('sign', row)}
              onItemClick={(row, idx) => handleChildClick('sign', row, idx)}
            />
          </section>
        ) : null}

        {!isCreateMode && item ? (
          <SafetyFacHistorySection
            hisGubun={WATER_PLAY_SIGN_GEO_TABLE}
            ftrIdn={String(item.id)}
          />
        ) : null}

        {error && (isEditing || (item && !loading)) ? (
          <div className="mx-3 mt-2 rounded border border-destructive/20 bg-destructive/10 px-2 py-2 text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      <LayerRowEditFooter {...footerProps} />
    </div>
  );
}
