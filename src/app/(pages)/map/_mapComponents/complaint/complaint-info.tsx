'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompUI } from './types';
import {
  Calendar,
  MapPin,
  Phone,
  User,
  Users,
  Building2,
  FileText,
  Check,
  X,
  Crosshair,
  Hash,
  Type,
} from 'lucide-react';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Button } from '@/app/shadcnComponents/ui/button';
import { useMapContext } from '../MapContext';
import { AddressSearchPanel } from '../addressSearch/AddressSearchPanel';
import { useMapPointPick } from '../addressSearch/useMapPointPick';
import { cn } from '@/lib/utils';
import { isDefineFieldCodeType } from '@/lib/defineLayerCodeDisplay';
import {
  getDefineFieldDisplayLabel,
  isDefineFieldFlagTrue,
  type DefineFieldLike,
} from '../standard/defineLayerRowUtils';
import { useDefineLayerCodesByFieldNames } from '../standard/useDefineLayerCodes';

export type ComplaintFormValues = {
  compName: string;
  compTel: string;
  compDate: string;
  compCg: string;
  compCt: string;
  compCu: string;
  compAdr: string;
  compContent: string;
  /** 주소검색 선택 시 EPSG:4326 — 저장 시 geom 반영 */
  lon?: number | null;
  lat?: number | null;
};

/** 테이블 Field 기반 저장 값 */
export type ComplaintDefineFieldSave = {
  values: Record<string, string>;
  lon?: number | null;
  lat?: number | null;
};

interface ComplaintInfoProps {
  complaint: CompUI;
  onSave?: (values: ComplaintFormValues) => void | Promise<void>;
  /** 있으면 고정 폼 대신 테이블 Field 표시 항목으로 렌더 */
  defineFields?: DefineFieldLike[];
  defineFieldValues?: Record<string, string>;
  tableName?: string;
  onSaveDefineFields?: (payload: ComplaintDefineFieldSave) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onClose?: () => void;
  saving?: boolean;
  deleting?: boolean;
  /** 신규 등록 — 데이터설정(Field) 기본값 적용 */
  isAdd?: boolean;
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function toFormValues(c: CompUI): ComplaintFormValues {
  return {
    compName: c.compName ?? '',
    compTel: c.compTel ?? '',
    compDate: c.compDate ? c.compDate.slice(0, 10) : c.compKey === 0 ? todayStr() : '',
    compCg: c.compCg ?? '',
    compCt: c.compCt ?? '',
    compCu: c.compCu ?? '',
    compAdr: c.compAdr ?? '',
    compContent: c.compContent ?? '',
    lon: null,
    lat: null,
  };
}

function isAddressFieldName(name: string, label = ''): boolean {
  if (/adr|addr|address|jibun/i.test(name)) return true;
  if (/지번|도로명|주소/.test(label)) return true;
  return false;
}

function isRoadAddressField(name: string, label = ''): boolean {
  return /adr_road|road_adr|road_addr|도로명/i.test(name) || /도로명/.test(label);
}

function isJibunAddressField(name: string, label = ''): boolean {
  if (isRoadAddressField(name, label)) return false;
  return /jibun|지번/i.test(name) || /지번/.test(label) || /adr|addr|address/i.test(name);
}

function addressTextForField(
  name: string,
  label: string,
  item: { roadAddress?: string | null; jibunAddress?: string | null; title?: string | null; address?: string | null }
): string {
  const road = (item.roadAddress ?? '').trim();
  const jibun = (item.jibunAddress ?? '').trim();
  const fallback =
    (item.title ?? '').trim() || (item.address ?? '').trim() || road || jibun;
  if (isRoadAddressField(name, label)) return road || fallback;
  if (isJibunAddressField(name, label)) return jibun || fallback;
  return road || jibun || fallback;
}

function isContentField(name: string, label: string): boolean {
  return /content|contents|remark|memo|비고|내용/i.test(name) || /내용|비고/.test(label);
}

function isReadOnlyField(
  field: DefineFieldLike & { define_field_read_only?: unknown; define_field_is_key?: unknown }
): boolean {
  if (isDefineFieldFlagTrue(field.define_field_is_key)) return true;
  return isDefineFieldFlagTrue(field.define_field_read_only);
}

function fieldIcon(name: string, type: string, label = '') {
  if (isAddressFieldName(name, label)) return <MapPin className="h-3.5 w-3.5" />;
  if (type === 'DATE' || /date|일자|일/i.test(name)) return <Calendar className="h-3.5 w-3.5" />;
  if (/tel|phone|연락/i.test(name)) return <Phone className="h-3.5 w-3.5" />;
  if (/name|민원인|성명/i.test(name)) return <User className="h-3.5 w-3.5" />;
  if (/team|팀|ct/i.test(name)) return <Users className="h-3.5 w-3.5" />;
  if (/dept|부서|cg/i.test(name)) return <Building2 className="h-3.5 w-3.5" />;
  if (/content|내용|remark/i.test(name)) return <FileText className="h-3.5 w-3.5" />;
  if (/key|번호|no/i.test(name)) return <Hash className="h-3.5 w-3.5" />;
  return <Type className="h-3.5 w-3.5" />;
}

/** 데이터설정(Field) 최대길이 → input maxLength (숫자가 아니면 제한 없음) */
function fieldMaxLength(f: DefineFieldLike): number | undefined {
  const n = parseInt(String(f.define_field_max_length ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 신규 등록 초기값 — 데이터설정(Field) 기본값, 날짜는 today/now 지원·접수일은 오늘 */
function defaultValueForField(f: DefineFieldLike): string {
  const type = String(f.define_field_type ?? '').toUpperCase();
  const raw = String(f.define_field_default_value ?? '').trim();
  const name = String(f.define_field_name ?? '').trim();
  const label = getDefineFieldDisplayLabel(name, f.define_field_kor_name);
  if (type === 'DATE') {
    if (!raw) return /create_date|comp_date|접수일/i.test(`${name} ${label}`) ? todayStr() : '';
    if (/^(today|now|current_date|current_timestamp)/i.test(raw)) return todayStr();
  }
  return raw;
}

function emptyDefineValues(fields: DefineFieldLike[], applyDefaults = false): Record<string, string> {
  const next: Record<string, string> = {};
  for (const f of fields) {
    const name = String(f.define_field_name ?? '').trim();
    if (name) next[name] = applyDefaults ? defaultValueForField(f) : '';
  }
  return next;
}

function InfoItemWithInput({
  icon,
  label,
  value,
  onChange,
  readOnly,
  maxLength,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  maxLength?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">{icon}</span>
      <span className="w-14 shrink-0 truncate text-[12px] text-muted-foreground/90" title={label}>
        {label}
      </span>
      <Input
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly || !onChange}
        maxLength={maxLength}
        placeholder="-"
        style={{ fontSize: '12px' }}
        className="h-8 min-w-0 flex-1 border-border/80 bg-muted/30 placeholder:text-[12px]"
      />
    </div>
  );
}

function ActionButtons({
  onDelete,
  onSave,
  onClose,
  saving,
  deleting,
}: {
  onDelete?: () => void | Promise<void>;
  onSave?: () => void | Promise<void>;
  onClose?: () => void;
  saving: boolean;
  deleting: boolean;
}) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      {onDelete ? (
        <Button
          size="sm"
          variant="outline"
          title={deleting ? '삭제 중…' : '삭제'}
          onClick={onDelete}
          disabled={deleting}
          className="h-[26px] min-h-[26px] cursor-pointer gap-1 border border-border bg-muted/50 px-2.5 text-[12px] font-light text-muted-foreground hover:border-destructive hover:bg-destructive/15 hover:text-destructive disabled:cursor-not-allowed"
        >
          <X className="h-3 w-3" />
          {deleting ? '삭제 중…' : '삭제'}
        </Button>
      ) : null}
      {onSave ? (
        <Button
          size="sm"
          title={saving ? '저장 중…' : '저장'}
          onClick={() => void onSave()}
          disabled={saving}
          className="h-[26px] min-h-[26px] cursor-pointer gap-1 border border-border bg-muted/50 px-2.5 text-[12px] font-light text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary disabled:cursor-not-allowed"
        >
          <Check className="h-3 w-3" />
          {saving ? '저장 중…' : '저장'}
        </Button>
      ) : null}
      {onClose ? (
        <Button
          size="sm"
          variant="outline"
          title="닫기"
          onClick={onClose}
          className="h-[26px] min-h-[26px] cursor-pointer gap-1 border border-border bg-muted/50 px-2.5 text-[12px] font-light text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
        >
          <X className="h-3 w-3" />
          닫기
        </Button>
      ) : null}
    </div>
  );
}

function ComplaintDefineFieldForm({
  defineFields,
  defineFieldValues,
  tableName,
  onSaveDefineFields,
  onDelete,
  saving,
  deleting,
  isAdd,
}: {
  isAdd: boolean;
  defineFields: DefineFieldLike[];
  defineFieldValues?: Record<string, string>;
  tableName: string;
  onSaveDefineFields?: (payload: ComplaintDefineFieldSave) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  saving: boolean;
  deleting: boolean;
}) {
  const mapContext = useMapContext();
  const vworldApiKey = mapContext?.vworldApiKey ?? '';
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...emptyDefineValues(defineFields, isAdd),
    ...(defineFieldValues ?? {}),
  }));
  const [lon, setLon] = useState<number | null>(null);
  const [lat, setLat] = useState<number | null>(null);

  const codeFieldNames = useMemo(
    () =>
      defineFields
        .filter((f) => isDefineFieldCodeType(f.define_field_type))
        .map((f) => String(f.define_field_name ?? '').trim())
        .filter(Boolean),
    [defineFields]
  );
  const codesByField = useDefineLayerCodesByFieldNames(tableName, codeFieldNames);

  const addressFields = useMemo(() => {
    return defineFields
      .map((f) => {
        const name = String(f.define_field_name ?? '').trim();
        const label = getDefineFieldDisplayLabel(name, f.define_field_kor_name);
        if (!name || !isAddressFieldName(name, label)) return null;
        return { name, label };
      })
      .filter((v): v is { name: string; label: string } => v != null);
  }, [defineFields]);

  const addressFieldName = addressFields[0]?.name ?? null;

  const applyAddressToFields = useCallback(
    (item: {
      roadAddress?: string | null;
      jibunAddress?: string | null;
      title?: string | null;
      address?: string | null;
    }) => {
      if (addressFields.length === 0) return;
      setValues((prev) => {
        const next = { ...prev };
        for (const { name, label } of addressFields) {
          const text = addressTextForField(name, label, item);
          if (text) next[name] = text;
        }
        return next;
      });
    },
    [addressFields]
  );

  const { pickMode, startPick, stopPick, clearDraftPoint } = useMapPointPick({
    vworldApiKey,
    onPicked: ({ lon: pickLon, lat: pickLat, address }) => {
      setLon(pickLon);
      setLat(pickLat);
      if (!address) return;
      applyAddressToFields({
        address,
        jibunAddress: address,
        roadAddress: address,
      });
    },
  });

  useEffect(() => {
    setValues({
      ...emptyDefineValues(defineFields, isAdd),
      ...(defineFieldValues ?? {}),
    });
    setLon(null);
    setLat(null);
  }, [defineFieldValues, defineFields, isAdd]);

  const updateValue = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  /** 레이어설정 Field 순서(idx) 그대로. 주소·내용은 위젯만 바꾸고 위치는 유지 */
  const renderField = (
    field: DefineFieldLike & { define_field_read_only?: unknown; define_field_is_key?: unknown }
  ) => {
    const name = String(field.define_field_name ?? '').trim();
    if (!name) return null;
    const label = getDefineFieldDisplayLabel(name, field.define_field_kor_name);
    const type = String(field.define_field_type ?? '').toUpperCase();
    const readOnly = isReadOnlyField(field);
    const value = values[name] ?? '';
    const icon = fieldIcon(name, type, label);
    const isAddress = isAddressFieldName(name, label);
    const isContent = isContentField(name, label);

    if (isAddress) {
      return (
        <div key={name} className="flex items-start gap-2 sm:col-span-2">
          <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
            <MapPin className="h-3.5 w-3.5" />
          </span>
          <span
            className="flex h-8 w-14 shrink-0 items-center truncate text-[12px] text-muted-foreground/90"
            title={label}
          >
            {label}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <AddressSearchPanel
                  layout="field"
                  includePlace
                  vworldApiKey={vworldApiKey}
                  initialQuery={value}
                  placeholder={
                    isRoadAddressField(name, label)
                      ? '도로명/장소 검색'
                      : '주소/지번/장소 검색'
                  }
                  onSelect={(item) => {
                    const pickLon = Number(item.point?.x);
                    const pickLat = Number(item.point?.y);
                    applyAddressToFields(item);
                    setLon(Number.isFinite(pickLon) ? pickLon : null);
                    setLat(Number.isFinite(pickLat) ? pickLat : null);
                  }}
                  onClear={() => {
                    setValues((prev) => {
                      const next = { ...prev };
                      for (const f of addressFields) next[f.name] = '';
                      return next;
                    });
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
              <p className="mt-1 text-[11px] text-muted-foreground">
                지도를 클릭해 민원 위치를 지정하세요.
              </p>
            ) : null}
          </div>
        </div>
      );
    }

    if (isContent) {
      return (
        <div key={name} className="flex items-start gap-2 sm:col-span-2">
          <span className="flex h-5 shrink-0 items-center text-muted-foreground/80">
            <FileText className="h-3.5 w-3.5" />
          </span>
          <span
            className="flex h-5 w-14 shrink-0 items-center truncate text-[12px] text-muted-foreground/90"
            title={label}
          >
            {label}
          </span>
          <textarea
            value={value}
            readOnly={readOnly}
            onChange={(e) => updateValue(name, e.target.value)}
            placeholder="-"
            rows={6}
            maxLength={fieldMaxLength(field)}
            style={{ fontSize: '12px' }}
            className="min-h-[5.5rem] min-w-0 flex-1 resize-none rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-foreground/90 placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-0"
          />
        </div>
      );
    }

    if (type === 'DATE') {
      return (
        <div key={name} className="flex items-center gap-2">
          <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">{icon}</span>
          <span className="w-14 shrink-0 truncate text-[12px] text-muted-foreground/90" title={label}>
            {label}
          </span>
          <Input
            type="date"
            value={value.slice(0, 10)}
            readOnly={readOnly}
            onChange={(e) => updateValue(name, e.target.value)}
            style={{ fontSize: '12px' }}
            className="input-date-primary h-8 min-w-0 flex-1 border-border/80 bg-muted/30 accent-primary"
          />
        </div>
      );
    }

    if (isDefineFieldCodeType(type) || type.startsWith('SELECT')) {
      const codes = codesByField[name.toLowerCase()] ?? [];
      return (
        <div key={name} className="flex items-center gap-2">
          <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">{icon}</span>
          <span className="w-14 shrink-0 truncate text-[12px] text-muted-foreground/90" title={label}>
            {label}
          </span>
          <select
            value={value}
            disabled={readOnly}
            onChange={(e) => updateValue(name, e.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-border/80 bg-muted/30 px-2 text-[12px]"
          >
            <option value="">-</option>
            {codes.map((c) => {
              const code = String(c.define_code_name ?? '');
              const kor = String(c.define_code_kor_name ?? '').trim() || code;
              return (
                <option key={code} value={code}>
                  {kor}
                </option>
              );
            })}
          </select>
        </div>
      );
    }

    return (
      <InfoItemWithInput
        key={name}
        icon={icon}
        label={label}
        value={value}
        readOnly={readOnly}
        maxLength={fieldMaxLength(field)}
        onChange={readOnly ? undefined : (v) => updateValue(name, v)}
      />
    );
  };

  /** 기존 민원 입력창과 같은 배치: 담당부서·팀·담당자·접수일자 / 민원인·연락처 / (기타) / 주소 / 내용 */
  const sections = useMemo(() => {
    const top: Record<'dept' | 'team' | 'writer' | 'date', DefineFieldLike | null> = {
      dept: null,
      team: null,
      writer: null,
      date: null,
    };
    const contact: Record<'name' | 'tel', DefineFieldLike | null> = { name: null, tel: null };
    const others: DefineFieldLike[] = [];
    const addresses: DefineFieldLike[] = [];
    const contents: DefineFieldLike[] = [];

    for (const f of defineFields) {
      const name = String(f.define_field_name ?? '').trim();
      if (!name) continue;
      const label = getDefineFieldDisplayLabel(name, f.define_field_kor_name);
      const hay = `${name} ${label}`;
      if (isAddressFieldName(name, label)) {
        addresses.push(f);
      } else if (!contact.name && /req_name|민원인|신고자|성명/i.test(hay)) {
        contact.name = f;
      } else if (!contact.tel && /req_tel|연락처|전화/i.test(hay)) {
        contact.tel = f;
      } else if (!top.writer && /create_user|user_name|writer|담당자|접수자|접수직원/i.test(hay)) {
        top.writer = f;
      } else if (!top.date && /create_date|comp_date|접수일/i.test(hay)) {
        top.date = f;
      } else if (!top.team && /(^|_)team|팀|^comp_group\b/i.test(hay)) {
        top.team = f;
      } else if (!top.dept && /create_group|dept|부서/i.test(hay)) {
        top.dept = f;
      } else if (isContentField(name, label)) {
        contents.push(f);
      } else {
        others.push(f);
      }
    }

    const pick = (list: Array<DefineFieldLike | null>) =>
      list.filter((f): f is DefineFieldLike => f != null);
    return {
      top: pick([top.dept, top.team, top.writer, top.date]),
      contact: pick([contact.name, contact.tel]),
      others,
      addresses,
      contents,
    };
  }, [defineFields]);

  const gridClass = 'grid grid-cols-1 gap-y-3.5 sm:grid-cols-2 sm:gap-x-4';

  return (
    <div className="rounded-xl border border-border bg-card px-3 pb-[15px] pt-3">
      <div className="flex flex-col gap-3.5">
        {defineFields.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">레이어설정(Field)에 상세 표시 항목이 없습니다.</p>
        ) : (
          <>
            {sections.top.length > 0 ? (
              <div className={gridClass}>{sections.top.map((f) => renderField(f))}</div>
            ) : null}
            {sections.contact.length > 0 ? (
              <div className={gridClass}>{sections.contact.map((f) => renderField(f))}</div>
            ) : null}
            {sections.others.length > 0 ? (
              <div className={gridClass}>{sections.others.map((f) => renderField(f))}</div>
            ) : null}
            {sections.addresses.map((f) => renderField(f))}
            {sections.contents.map((f) => renderField(f))}
          </>
        )}
      </div>

      <ActionButtons
        onDelete={onDelete}
        saving={saving}
        deleting={deleting}
        onSave={
          onSaveDefineFields
            ? async () => {
                await onSaveDefineFields({ values, lon, lat });
                clearDraftPoint();
              }
            : undefined
        }
      />
    </div>
  );
}

export function ComplaintInfo({
  complaint,
  onSave,
  defineFields,
  defineFieldValues,
  tableName,
  onSaveDefineFields,
  onDelete,
  onClose,
  saving = false,
  deleting = false,
  isAdd = false,
}: ComplaintInfoProps) {
  const mapContext = useMapContext();
  const vworldApiKey = mapContext?.vworldApiKey ?? '';
  const [form, setForm] = useState<ComplaintFormValues>(() => toFormValues(complaint));

  const useDefine = Boolean(defineFields);

  const { pickMode, startPick, stopPick, clearDraftPoint } = useMapPointPick({
    vworldApiKey,
    onPicked: ({ lon, lat, address }) => {
      setForm((prev) => ({
        ...prev,
        compAdr: address || prev.compAdr,
        lon,
        lat,
      }));
    },
  });

  useEffect(() => {
    if (useDefine) return;
    setForm(toFormValues(complaint));
  }, [
    useDefine,
    complaint.compKey,
    complaint.compName,
    complaint.compTel,
    complaint.compDate,
    complaint.compCg,
    complaint.compCt,
    complaint.compCu,
    complaint.compAdr,
    complaint.compContent,
  ]);

  if (useDefine && defineFields) {
    return (
      <ComplaintDefineFieldForm
        isAdd={isAdd}
        defineFields={defineFields}
        defineFieldValues={defineFieldValues}
        tableName={tableName ?? ''}
        onSaveDefineFields={onSaveDefineFields}
        onDelete={onDelete}
        saving={saving}
        deleting={deleting}
      />
    );
  }

  const update = (field: keyof ComplaintFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="rounded-xl border border-border bg-card px-3 pb-[15px] pt-3">
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-1 gap-y-3.5 sm:grid-cols-2 sm:gap-x-4">
          <InfoItemWithInput
            icon={<Building2 className="h-3.5 w-3.5" />}
            label="담당부서"
            value={form.compCg}
            onChange={(v) => update('compCg', v)}
          />
          <InfoItemWithInput
            icon={<Users className="h-3.5 w-3.5" />}
            label="담당팀"
            value={form.compCt}
            onChange={(v) => update('compCt', v)}
          />
          <InfoItemWithInput
            icon={<User className="h-3.5 w-3.5" />}
            label="담당자"
            value={form.compCu}
            onChange={(v) => update('compCu', v)}
          />
          <div className="flex items-center gap-2">
            <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
              <Calendar className="h-3.5 w-3.5" />
            </span>
            <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">접수일자</span>
            <Input
              type="date"
              value={form.compDate}
              onChange={(e) => update('compDate', e.target.value)}
              style={{ fontSize: '12px' }}
              className="input-date-primary h-8 min-w-0 flex-1 border-border/80 bg-muted/30 accent-primary"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-y-3.5 sm:grid-cols-2 sm:gap-x-4">
          <InfoItemWithInput
            icon={<User className="h-3.5 w-3.5" />}
            label="민원인"
            value={form.compName}
            onChange={(v) => update('compName', v)}
          />
          <InfoItemWithInput
            icon={<Phone className="h-3.5 w-3.5" />}
            label="연락처"
            value={form.compTel}
            onChange={(v) => update('compTel', v)}
          />
        </div>
        <div className="flex items-start gap-2">
          <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
            <MapPin className="h-3.5 w-3.5" />
          </span>
          <span className="flex h-8 w-14 shrink-0 items-center text-[12px] text-muted-foreground/90">
            주소
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <AddressSearchPanel
                  layout="field"
                  includePlace
                  vworldApiKey={vworldApiKey}
                  initialQuery={form.compAdr}
                  placeholder="주소/지번/장소 검색"
                  onSelect={(item) => {
                    const adr =
                      (item.roadAddress ?? '').trim() ||
                      (item.jibunAddress ?? '').trim() ||
                      (item.title ?? '').trim() ||
                      (item.address ?? '').trim();
                    const lon = Number(item.point?.x);
                    const lat = Number(item.point?.y);
                    setForm((prev) => ({
                      ...prev,
                      compAdr: adr || prev.compAdr,
                      lon: Number.isFinite(lon) ? lon : null,
                      lat: Number.isFinite(lat) ? lat : null,
                    }));
                  }}
                  onClear={() =>
                    setForm((prev) => ({ ...prev, compAdr: '', lon: null, lat: null }))
                  }
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
              <p className="mt-1 text-[11px] text-muted-foreground">지도를 클릭해 민원 위치를 지정하세요.</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="flex h-5 shrink-0 items-center text-muted-foreground/80">
            <FileText className="h-3.5 w-3.5" />
          </span>
          <span className="flex h-5 w-14 shrink-0 items-center text-[12px] text-muted-foreground/90">
            내용
          </span>
          <textarea
            value={form.compContent}
            onChange={(e) => update('compContent', e.target.value)}
            placeholder="-"
            rows={6}
            style={{ fontSize: '12px' }}
            className="min-h-[5.5rem] min-w-0 flex-1 resize-none rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-foreground/90 placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-0"
          />
        </div>
      </div>

      <ActionButtons
        onDelete={onDelete}
        onClose={onClose}
        saving={saving}
        deleting={deleting}
        onSave={
          onSave
            ? async () => {
                await onSave(form);
                clearDraftPoint();
              }
            : undefined
        }
      />
    </div>
  );
}
