'use client';

import { useMemo, useState } from 'react';
import { type LayerRowDetailAttr } from '../../_mapComponents/layerRowEdit';
import {
  formatAreaDisplay,
  sanitizeNumericInput,
  toDateInputValue,
} from '@/lib/usageDataAsFieldUtils';
import { OCCUPATION_PERIOD_STATE_OPTIONS } from '@/lib/occupationLedgerPeriodState';
import type { OccupationLedgerFieldMap } from '@/lib/occupationLedgerBinding';
import { RoadRewardAttrTable, type RoadRewardAttrEntry } from '../road/roadReward/RoadRewardAttrTable';
import { OccupationLedgerPlaceInput } from './OccupationLedgerPlaceInput';
import { isOccupationLedgerAttrFullWidth } from './occupationLedgerAttrLayout';

/** 보상편입용지 속성정보와 같은 입력칸(행 h-7 안에 맞춤) */
const fieldClass =
  'box-border h-[22px] w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] leading-none outline-none focus:border-primary focus:ring-1 focus:ring-primary/25';
const readonlyFieldClass =
  'box-border h-[22px] w-full min-w-0 cursor-default rounded border border-border bg-muted px-1.5 text-[11px] leading-none text-foreground/90 outline-none';
const btnAutoCalc =
  'inline-flex h-[22px] shrink-0 items-center rounded border border-primary bg-primary px-1.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50';

type Props = {
  attributes: LayerRowDetailAttr[];
  /** 점용대장 칸 이름 (하천·도로 공통 칸 / 국공유지 기존 칸) */
  fields: OccupationLedgerFieldMap;
  isEditing: boolean;
  draft: Record<string, string>;
  readOnlyFields: Set<string>;
  dateFields: Set<string>;
  onDraftChange: (field: string, value: string) => void;
  vworldApiKey?: string;
  resetKey?: string;
  /** 점용면적 — 본표 도형 면적 자동계산. 실패 시 안내 문구 반환 */
  onAutoCalcArea?: (field: string) => string | null | void;
};

function lower(v: string | undefined): string {
  return String(v ?? '').trim().toLowerCase();
}

/** 점용대장 속성정보 — 보상편입용지와 같은 2칸 표 (장문·점용장소·면적 편집은 한 줄) */
export function OccupationLedgerAttributeSection({
  attributes,
  fields,
  isEditing,
  draft,
  readOnlyFields,
  dateFields,
  onDraftChange,
  vworldApiKey = '',
  resetKey,
  onAutoCalcArea,
}: Props) {
  const [areaHint, setAreaHint] = useState<string | null>(null);

  const visibleAttributes = useMemo(
    () =>
      attributes.filter(
        (row) => row.showDetail !== false && row.field.toLowerCase() !== 'geom'
      ),
    [attributes]
  );

  const roles = useMemo(
    () => ({
      place: lower(fields.placeField),
      state: lower(fields.stateField),
      area: lower(fields.areaField),
      start: lower(fields.startField),
      end: lower(fields.endField),
    }),
    [fields]
  );

  const resolveDraftValue = (field: string): string => {
    if (field in draft) return draft[field] ?? '';
    const key = Object.keys(draft).find((k) => k.toLowerCase() === field.toLowerCase());
    return key ? (draft[key] ?? '') : '';
  };

  const renderInput = (row: LayerRowDetailAttr, fieldLower: string) => {
    const inputValue = draft[row.field] ?? '';
    if (roles.place && fieldLower === roles.place) {
      return (
        <OccupationLedgerPlaceInput
          key={`${resetKey ?? ''}:place`}
          value={resolveDraftValue(row.field) || inputValue}
          onChange={(v) => onDraftChange(row.field, v)}
          vworldApiKey={vworldApiKey}
        />
      );
    }
    if (fieldLower === roles.state) {
      return (
        <select
          value={
            OCCUPATION_PERIOD_STATE_OPTIONS.some((opt) => opt.value === inputValue)
              ? inputValue
              : OCCUPATION_PERIOD_STATE_OPTIONS[0].value
          }
          onChange={(e) => onDraftChange(row.field, e.target.value)}
          className={fieldClass}
        >
          {OCCUPATION_PERIOD_STATE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }
    if (roles.area && fieldLower === roles.area) {
      return (
        <div className="flex min-w-0 items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            value={sanitizeNumericInput(inputValue)}
            onChange={(e) => {
              setAreaHint(null);
              onDraftChange(row.field, sanitizeNumericInput(e.target.value));
            }}
            className={`${fieldClass} flex-1`}
            placeholder="0"
            title={areaHint ?? undefined}
          />
          <span className="shrink-0 text-[11px] text-muted-foreground">m²</span>
          {onAutoCalcArea ? (
            <button
              type="button"
              title={areaHint ?? '본표 도형 면적으로 채우기'}
              onClick={() => {
                const msg = onAutoCalcArea(row.field);
                setAreaHint(typeof msg === 'string' && msg ? msg : null);
                if (typeof msg === 'string' && msg) window.alert(msg);
              }}
              className={btnAutoCalc}
            >
              자동계산
            </button>
          ) : null}
        </div>
      );
    }
    // 점용 시작일·종료일은 글자도 받으므로 날짜 선택을 쓰지 않는다
    const isStart = Boolean(roles.start) && fieldLower === roles.start;
    const isEnd = Boolean(roles.end) && fieldLower === roles.end;
    if (!isStart && !isEnd && dateFields.has(fieldLower)) {
      return (
        <input
          type="date"
          value={toDateInputValue(inputValue)}
          onChange={(e) => onDraftChange(row.field, e.target.value)}
          className={fieldClass}
        />
      );
    }
    return (
      <input
        type="text"
        value={inputValue}
        onChange={(e) => onDraftChange(row.field, e.target.value)}
        className={fieldClass}
      />
    );
  };

  const entries: RoadRewardAttrEntry[] = visibleAttributes.map((row) => {
    const fieldLower = row.field.toLowerCase();
    const locked = readOnlyFields.has(fieldLower);
    let value: RoadRewardAttrEntry['value'];
    if (isEditing && !locked) {
      value = renderInput(row, fieldLower);
    } else if (isEditing) {
      value = (
        <input
          type="text"
          readOnly
          value={resolveDraftValue(row.field) || (row.value && row.value !== '—' ? row.value : '')}
          className={readonlyFieldClass}
          aria-readonly="true"
        />
      );
    } else if (roles.area && fieldLower === roles.area) {
      value = formatAreaDisplay(row.value === '—' ? '' : row.value) || '—';
    } else {
      value = String(row.value ?? '').trim() || '—';
    }
    const displayForLayout =
      typeof value === 'string'
        ? value
        : isEditing
          ? resolveDraftValue(row.field) || String(row.value ?? '').trim()
          : String(row.value ?? '').trim() || '—';

    return {
      fieldKey: row.field,
      label: row.label,
      value,
      fullWidth: isOccupationLedgerAttrFullWidth(fieldLower, fields, displayForLayout, {
        areaEditing: isEditing && Boolean(roles.area && fieldLower === roles.area),
      }),
      required: Boolean(isEditing && row.required),
    };
  });

  return <RoadRewardAttrTable entries={entries} stringValueMaxLines={2} />;
}
