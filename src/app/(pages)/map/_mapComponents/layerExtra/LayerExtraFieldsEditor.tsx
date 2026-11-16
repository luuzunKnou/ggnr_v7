'use client';

import { useCallback, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Plus, Minus, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  DetailAttrRow,
  DetailAttrTable,
} from '../layerRowEdit/DetailAttrTable';
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

type ExtraDataType = 'varchar' | 'integer' | 'date';

type Props = {
  items: LayerExtraEditorItem[];
  isEditing: boolean;
  onChange: (next: LayerExtraEditorItem[]) => void;
  /** 정의에만 있고 화면에 없는 항목 — 수정 시 «정의에서 추가»용 */
  availableDefs?: LayerExtraDefOption[];
  className?: string;
  /** true면 «추가 속성» 머리줄 숨김 — 부모 접기 섹션 제목만 쓸 때 */
  hideHeader?: boolean;
};

const inputClass =
  'min-w-0 w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30';
const iconBtn =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:opacity-40';
const rowClass = 'relative flex items-center gap-x-1.5 px-2 py-1.5';
const gripClass =
  'relative inline-flex h-7 w-6 shrink-0 touch-none cursor-grab select-none items-center justify-center rounded border border-border/80 bg-muted/60 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground active:cursor-grabbing';
/** 속성명 약 100px */
const nameBoxClass = 'w-[100px] shrink-0';

const EXTRA_DATA_TYPE_OPTIONS: { value: ExtraDataType; label: string }[] = [
  { value: 'varchar', label: '문자' },
  { value: 'integer', label: '숫자' },
  { value: 'date', label: '날짜' },
];

function extraTypeKind(raw: string): ExtraDataType {
  const t = String(raw ?? '').trim().toLowerCase();
  if (t === 'date') return 'date';
  if (t === 'integer' || t === 'int' || t === 'number' || t === 'numeric') return 'integer';
  return 'varchar';
}

function extraRowKey(row: LayerExtraEditorItem): string {
  return row.fieldName.toLowerCase();
}

/** 포인터 Y → 삽입할 행 인덱스 (행 중앙 기준, 경계 흔들림 방지) */
function hitTestInsertIndex(clientY: number, rowEls: (HTMLDivElement | null)[]): number | null {
  if (rowEls.length === 0) return null;
  for (let i = 0; i < rowEls.length; i++) {
    const el = rowEls[i];
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const mid = (r.top + r.bottom) / 2;
    if (clientY < mid) return i;
  }
  return rowEls.length - 1;
}

/** 추가속성 행 편집 (공용) — 업무 화면에서 끼워 씀 */
export function LayerExtraFieldsEditor({
  items,
  isEditing,
  onChange,
  availableDefs = [],
  className,
  hideHeader = false,
}: Props) {
  const rowElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const itemsRef = useRef(items);
  const dragFromRef = useRef<number | null>(null);
  const dragFieldRef = useRef<string | null>(null);
  const moveRafRef = useRef<number | null>(null);
  const pendingOverRef = useRef<number | null>(null);
  const [draggingField, setDraggingField] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState<ExtraDataType>('varchar');
  const [addError, setAddError] = useState<string | null>(null);

  itemsRef.current = items;

  const updateAt = (index: number, patch: Partial<LayerExtraEditorItem>) => {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const openAddModal = () => {
    setAddName('');
    setAddType('varchar');
    setAddError(null);
    setAddOpen(true);
  };

  const handleAddOpenChange = (open: boolean) => {
    setAddOpen(open);
    if (!open) {
      setAddName('');
      setAddType('varchar');
      setAddError(null);
    }
  };

  const submitAdd = (e?: FormEvent) => {
    e?.preventDefault();
    const name = addName.trim();
    if (!name) {
      setAddError('속성명을 입력하세요.');
      return;
    }
    if (items.some((it) => it.fieldName.toLowerCase() === name.toLowerCase())) {
      setAddError('이미 있는 속성명입니다.');
      return;
    }
    const nextOrder = (items.reduce((m, it) => Math.max(m, it.sortOrder), 0) || 0) + 1;
    onChange([
      ...items,
      { fieldName: name, dataType: addType, value: '', sortOrder: nextOrder },
    ]);
    handleAddOpenChange(false);
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
        dataType: String(def?.dataType ?? 'varchar').trim() || 'varchar',
        value: '',
        sortOrder: nextOrder,
      },
    ]);
  };

  const clearDragUi = useCallback(() => {
    dragFromRef.current = null;
    dragFieldRef.current = null;
    pendingOverRef.current = null;
    if (moveRafRef.current !== null) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
    setDraggingField(null);
  }, []);

  const moveRow = useCallback(
    (from: number, to: number) => {
      const current = itemsRef.current;
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) {
        return;
      }
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onChange(next.map((it, i) => ({ ...it, sortOrder: i + 1 })));
      dragFromRef.current = to;
    },
    [onChange]
  );

  const flushPendingMove = useCallback(() => {
    moveRafRef.current = null;
    const from = dragFromRef.current;
    const to = pendingOverRef.current;
    if (from === null || to === null || from === to) return;
    moveRow(from, to);
  }, [moveRow]);

  const scheduleMoveTo = useCallback(
    (over: number) => {
      const from = dragFromRef.current;
      if (from === null || over === from) return;
      pendingOverRef.current = over;
      if (moveRafRef.current !== null) return;
      moveRafRef.current = requestAnimationFrame(flushPendingMove);
    },
    [flushPendingMove]
  );

  const handleGripPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, idx: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const field = extraRowKey(itemsRef.current[idx]!);
    dragFromRef.current = idx;
    dragFieldRef.current = field;
    setDraggingField(field);
  };

  const handleGripPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragFromRef.current === null) return;
    const over = hitTestInsertIndex(e.clientY, rowElsRef.current);
    if (over !== null) scheduleMoveTo(over);
  };

  const handleGripPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragFromRef.current === null) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (moveRafRef.current !== null) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
    flushPendingMove();
    clearDragUi();
  };

  const unusedDefs = availableDefs.filter(
    (d) => !items.some((it) => it.fieldName.toLowerCase() === d.fieldName.toLowerCase())
  );

  const renderValueInput = (row: LayerExtraEditorItem, idx: number) => {
    const kind = extraTypeKind(row.dataType);
    if (kind === 'date') {
      return (
        <input
          type="date"
          className={inputClass}
          value={toDateInputValue(row.value)}
          onChange={(e) => updateAt(idx, { value: e.target.value })}
        />
      );
    }
    if (kind === 'integer') {
      return (
        <input
          type="number"
          inputMode="numeric"
          step={1}
          className={inputClass}
          value={row.value}
          placeholder="값"
          onChange={(e) => updateAt(idx, { value: e.target.value })}
        />
      );
    }
    return (
      <input
        className={inputClass}
        value={row.value}
        placeholder="값"
        onChange={(e) => updateAt(idx, { value: e.target.value })}
      />
    );
  };

  return (
    <div className={cn(className)}>
      {hideHeader ? null : (
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <div className="text-[11px] font-medium text-muted-foreground">추가 속성</div>
          {isEditing ? (
            <div className="whitespace-nowrap text-right text-[10px] leading-none text-muted-foreground">
              * 드래그 시 순서가 변경됩니다.
            </div>
          ) : null}
        </div>
      )}
      {isEditing ? (
        <div
          className={cn(
            'divide-y divide-border overflow-hidden rounded border border-border',
            draggingField !== null && 'select-none ring-1 ring-primary/15'
          )}
        >
          {items.map((row, idx) => {
            const isDragging = draggingField === extraRowKey(row);
            return (
              <div
                key={extraRowKey(row)}
                ref={(el) => {
                  rowElsRef.current[idx] = el;
                }}
                className={cn(
                  rowClass,
                  idx % 2 === 1 && draggingField === null && 'bg-muted/25',
                  isDragging && 'z-10 bg-background shadow-sm ring-1 ring-primary/20'
                )}
              >
                <button
                  type="button"
                  title="순서 변경 (드래그)"
                  aria-label={`${idx + 1}번째 속성 순서 변경`}
                  className={cn(gripClass, isDragging && 'border-primary/40 bg-primary/10 text-primary')}
                  onPointerDown={(e) => handleGripPointerDown(e, idx)}
                  onPointerMove={handleGripPointerMove}
                  onPointerUp={handleGripPointerUp}
                  onPointerCancel={handleGripPointerUp}
                >
                  <GripVertical className="h-3.5 w-3.5" aria-hidden />
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
                      placeholder="속성명"
                      onChange={(e) => updateAt(idx, { fieldName: e.target.value })}
                    />
                  </div>
                </dt>
                <dd className="flex min-w-0 flex-1 items-center gap-1">
                  {renderValueInput(row, idx)}
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
            );
          })}
          <div className="flex flex-nowrap items-center justify-center gap-1.5 px-2 py-1.5">
            <button
              type="button"
              onClick={openAddModal}
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
        </div>
      ) : (
        <DetailAttrTable empty={items.length === 0 ? '추가 속성이 없습니다.' : null}>
          {items.map((row, idx) => (
            <DetailAttrRow
              key={`extra-${idx}`}
              label={row.fieldName || '—'}
              isLast={idx === items.length - 1}
            >
              {extraTypeKind(row.dataType) === 'date'
                ? toDateInputValue(row.value) || row.value || '—'
                : row.value || '—'}
            </DetailAttrRow>
          ))}
        </DetailAttrTable>
      )}

      <Dialog open={addOpen} onOpenChange={handleAddOpenChange}>
        <DialogContent
          className="gap-0 overflow-hidden rounded-[10px] border-border/80 p-0 sm:max-w-[360px]"
          layerZIndex={140}
        >
          <DialogHeader className="border-b border-border bg-gradient-to-b from-muted/30 to-background px-4 py-3">
            <DialogTitle className="text-sm font-semibold text-foreground">속성 추가</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitAdd}>
            <div className="flex flex-col gap-3 px-4 py-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">속성명</span>
                <input
                  autoFocus
                  className={cn(inputClass, 'h-8')}
                  value={addName}
                  placeholder="속성명"
                  onChange={(e) => {
                    setAddName(e.target.value);
                    if (addError) setAddError(null);
                  }}
                />
              </label>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-[11px] text-muted-foreground">자료형</legend>
                <div className="flex gap-1">
                  {EXTRA_DATA_TYPE_OPTIONS.map((opt) => {
                    const selected = addType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setAddType(opt.value)}
                        className={cn(
                          'h-7 flex-1 rounded border text-[11px]',
                          selected
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border bg-background text-muted-foreground hover:bg-muted'
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              {addError ? (
                <p className="text-[11px] text-destructive">{addError}</p>
              ) : null}
            </div>
            <DialogFooter className="border-t border-border px-4 py-2.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleAddOpenChange(false)}
              >
                취소
              </Button>
              <Button type="submit" size="sm">
                추가
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
