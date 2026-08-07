"use client";

import type { LayerRowDetailAttr } from "./types";

type Props = {
  attributes: LayerRowDetailAttr[];
  isEditing: boolean;
  draft: Record<string, string>;
  readOnlyFields: Set<string>;
  dateFields: Set<string>;
  onDraftChange: (field: string, value: string) => void;
};

export function LayerRowAttributeSection({
  attributes,
  isEditing,
  draft,
  readOnlyFields,
  dateFields,
  onDraftChange,
}: Props) {
  return (
    <>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">상세 속성</div>
      <dl className="divide-y divide-slate-100 rounded border border-slate-200 bg-slate-50/50">
        {attributes.length === 0 ? (
          <div className="px-2 py-3 text-slate-500">표시할 속성이 없습니다.</div>
        ) : (
          attributes.map((row) => {
            const locked = readOnlyFields.has(row.field.toLowerCase());
            const showInput = isEditing && !locked;
            const inputValue = draft[row.field] ?? "";
            const isDate = dateFields.has(row.field.toLowerCase());
            return (
              <div
                key={row.field}
                className="grid grid-cols-detail-30 gap-x-2 gap-y-0.5 px-2 py-1.5"
              >
                <dt className="shrink-0 font-medium text-slate-600">{row.label}</dt>
                <dd className="min-w-0 break-words text-slate-800">
                  {showInput ? (
                    isDate ? (
                      <input
                        type="date"
                        value={inputValue}
                        onChange={(e) => onDraftChange(row.field, e.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                      />
                    ) : (
                      <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => onDraftChange(row.field, e.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                      />
                    )
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
