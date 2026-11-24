'use client';

import { useCallback, useEffect, useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  RoadRewardAttrTable,
  type RoadRewardAttrEntry,
} from '../road/roadReward/RoadRewardAttrTable';
import {
  occupationParcelModalFieldFullWidth,
  occupationParcelModalMaxWidthClass,
} from './occupationLedgerListWidth';

const fieldClass =
  'box-border h-[22px] w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] leading-none outline-none focus:border-primary focus:ring-1 focus:ring-primary/25';
const fieldViewClass =
  'flex min-h-7 w-full min-w-0 items-center break-all text-[11px] text-foreground/90';
const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50';
const btnGhost =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50';

export type OccupationParcelFieldDef = {
  field: string;
  label: string;
  type?: string;
  readOnly?: boolean;
  required?: boolean;
};

type Props = {
  title: string;
  address: string;
  fieldDefs: OccupationParcelFieldDef[];
  values: Record<string, string>;
  onFieldChange: (field: string, value: string) => void;
  onSave: () => void;
  onClose: () => void;
  overlayLeftPx: number;
  overlayWidthPx: number;
};

/** 수정·신규 등록 중 필지 속성 편집 (속성정보 표와 동일 테두리) */
export function OccupationLedgerParcelEditModal({
  title,
  address,
  fieldDefs,
  values,
  onFieldChange,
  onSave,
  onClose,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const titleId = useId();
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const entries = useMemo<RoadRewardAttrEntry[]>(() => {
    const valueOf = (field: string): string => {
      if (values[field] != null) return String(values[field]);
      const fl = field.toLowerCase();
      if (values[fl] != null) return String(values[fl]);
      const hit = Object.entries(values).find(([k]) => k.toLowerCase() === fl);
      return hit ? String(hit[1] ?? '') : '';
    };
    return fieldDefs.map((def) => {
      const raw = valueOf(def.field);
      const display = raw.trim() || '—';
      let value: RoadRewardAttrEntry['value'];
      if (def.readOnly) {
        value = <div className={fieldViewClass}>{display}</div>;
      } else {
        const typeLower = String(def.type ?? '').toLowerCase();
        const inputType = typeLower.includes('date')
          ? 'date'
          : typeLower.includes('number')
            ? 'number'
            : 'text';
        // date input 은 yyyy-mm-dd 만 받음
        const inputValue =
          inputType === 'date' && raw.trim()
            ? raw.trim().slice(0, 10)
            : raw;
        value = (
          <input
            type={inputType}
            className={fieldClass}
            value={inputValue}
            onChange={(e) => onFieldChange(def.field, e.target.value)}
          />
        );
      }
      return {
        fieldKey: def.field,
        label: def.label,
        value,
        fullWidth: occupationParcelModalFieldFullWidth(def.field, def.label, raw),
        required: Boolean(def.required && !def.readOnly),
      };
    });
  }, [fieldDefs, onFieldChange, values]);

  if (typeof document === 'undefined') return null;
  const fullScreen = overlayWidthPx <= 0;

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-10"
      style={{
        left: fullScreen ? 0 : overlayLeftPx,
        top: 0,
        width: fullScreen ? '100vw' : overlayWidthPx,
        height: '100dvh',
        maxHeight: '100dvh',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={close}
    >
      <div
        className={cn(
          'relative flex max-h-[calc(100dvh-5rem)] w-full flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl',
          occupationParcelModalMaxWidthClass(overlayWidthPx)
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </h3>
          {address ? (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={address}>
              {address}
            </span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
          {fieldDefs.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-muted-foreground">
              편집할 속성 정의가 없습니다.
            </p>
          ) : (
            <RoadRewardAttrTable entries={entries} stringValueMaxLines={2} />
          )}
        </div>

        <div className={cn('flex shrink-0 items-center justify-end gap-1 border-t border-border px-3 py-1.5')}>
          <button type="button" className={btnGhost} onClick={close}>
            취소
          </button>
          <button type="button" className={btnPrimary} onClick={onSave}>
            확인
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
