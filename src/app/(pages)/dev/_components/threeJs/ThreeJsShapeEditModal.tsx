'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { DevFloatingPanel } from '../DevFloatingPanel';
import { getShapeModule, innerLengthHint, shapePropsEqual } from './shapeCatalog';
import type { ShapeFieldDef, ShapeFieldKey, ShapeProps } from './shapeTypes';

type Props = {
  open: boolean;
  titleName?: string;
  props: ShapeProps | null;
  onOpenChange: (open: boolean) => void;
  onPreview: (next: ShapeProps) => void;
  onSave: (next: ShapeProps) => void;
  onRollback: (snapshot: ShapeProps) => void;
  onDelete: () => void;
};

function numOr(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampField(field: ShapeFieldDef, n: number): number {
  let v = n;
  if (field.min != null) v = Math.max(field.min, v);
  if (field.max != null) v = Math.min(field.max, v);
  return v;
}

function RatioFieldInput({
  field,
  value,
  draft,
  onChange,
}: {
  field: ShapeFieldDef;
  value: number;
  draft: ShapeProps;
  onChange: (n: number) => void;
}) {
  const min = field.min ?? 0;
  const max = field.max ?? 1;
  const step = field.step ?? 0.01;
  const pct = Math.round(((value - min) / (max - min || 1)) * 1000) / 10;
  const hint = field.key === 'innerRatio' ? innerLengthHint(draft) : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          id={`shape-${field.key}-range`}
          type="range"
          className="h-9 min-w-0 flex-1 cursor-pointer accent-primary"
          min={min}
          max={max}
          step={step}
          value={value}
          title={`${field.label} 슬라이더`}
          onChange={(e) => onChange(clampField(field, numOr(e.target.value, value)))}
        />
        <Input
          id={`shape-${field.key}`}
          type="number"
          className="h-9 w-[4.5rem] shrink-0"
          min={min}
          max={max}
          step={step}
          value={value}
          title={field.label}
          onChange={(e) => onChange(clampField(field, numOr(e.target.value, value)))}
        />
        <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
          {pct}%
        </span>
      </div>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ThreeJsShapeEditModal({
  open,
  titleName,
  props,
  onOpenChange,
  onPreview,
  onSave,
  onRollback,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<ShapeProps | null>(null);
  const snapshotRef = useRef<ShapeProps | null>(null);

  useEffect(() => {
    if (open && props) {
      const snap = { ...props };
      snapshotRef.current = snap;
      setDraft(snap);
    }
    if (!open) {
      snapshotRef.current = null;
      setDraft(null);
    }
  }, [open, props]);

  const requestClose = () => {
    const snap = snapshotRef.current;
    const current = draft;
    if (snap && current && !shapePropsEqual(snap, current)) {
      window.alert('변경 사항이 저장되지 않았습니다. 이전 값으로 되돌립니다.');
      onRollback(snap);
    }
    onOpenChange(false);
  };

  if (!open || !props || !draft) return null;

  const mod = getShapeModule(draft.kind);
  const title = titleName ? `${titleName} 편집` : `${mod.label} 편집`;

  const applyDraft = (next: ShapeProps) => {
    setDraft(next);
    onPreview(next);
  };

  const setField = (key: ShapeFieldKey, value: string | number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      let next: ShapeProps;
      if (key === 'color') {
        next = { ...prev, color: String(value) };
      } else {
        const field = mod.fields.find((f) => f.key === key);
        const raw = typeof value === 'number' ? value : numOr(value, prev[key] as number);
        const n = field ? clampField(field, raw) : raw;
        next = { ...prev, [key]: n };
      }
      onPreview(next);
      return next;
    });
  };

  return (
    <DevFloatingPanel
      open={open}
      onClose={requestClose}
      title={title}
      width="22rem"
      minHeight="0"
      maxHeight="85vh"
      defaultPosition={{ top: 96, right: 24 }}
      dimBackdrop={false}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto">
          {mod.fields.map((field) => (
            <div key={field.key} className="grid grid-cols-[7rem_1fr] items-start gap-2">
              <label
                htmlFor={`shape-${field.key}`}
                className="pt-2 text-sm text-foreground"
              >
                {field.label}
              </label>
              {field.type === 'color' ? (
                <Input
                  id={`shape-${field.key}`}
                  type="color"
                  className="h-9 cursor-pointer"
                  value={draft.color}
                  onChange={(e) => setField('color', e.target.value)}
                  title="색상"
                />
              ) : field.type === 'ratio' ? (
                <RatioFieldInput
                  field={field}
                  value={draft[field.key] as number}
                  draft={draft}
                  onChange={(n) => setField(field.key, n)}
                />
              ) : (
                <Input
                  id={`shape-${field.key}`}
                  type="number"
                  className="h-9"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={draft[field.key] as number}
                  onChange={(e) => setField(field.key, e.target.value)}
                  title={field.label}
                />
              )}
            </div>
          ))}

          <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
            <span className="text-sm text-foreground">수평 위치</span>
            <button
              type="button"
              className="inline-flex h-9 cursor-pointer items-center justify-center rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90"
              title="X·Y(바닥) 좌표를 0,0으로 이동"
              onClick={() => applyDraft({ ...draft, posX: 0, posZ: 0 })}
            >
              X·Y 0,0으로 이동
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            뷰·3면도에 적히는 수치는 비율이 아닌 실제 길이입니다. 내경 비율은 슬라이더로만 조절합니다.
          </p>
          <p className="text-xs text-muted-foreground">
            제목을 드래그해 이동할 수 있습니다. 입력은 뷰에 바로 반영되며, 저장하지 않고 닫으면
            이전 값으로 돌아갑니다.
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border pt-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            title="삭제"
            className="cursor-pointer"
            onClick={() => {
              snapshotRef.current = { ...draft };
              onDelete();
            }}
          >
            삭제
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="취소"
              className="cursor-pointer"
              onClick={requestClose}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              title="저장"
              className="cursor-pointer"
              onClick={() => {
                onSave(draft);
                snapshotRef.current = { ...draft };
                onOpenChange(false);
              }}
            >
              저장
            </Button>
          </div>
        </div>
      </div>
    </DevFloatingPanel>
  );
}
