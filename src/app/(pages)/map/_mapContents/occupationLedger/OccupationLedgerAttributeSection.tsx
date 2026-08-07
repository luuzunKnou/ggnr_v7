'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LayerRowDetailAttr } from '../../_mapComponents/layerRowEdit';
import { toDateInputValue } from '@/lib/usageDataAsFieldUtils';
import {
  OCCUPATION_PERIOD_STATE_OPTIONS,
} from '@/lib/occupationLedgerPeriodState';
import { OccupationLedgerPlaceInput } from './OccupationLedgerPlaceInput';

const inputClass =
  'rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30';
const readonlyInputClass =
  'cursor-default rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 outline-none';

const DATE_FIELD_SET = new Set(['perm_start_date', 'perm_end_date', 'permit_date']);
const PLACE_FIELD = 'occup_place';
const STATE_FIELD = 'state';

type Props = {
  attributes: LayerRowDetailAttr[];
  isEditing: boolean;
  draft: Record<string, string>;
  readOnlyFields: Set<string>;
  dateFields: Set<string>;
  onDraftChange: (field: string, value: string) => void;
  vworldApiKey?: string;
  resetKey?: string;
};

/** 점용대장 상세 전용 속성 섹션 (상태 select · 점용장소 주소검색) */
export function OccupationLedgerAttributeSection({
  attributes,
  isEditing,
  draft,
  readOnlyFields,
  dateFields,
  onDraftChange,
  vworldApiKey = '',
  resetKey,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [resetKey]);

  useEffect(() => {
    if (isEditing) setExpanded(true);
  }, [isEditing]);

  const { primaryAttributes, hiddenAttributes } = useMemo(() => {
    const primary: LayerRowDetailAttr[] = [];
    const hidden: LayerRowDetailAttr[] = [];
    for (const row of attributes) {
      if (row.showDetail === false) hidden.push(row);
      else primary.push(row);
    }
    return { primaryAttributes: primary, hiddenAttributes: hidden };
  }, [attributes]);

  const visibleAttributes = expanded
    ? [...primaryAttributes, ...hiddenAttributes]
    : primaryAttributes;
  const hiddenCount = hiddenAttributes.length;

  const resolveDraftValue = (field: string): string => {
    if (field in draft) return draft[field] ?? '';
    const key = Object.keys(draft).find((k) => k.toLowerCase() === field.toLowerCase());
    return key ? (draft[key] ?? '') : '';
  };

  return (
    <>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        상세 속성
      </div>
      <dl className="divide-y divide-slate-100 rounded border border-slate-200 bg-slate-50/50">
        {visibleAttributes.length === 0 ? (
          <div className="px-2 py-3 text-slate-500">표시할 속성이 없습니다.</div>
        ) : (
          visibleAttributes.map((row) => {
            const fieldLower = row.field.toLowerCase();
            const locked = readOnlyFields.has(fieldLower);
            const showInput = isEditing && !locked;
            const showReadonlyInput = isEditing && locked;
            const inputValue = draft[row.field] ?? '';
            const readonlyValue =
              resolveDraftValue(row.field) ||
              (row.value && row.value !== '—' ? row.value : '');
            const isDate = dateFields.has(fieldLower) || DATE_FIELD_SET.has(fieldLower);
            const isPlace = fieldLower === PLACE_FIELD;
            const isState = fieldLower === STATE_FIELD;

            return (
              <div
                key={row.field}
                className="grid grid-cols-detail-30 gap-x-2 gap-y-0.5 px-2 py-1.5"
              >
                <dt className="shrink-0 font-medium text-slate-600">{row.label}</dt>
                <dd className="relative min-w-0 break-words text-slate-800">
                  {showInput ? (
                    isPlace ? (
                      <OccupationLedgerPlaceInput
                        key={`${resetKey ?? ''}:place`}
                        value={inputValue}
                        onChange={(v) => onDraftChange(row.field, v)}
                        vworldApiKey={vworldApiKey}
                      />
                    ) : isState ? (
                      <select
                        value={
                          OCCUPATION_PERIOD_STATE_OPTIONS.some((opt) => opt.value === inputValue)
                            ? inputValue
                            : OCCUPATION_PERIOD_STATE_OPTIONS[0].value
                        }
                        onChange={(e) => onDraftChange(row.field, e.target.value)}
                        className={`w-full ${inputClass}`}
                      >
                        {OCCUPATION_PERIOD_STATE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : isDate ? (
                      <input
                        type="date"
                        value={toDateInputValue(inputValue)}
                        onChange={(e) => onDraftChange(row.field, e.target.value)}
                        className={`w-full ${inputClass}`}
                      />
                    ) : (
                      <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => onDraftChange(row.field, e.target.value)}
                        className={`w-full ${inputClass}`}
                      />
                    )
                  ) : showReadonlyInput ? (
                    <input
                      type="text"
                      readOnly
                      value={readonlyValue}
                      placeholder="불러오는 중…"
                      className={`w-full ${readonlyInputClass}`}
                      aria-readonly="true"
                    />
                  ) : (
                    row.value
                  )}
                </dd>
              </div>
            );
          })
        )}
      </dl>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 w-full rounded border border-slate-200 bg-white py-1.5 text-[11px] font-medium text-primary hover:bg-slate-50"
        >
          {expanded ? '접기' : `더보기 (${hiddenCount}건)`}
        </button>
      ) : null}
    </>
  );
}
