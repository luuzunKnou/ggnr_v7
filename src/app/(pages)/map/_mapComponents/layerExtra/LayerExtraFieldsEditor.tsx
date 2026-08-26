'use client';

import { useRef } from 'react';
import type { DragEvent } from 'react';
import { Plus, Minus, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toDateInputValue } from '@/lib/usageDataAsFieldUtils';

export type LayerExtraEditorItem = {
  fieldName: string;
  dataType: string;
  value: string;
  sortOrder: number;
};

export type LayerExtraDefOption = {
  fieldName: string;
  dataType: string;
};

type Props = {
  items: LayerExtraEditorItem[];
  isEditing: boolean;
  onChange: (next: LayerExtraEditorItem[]) => void;
  /** 정의에만 있고 화면에 없는 항목 — 수정 시 «정의에서 추가»용 */
  availableDefs?: LayerExtraDefOption[];
  className?: string;
};

const inputClass =
  'min-w-0 w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30';
const iconBtn =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:opacity-40';
const rowClass = 'flex items-center gap-x-2 px-2 py-1.5';
/** 필드명 약 100px */
const nameBoxClass = 'w-[100px] shrink-0';

function extraTypeIsDate(raw: string): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'date';
}

/** 추가속성 행 편집 (공용) — 업무 화면에서 끼워 씀 */
export function LayerExtraFieldsEditor({
  items,
  isEditing,
  onChange,
  availableDefs = [],
  className,
}: Props) {
  const dragIdx = useRef<number | null>(null);

  const updateAt = (index: number, patch: Partial<LayerExtraEditorItem>) => {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const addBlank = () => {
    const nextOrder = (items.reduce((m, it) => Math.max(m, it.sortOrder), 0) || 0) + 1;
    onChange([
      ...items,
      { fieldName: '', dataType: 'text', value: '', sortOrder: nextOrder },
    ]);
  };

  const addFromDef = (name: string) => {
    if (!name.trim()) return;
    if (items.some((it) => it.fieldName.toLowerCase() === name.toLowerCase())) return;
    const def = availableDefs.find((d) => d.fieldName.toLowerCase() === name.toLowerCase());
    const nextOrder = (items.reduce((m, it) => Math.max(m, it.sortOrder), 0) || 0) + 1;
    onChange([
      ...items,
      {
        fieldName: name.trim(),
        dataType: String(def?.dataType ?? 'text').trim() || 'text',
        value: '',
        sortOrder: nextOrder,
      },
    ]);
  };

  const handleDragStart = (e: DragEvent<HTMLButtonElement>, idx: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    dragIdx.current = idx;
  };

  const handleDrop = (targetIdx: number) => {
    const from = dragIdx.current;
    if (from === null || from === targetIdx) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(targetIdx, 0, moved);
    onChange(next.map((it, i) => ({ ...it, sortOrder: i + 1 })));
    dragIdx.current = null;
  };

  const unusedDefs = availableDefs.filter(
    (d) => !items.some((it) => it.fieldName.toLowerCase() === d.fieldName.toLowerCase())
  );

  return (
    <div className={cn(className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          추가 속성
        </div>
        {isEditing ? (
          <div className="text-right text-[10px] leading-snug text-muted-foreground">
            * 드래그 시 순서가 변경됩니다.
          </div>
        ) : null}
      </div>
      <dl className="divide-y divide-border rounded border border-border bg-muted/40">
        {items.length === 0 && !isEditing ? (
          <div className="px-2 py-3 text-muted-foreground">추가 속성이 없습니다.</div>
        ) : null}

        {items.map((row, idx) =>
          isEditing ? (
            <div
              key={`extra-${idx}`}
              className={rowClass}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(idx)}
            >
              <button
                type="button"
                draggable
                title="순서 변경"
                aria-label="순서 변경"
                className="inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragEnd={() => {
                  dragIdx.current = null;
                }}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <dt className="flex shrink-0 items-center">
                <div className={cn(nameBoxClass, 'scrollbar-hide overflow-x-auto')}>
                  <input
                    title={row.fieldName}
                    className={cn(inputClass, 'h-7 min-w-full w-max whitespace-nowrap')}
                    style={{
                      width: `${Math.max(6, [...String(row.fieldName ?? '')].length)}em`,
                    }}
                    value={row.fieldName}
                    placeholder="필드명"
                    onChange={(e) => updateAt(idx, { fieldName: e.target.value })}
                  />
                </div>
              </dt>
              <dd className="flex min-w-0 flex-1 items-center gap-1">
                {extraTypeIsDate(row.dataType) ? (
                  <input
                    type="date"
                    className={inputClass}
                    value={toDateInputValue(row.value)}
                    onChange={(e) => updateAt(idx, { value: e.target.value })}
                  />
                ) : (
                  <input
                    className={inputClass}
                    value={row.value}
                    placeholder="값"
                    onChange={(e) => updateAt(idx, { value: e.target.value })}
                  />
                )}
                <button
                  type="button"
                  className={iconBtn}
                  title="삭제"
                  onClick={() => removeAt(idx)}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </dd>
            </div>
          ) : (
            <div key={`extra-${idx}`} className={cn(rowClass, 'items-start')}>
              <dt className={cn(nameBoxClass, 'break-all leading-snug font-medium text-muted-foreground')}>
                {row.fieldName || '—'}
              </dt>
              <dd className="min-w-0 flex-1 break-words text-foreground">
                {extraTypeIsDate(row.dataType)
                  ? toDateInputValue(row.value) || row.value || '—'
                  : row.value || '—'}
              </dd>
            </div>
          )
        )}

        {isEditing ? (
          <div className="flex items-center justify-center gap-1.5 px-2 py-1.5">
            <button
              type="button"
              onClick={addBlank}
              className="flex h-7 min-w-0 max-w-[9.5rem] flex-1 basis-0 items-center justify-center gap-1 whitespace-nowrap rounded border border-dashed border-border bg-background px-2 text-[11px] text-muted-foreground hover:bg-muted"
            >
              <Plus className="h-3 w-3 shrink-0" />
              속성을 추가해주세요
            </button>
            {unusedDefs.length > 0 ? (
              <select
                className="h-7 min-w-0 max-w-[9.5rem] flex-1 basis-0 rounded border border-border bg-background px-1.5 text-center text-[11px] text-muted-foreground"
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) addFromDef(v);
                  e.target.value = '';
                }}
              >
                <option value="">정의에서 추가</option>
                {unusedDefs.map((d) => (
                  <option key={d.fieldName} value={d.fieldName}>
                    {d.fieldName}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}
      </dl>
    </div>
  );
}
