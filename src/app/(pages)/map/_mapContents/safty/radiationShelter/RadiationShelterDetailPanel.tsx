'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Crosshair,
  Loader2,
  X,
} from 'lucide-react';
import { call } from '@/lib/api';
import { formatDefineFieldDisplayValue } from '@/lib/defineLayerCodeDisplay';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import type { RadiationShelterListItem } from '@/service/radiationShelterService';
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
import { AddressSearchPanel } from '../../../_mapComponents/addressSearch/AddressSearchPanel';
import { useMapPointPick } from '../../../_mapComponents/addressSearch/useMapPointPick';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { RADIATION_SHELTER_GEO_TABLE } from '../../../_mapComponents/layerFactory/safetydataMapLayerFactory';
import { formatRadiationShelterAddressDisplay } from './radiationShelterAddressDisplay';
import {
  flyToRadiationShelterLonLat,
  flyToRadiationShelterRow,
} from './radiationShelterMapFly';
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

/** 이력 테이블 thead·재난대응시설 속성 라벨과 동일 */
const RADIATION_SHELTER_ATTR_LABEL_CLASS =
  'bg-slate-100 font-semibold text-slate-500 dark:bg-muted dark:text-muted-foreground';

const DETAIL_ATTR_ROW_COMMON = {
  labelClassName: RADIATION_SHELTER_ATTR_LABEL_CLASS,
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

function formFromItem(item: RadiationShelterListItem): Record<string, string> {
  const fmt = (v: string) => (v && v !== '-' ? v : '');
  const actc =
    item.actcTnop != null && Number.isFinite(item.actcTnop) ? String(item.actcTnop) : '';
  return {
    ftn_nm: fmt(item.ftnNm),
    addr: fmt(item.addr),
    actc_tnop: actc,
    remark: fmt(item.remark),
  };
}

function lonLatFromGeomJson(geomJson: unknown): { lon: number | null; lat: number | null } {
  if (!geomJson || typeof geomJson !== 'object' || !('coordinates' in geomJson)) {
    return { lon: null, lat: null };
  }
  const coords = (geomJson as { coordinates?: number[] }).coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return { lon: null, lat: null };
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  return {
    lon: Number.isFinite(lon) ? lon : null,
    lat: Number.isFinite(lat) ? lat : null,
  };
}

function parseNumberInput(raw: string): number | null {
  const s = String(raw ?? '').replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function RadiationShelterDetailPanel({
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
    useSafetyLayerDetailColumns('radiation_shelter');
  const addressPrefixes = usePublicLayerAddressPrefixes();

  const [loading, setLoading] = useState(!isCreateMode);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<RadiationShelterListItem | null>(null);
  const [attrsOpen, setAttrsOpen] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [lon, setLon] = useState<number | null>(null);
  const [lat, setLat] = useState<number | null>(null);

  const isEditing = isCreateMode || editMode;

  const { pickMode, startPick, stopPick, clearDraftPoint } = useMapPointPick({
    vworldApiKey,
    onPicked: ({ lon: pickedLon, lat: pickedLat, address }) => {
      setLon(pickedLon);
      setLat(pickedLat);
      setForm((prev) => ({
        ...prev,
        addr: address || prev.addr || '',
      }));
    },
  });

  const resetEditForm = useCallback(
    (row: RadiationShelterListItem | null) => {
      if (!row) return;
      setForm(formFromItem(row));
      const { lon: l, lat: la } = lonLatFromGeomJson(row.geomJson);
      setLon(l);
      setLat(la);
    },
    []
  );

  const loadDetail = useCallback(async () => {
    if (isCreateMode) return;
    setLoading(true);
    setError(null);
    setItem(null);
    try {
      const res = await call('', 'POST', {
        service: 'radiationShelterService',
        action: 'get',
        params: { id: detailId },
      });
      const data = res?.data ?? res;
      const row = (data?.item ?? null) as RadiationShelterListItem | null;
      if (!row) {
        setError('항목을 찾을 수 없습니다.');
        return;
      }
      setItem(row);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [detailId, isCreateMode]);

  useEffect(() => {
    if (isCreateMode) {
      setItem(null);
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

  const headerTitle = useMemo(() => {
    if (isEditing) {
      const name = (form.ftn_nm ?? '').trim();
      if (name) return name;
      return isCreateMode ? '등록' : '—';
    }
    if (item) {
      const name = item.ftnNm && item.ftnNm !== '-' ? item.ftnNm : '';
      if (name) return name;
    }
    return '—';
  }, [isEditing, form.ftn_nm, isCreateMode, item]);

  const updateForm = useCallback((field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const buildSaveParams = useCallback(
    () => ({
      ftn_nm: form.ftn_nm ?? '',
      addr: form.addr ?? '',
      actc_tnop: parseNumberInput(form.actc_tnop ?? ''),
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
        service: 'radiationShelterService',
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
      clearDraftPoint();
      stopPick();
      const map = mapContext?.mapInstanceRef?.current ?? null;
      const applyPad = () => mapContext?.applyMapViewPaddingRef?.current?.();
      const savedItem = (data?.item ?? null) as RadiationShelterListItem | null;
      if (savedItem) {
        flyToRadiationShelterRow(map, savedItem, applyPad);
      } else {
        flyToRadiationShelterLonLat(map, lon, lat, applyPad);
      }
      onListRefresh?.();
      onCreated?.(newId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [buildSaveParams, clearDraftPoint, lat, lon, mapContext?.mapInstanceRef, onCreated, onListRefresh, stopPick]);

  const handleUpdate = useCallback(async () => {
    if (isCreateMode || !item) return;
    setSaving(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'radiationShelterService',
        action: 'update',
        params: { id: item.id, ...buildSaveParams() },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.ok === false) {
        setError(String(data?.error ?? '저장에 실패했습니다.'));
        return;
      }
      clearDraftPoint();
      stopPick();
      setEditMode(false);
      const map = mapContext?.mapInstanceRef?.current ?? null;
      const applyPad = () => mapContext?.applyMapViewPaddingRef?.current?.();
      const savedItem = (data?.item ?? null) as RadiationShelterListItem | null;
      if (savedItem) {
        flyToRadiationShelterRow(map, savedItem, applyPad);
      } else {
        flyToRadiationShelterLonLat(map, lon, lat, applyPad);
      }
      onListRefresh?.();
      await loadDetail();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [buildSaveParams, clearDraftPoint, isCreateMode, item, lat, loadDetail, lon, mapContext?.mapInstanceRef, onListRefresh, stopPick]);

  const handleDelete = useCallback(async () => {
    if (isCreateMode || !item) return;
    if (!window.confirm('이 방사선 대피소를 삭제하시겠습니까?')) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'radiationShelterService',
        action: 'remove',
        params: { id: item.id },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.ok === false) {
        setError(String(data?.error ?? '삭제에 실패했습니다.'));
        return;
      }
      clearDraftPoint();
      stopPick();
      onListRefresh?.();
      onDeleted?.();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }, [clearDraftPoint, isCreateMode, item, onClose, onDeleted, onListRefresh, stopPick]);

  const handleEdit = useCallback(() => {
    if (!item) return;
    resetEditForm(item);
    setEditMode(true);
    setError(null);
  }, [item, resetEditForm]);

  const handleCancelEdit = useCallback(() => {
    if (isCreateMode) {
      clearDraftPoint();
      stopPick();
      onClose();
      return;
    }
    clearDraftPoint();
    stopPick();
    setEditMode(false);
    setError(null);
    if (item) resetEditForm(item);
  }, [clearDraftPoint, isCreateMode, item, onClose, resetEditForm, stopPick]);

  const handleSave = useCallback(() => {
    if (isCreateMode) void handleCreate();
    else void handleUpdate();
  }, [handleCreate, handleUpdate, isCreateMode]);

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
                  const pickLon = Number(selected.point?.x);
                  const pickLat = Number(selected.point?.y);
                  updateForm('addr', adr);
                  if (Number.isFinite(pickLon) && Number.isFinite(pickLat)) {
                    setLon(pickLon);
                    setLat(pickLat);
                  }
                }}
                onClear={() => {
                  updateForm('addr', '');
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
              onClick={pickMode ? stopPick : startPick}
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
          {pickMode ? (
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
                      undefined
                    );
                    if (fieldName === 'addr') {
                      display = formatRadiationShelterAddressDisplay(display || raw, addressPrefixes);
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
          <SafetyFacHistorySection
            hisGubun={RADIATION_SHELTER_GEO_TABLE}
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
