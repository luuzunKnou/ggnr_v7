"use client";

import { useEffect, useMemo, useState } from "react";
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

const inputClass =
  "rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30";
const readonlyInputClass =
  "cursor-default rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 outline-none";

type Props = {
  attributes: LayerRowDetailAttr[];
  isEditing: boolean;
  draft: Record<string, string>;
  readOnlyFields: Set<string>;
  dateFields: Set<string>;
  onDraftChange: (field: string, value: string) => void;
  /** 상세 건 전환 시 더보기 접기용 */
  resetKey?: string;
};

export function UsageDataAsAttributeSection({
  attributes,
  isEditing,
  draft,
  readOnlyFields,
  dateFields,
  onDraftChange,
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
  const showMoreButton = hiddenCount > 0;

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
        {visibleAttributes.length === 0 ? (
          <div className="px-2 py-3 text-slate-500">표시할 속성이 없습니다.</div>
        ) : (
          visibleAttributes.map((row) => {
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

            return (
              <div
                key={row.field}
                className="grid grid-cols-detail-30 gap-x-2 gap-y-0.5 px-2 py-1.5"
              >
                <dt className="shrink-0 font-medium text-slate-600">{row.label}</dt>
                <dd className="min-w-0 break-words text-slate-800">
                  {showInput ? (
                    isUsagePeriod ? (
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
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={sanitizeNumericInput(inputValue)}
                          onChange={(e) =>
                            onDraftChange(row.field, sanitizeNumericInput(e.target.value))
                          }
                          className={`min-w-0 flex-1 ${inputClass}`}
                          placeholder="0"
                        />
                        <span className="shrink-0 text-slate-500">m²</span>
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
                      placeholder="불러오는 중…"
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
      {showMoreButton && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 w-full rounded border border-slate-200 bg-white py-1.5 text-[11px] font-medium text-primary hover:bg-slate-50"
        >
          {expanded ? "접기" : `더보기 (${hiddenCount}건)`}
        </button>
      )}
    </>
  );
}
