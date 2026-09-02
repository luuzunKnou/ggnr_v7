'use client';

import { useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
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
};

const inputClass =
  'min-w-0 w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30';
const iconBtn =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:opacity-40';
const rowClass = 'flex items-center gap-x-2 px-2 py-1.5';
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

/** 추가속성 행 편집 (공용) — 업무 화면에서 끼워 씀 */
export function LayerExtraFieldsEditor({
  items,
  isEditing,
  onChange,
  availableDefs = [],
  className,
}: Props) {
  const dragIdx = useRef<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState<ExtraDataType>('varchar');
  const [addError, setAddError] = useState<string | null>(null);

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
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-[11px] font-medium text-muted-foreground">추가 속성</div>
        {isEditing ? (
          <div className="text-right text-[10px] leading-snug text-muted-foreground">
            * 드래그 시 순서가 변경됩니다.
          </div>
        ) : null}
      </div>
      {isEditing ? (
        <div className="divide-y divide-border overflow-hidden rounded border border-border">
          {items.map((row, idx) => (
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
          ))}
          <div className="flex items-center justify-center gap-1.5 px-2 py-1.5">
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
