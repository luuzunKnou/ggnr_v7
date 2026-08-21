'use client';

import { tryFormatToYmd } from '@/lib/formatDateYmd';
import { useShapeEditorContext } from '../ShapeEditorContext';
import { useShapeEditorAttributeFields } from '../_hooks/useShapeEditorAttributeFields';

function toDateInputValue(raw: string): string {
  return tryFormatToYmd(raw) ?? '';
}

export function ShapeEditorFeatureAttributes() {
  const { activeEditLayer, draft, setAttributeValue } = useShapeEditorContext();
  const { fields, loading, isDateFieldType } = useShapeEditorAttributeFields(activeEditLayer);

  const hasSelection = draft.selectedFeatureId != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">도형 속성</span>
          {hasSelection && draft.changeKind === 'update' ? (
            <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-800">
              수정
            </span>
          ) : null}
          {hasSelection && draft.changeKind === 'insert' ? (
            <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold text-emerald-700">
              신규
            </span>
          ) : null}
        </div>
        {activeEditLayer ? (
          <p className="truncate text-[10px] text-muted-foreground">{activeEditLayer.name}</p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!activeEditLayer ? (
          <p className="px-1 py-4 text-center text-[10px] text-muted-foreground">편집 레이어 지정</p>
        ) : !hasSelection ? (
          <p className="px-1 py-4 text-center text-[10px] text-muted-foreground">도형 선택 또는 그리기</p>
        ) : loading ? (
          <p className="px-1 py-4 text-center text-[10px] text-muted-foreground">불러오는 중…</p>
        ) : fields.length === 0 ? (
          <p className="px-1 py-4 text-center text-[10px] text-muted-foreground">속성 없음</p>
        ) : (
          <dl className="divide-y divide-border rounded border border-border bg-background">
            {fields.map((row) => {
              const isDate = isDateFieldType(row.type);
              const locked = row.readOnly === true;
              const raw = draft.attributeValues[row.field] ?? '';
              const inputValue = isDate ? toDateInputValue(raw) : raw;
              return (
                <div
                  key={row.field}
                  className="grid grid-cols-[minmax(0,38%)_1fr] gap-x-1.5 px-2 py-1.5"
                >
                  <dt className="truncate text-[11px] font-medium text-muted-foreground" title={row.label}>
                    {row.label}
                  </dt>
                  <dd className="min-w-0">
                    <input
                      type={isDate ? 'date' : 'text'}
                      value={inputValue}
                      readOnly={locked}
                      disabled={locked}
                      onChange={(e) => {
                        if (locked) return;
                        setAttributeValue(row.field, e.target.value);
                      }}
                      className={
                        locked
                          ? 'w-full cursor-not-allowed rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[11px] text-muted-foreground'
                          : 'w-full rounded border border-border px-1.5 py-0.5 text-[11px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30'
                      }
                    />
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </div>
  );
}
