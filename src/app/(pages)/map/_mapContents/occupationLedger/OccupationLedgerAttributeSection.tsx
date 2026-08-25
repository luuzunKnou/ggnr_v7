'use client';

import { useMemo, useState } from 'react';
import type { LayerRowDetailAttr } from '../../_mapComponents/layerRowEdit';
import {
  formatAreaDisplay,
  sanitizeNumericInput,
  toDateInputValue,
} from '@/lib/usageDataAsFieldUtils';
import {
  OCCUPATION_PERIOD_STATE_OPTIONS,
} from '@/lib/occupationLedgerPeriodState';
import { OccupationLedgerPlaceInput } from './OccupationLedgerPlaceInput';

const AREA_FIELD = 'perm_area';

const inputClass =
  'rounded border border-border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30';
const readonlyInputClass =
  'cursor-default rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground/90 outline-none';
/** 도로망 유지보수 «추가»와 동일 primary 톤, 입력 높이보다 약간 낮게 */
const btnAutoCalc =
  'inline-flex h-6 shrink-0 items-center rounded border border-primary bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50';
const areaInputClass =
  'h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30';

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
  /** 점용면적 — 본표 도형 면적 자동계산. 실패 시 안내 문구 반환 */
  onAutoCalcArea?: (field: string) => string | null | void;
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
  onAutoCalcArea,
}: Props) {
  const [areaHint, setAreaHint] = useState<string | null>(null);

  const visibleAttributes = useMemo(
    () => attributes.filter((row) => row.showDetail !== false),
    [attributes]
  );

  const resolveDraftValue = (field: string): string => {
    if (field in draft) return draft[field] ?? '';
    const key = Object.keys(draft).find((k) => k.toLowerCase() === field.toLowerCase());
    return key ? (draft[key] ?? '') : '';
  };

  return (
    <>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        상세 속성
      </div>
      <dl className="divide-y divide-border rounded border border-border bg-muted/40">
        {visibleAttributes.length === 0 ? (
          <div className="px-2 py-3 text-muted-foreground">표시할 속성이 없습니다.</div>
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
            const isArea = fieldLower === AREA_FIELD;

            return (
              <div
                key={row.field}
                className="grid grid-cols-detail-30 items-center gap-x-2 gap-y-0.5 px-2 py-1.5"
              >
                <dt className="shrink-0 leading-none font-medium text-muted-foreground">
                  {row.label}
                  {isEditing && row.required ? (
                    <span className="ml-0.5 text-destructive" aria-hidden>
                      *
                    </span>
                  ) : null}
                </dt>
                <dd className="relative min-w-0 break-words text-foreground">
                  {showInput ? (
                    isPlace ? (
                      <OccupationLedgerPlaceInput
                        key={`${resetKey ?? ''}:place`}
                        value={resolveDraftValue(row.field) || inputValue}
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
                    ) : isArea ? (
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={sanitizeNumericInput(inputValue)}
                            onChange={(e) => {
                              setAreaHint(null);
                              onDraftChange(row.field, sanitizeNumericInput(e.target.value));
                            }}
                            className={areaInputClass}
                            placeholder="0"
                          />
                          <span className="shrink-0 text-muted-foreground">m²</span>
                          {onAutoCalcArea ? (
                            <button
                              type="button"
                              title="자동계산"
                              onClick={() => {
                                const msg = onAutoCalcArea(row.field);
                                setAreaHint(typeof msg === 'string' && msg ? msg : null);
                              }}
                              className={`ml-1.5 ${btnAutoCalc}`}
                            >
                              자동계산
                            </button>
                          ) : null}
                        </div>
                        {areaHint ? (
                          <span className="text-[10px] text-muted-foreground">{areaHint}</span>
                        ) : null}
                      </div>
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
                      placeholder=""
                      className={`w-full ${readonlyInputClass}`}
                      aria-readonly="true"
                    />
                  ) : isArea ? (
                    formatAreaDisplay(row.value === '—' ? '' : row.value)
                  ) : (
                    row.value
                  )}
                </dd>
              </div>
            );
          })
        )}
      </dl>
    </>
  );
}
