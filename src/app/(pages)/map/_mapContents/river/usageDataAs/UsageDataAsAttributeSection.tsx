"use client";

import { useMemo, useState } from "react";
import type { LayerRowDetailAttr } from "../../../_mapComponents/layerRowEdit";
import {
  USAGE_AREA_FIELDS,
  USAGE_PD_FIELD,
  formatAreaDisplay,
  formatUsagePeriodDisplay,
  joinUsagePeriod,
  sanitizeNumericInput,
  splitUsagePeriod,
  toDateInputValue,
} from "@/lib/usageDataAsFieldUtils";
import { OccupationLedgerPlaceInput } from "../../occupationLedger/OccupationLedgerPlaceInput";

const PLACE_FIELD = "usage_loc";
const RIVER_NAME_FIELD = "river_name";
const RIVER_TYPE_FIELD = "river_type";

const inputClass =
  "rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30";
const readonlyInputClass =
  "cursor-default rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 outline-none";
/** 도로망 유지보수 «추가»와 동일 primary 톤, 입력 높이보다 약간 낮게 */
const btnAutoCalc =
  "inline-flex h-6 shrink-0 items-center rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";
const areaInputClass =
  "h-6 min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30";

export type UsageDataAsRiverOption = {
  riverName: string;
  riverType: string;
};

type Props = {
  attributes: LayerRowDetailAttr[];
  isEditing: boolean;
  draft: Record<string, string>;
  readOnlyFields: Set<string>;
  dateFields: Set<string>;
  onDraftChange: (field: string, value: string) => void;
  resetKey?: string;
  /** 점용면적 — 본표 도형 면적 자동계산. 실패 시 안내 문구 반환 */
  onAutoCalcArea?: (field: string) => string | null | void;
  vworldApiKey?: string;
  /** river_plan_as 하천명·유형 목록 */
  riverOptions?: UsageDataAsRiverOption[];
};

export function UsageDataAsAttributeSection({
  attributes,
  isEditing,
  draft,
  readOnlyFields,
  dateFields,
  onDraftChange,
  resetKey,
  onAutoCalcArea,
  vworldApiKey = "",
  riverOptions = [],
}: Props) {
  const [areaHint, setAreaHint] = useState<string | null>(null);

  const riverTypeFieldKey = useMemo(() => {
    const hit = attributes.find((a) => a.field.toLowerCase() === RIVER_TYPE_FIELD);
    return hit?.field ?? RIVER_TYPE_FIELD;
  }, [attributes]);

  const riverTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of riverOptions) {
      const t = String(r.riverType ?? "").trim();
      if (t) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [riverOptions]);

  const resolveDraftValue = (field: string): string => {
    if (field in draft) return draft[field] ?? "";
    const key = Object.keys(draft).find((k) => k.toLowerCase() === field.toLowerCase());
    return key ? (draft[key] ?? "") : "";
  };

  const usagePeriodRaw = resolveDraftValue(USAGE_PD_FIELD);
  const { start: periodStart, end: periodEnd } = splitUsagePeriod(usagePeriodRaw);

  const handlePeriodChange = (field: string, part: "start" | "end", value: string) => {
    const raw = resolveDraftValue(field);
    const { start, end } = splitUsagePeriod(raw);
    const nextStart = part === "start" ? value : start;
    const nextEnd = part === "end" ? value : end;
    onDraftChange(field, joinUsagePeriod(nextStart, nextEnd));
  };

  return (
    <>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">상세 속성</div>
      <dl className="divide-y divide-slate-100 rounded border border-slate-200 bg-slate-50/50">
        {attributes.length === 0 ? (
          <div className="px-2 py-3 text-slate-500">표시할 속성이 없습니다.</div>
        ) : (
          attributes.map((row) => {
            const fieldLower = row.field.toLowerCase();
            const locked = readOnlyFields.has(fieldLower);
            const showInput = isEditing && !locked;
            const showReadonlyInput = isEditing && locked;
            const inputValue = draft[row.field] ?? "";
            const readonlyValue =
              resolveDraftValue(row.field) ||
              (row.value && row.value !== "—" ? row.value : "");
            const isDate = dateFields.has(fieldLower);
            const isUsagePeriod = fieldLower === USAGE_PD_FIELD;
            const isArea = USAGE_AREA_FIELDS.has(fieldLower);
            const isPlace = fieldLower === PLACE_FIELD;
            const isRiverName = fieldLower === RIVER_NAME_FIELD;
            const isRiverType = fieldLower === RIVER_TYPE_FIELD;
            const riverNameValue = resolveDraftValue(row.field) || inputValue;
            const riverTypeValue = resolveDraftValue(RIVER_TYPE_FIELD) || inputValue;

            return (
              <div
                key={row.field}
                className="grid grid-cols-detail-30 items-center gap-x-2 gap-y-0.5 px-2 py-1.5"
              >
                <dt className="shrink-0 leading-none font-medium text-slate-600">{row.label}</dt>
                <dd className="relative min-w-0 break-words text-slate-800">
                  {showInput ? (
                    isRiverName ? (
                      <select
                        value={riverNameValue}
                        onChange={(e) => {
                          const name = e.target.value;
                          onDraftChange(row.field, name);
                          const match = riverOptions.find((r) => r.riverName === name);
                          if (match) {
                            onDraftChange(riverTypeFieldKey, match.riverType);
                          }
                        }}
                        className={`w-full ${inputClass}`}
                      >
                        <option value="">선택</option>
                        {riverNameValue &&
                        !riverOptions.some((r) => r.riverName === riverNameValue) ? (
                          <option value={riverNameValue}>{riverNameValue}</option>
                        ) : null}
                        {riverOptions.map((r) => (
                          <option key={r.riverName} value={r.riverName}>
                            {r.riverName}
                          </option>
                        ))}
                      </select>
                    ) : isRiverType ? (
                      <select
                        value={
                          riverTypeOptions.includes(riverTypeValue)
                            ? riverTypeValue
                            : riverTypeValue || ""
                        }
                        disabled
                        aria-readonly="true"
                        title="하천명에 따라 자동 입력됩니다"
                        className={`w-full ${readonlyInputClass}`}
                      >
                        <option value="">선택</option>
                        {riverTypeValue && !riverTypeOptions.includes(riverTypeValue) ? (
                          <option value={riverTypeValue}>{riverTypeValue}</option>
                        ) : null}
                        {riverTypeOptions.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    ) : isPlace ? (
                      <OccupationLedgerPlaceInput
                        key={`${resetKey ?? ""}:place`}
                        value={resolveDraftValue(row.field) || inputValue}
                        onChange={(v) => onDraftChange(row.field, v)}
                        vworldApiKey={vworldApiKey}
                      />
                    ) : isUsagePeriod ? (
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        <input
                          type="date"
                          value={toDateInputValue(periodStart)}
                          onChange={(e) => handlePeriodChange(row.field, "start", e.target.value)}
                          className={`min-w-0 flex-1 ${inputClass}`}
                          aria-label="점용 시작일"
                        />
                        <span className="shrink-0 text-slate-400">~</span>
                        <input
                          type="date"
                          value={toDateInputValue(periodEnd)}
                          onChange={(e) => handlePeriodChange(row.field, "end", e.target.value)}
                          className={`min-w-0 flex-1 ${inputClass}`}
                          aria-label="점용 종료일"
                        />
                      </div>
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
                          <span className="shrink-0 text-slate-500">m²</span>
                          {onAutoCalcArea ? (
                            <button
                              type="button"
                              title="자동계산"
                              onClick={() => {
                                const msg = onAutoCalcArea(row.field);
                                setAreaHint(typeof msg === "string" && msg ? msg : null);
                              }}
                              className={`ml-1.5 ${btnAutoCalc}`}
                            >
                              자동계산
                            </button>
                          ) : null}
                        </div>
                        {areaHint ? (
                          <span className="text-[10px] text-amber-700">{areaHint}</span>
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
                  ) : isUsagePeriod ? (
                    formatUsagePeriodDisplay(row.value === "—" ? "" : row.value)
                  ) : isArea ? (
                    formatAreaDisplay(row.value === "—" ? "" : row.value)
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
