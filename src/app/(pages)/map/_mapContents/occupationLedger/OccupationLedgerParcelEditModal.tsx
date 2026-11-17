'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  occupationParcelModalFieldFullWidth,
  occupationParcelModalMaxWidthClass,
} from './occupationLedgerListWidth';

const fieldClass =
  'h-7 w-full min-w-0 border-0 bg-transparent px-0.5 text-[11px] text-foreground outline-none focus:bg-muted/40';
const fieldViewClass = 'flex min-h-7 w-full min-w-0 items-center break-all text-[11px] text-foreground';
const modalTableClass = 'w-full table-fixed border-collapse text-[11px]';
const modalThClass =
  'border border-border bg-muted px-2 py-1.5 text-left align-middle font-medium text-muted-foreground break-keep';
const modalTdClass = 'border border-border bg-background px-1.5 py-0.5 align-middle';
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

function buildRows(
  fields: OccupationParcelFieldDef[],
  values: Record<string, string>
) {
  const rows: { full: boolean; items: OccupationParcelFieldDef[] }[] = [];
  let i = 0;
  const isFull = (f: OccupationParcelFieldDef) => {
    const val = String(values[f.field] ?? values[f.field.toLowerCase()] ?? '');
    return occupationParcelModalFieldFullWidth(f.field, f.label, val);
  };
  while (i < fields.length) {
    const cur = fields[i]!;
    const next = fields[i + 1];
    if (isFull(cur) || !next || isFull(next)) {
      rows.push({ full: true, items: [cur] });
      i += 1;
      continue;
    }
    rows.push({ full: false, items: [cur, next] });
    i += 2;
  }
  return rows;
}

/** 수정·신규 등록 중 필지 속성 편집 (보상편입용지 필지 모달과 동일 방향) */
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
  const rows = useMemo(() => buildRows(fieldDefs, values), [fieldDefs, values]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (typeof document === 'undefined') return null;
  const fullScreen = overlayWidthPx <= 0;

  const renderCell = (def: OccupationParcelFieldDef, colSpan?: number) => {
    const val = String(values[def.field] ?? values[def.field.toLowerCase()] ?? '').trim();
    if (def.readOnly) {
      return (
        <td key={def.field} colSpan={colSpan} className={modalTdClass}>
          <div className={fieldViewClass}>{val || '—'}</div>
        </td>
      );
    }
    const typeLower = String(def.type ?? '').toLowerCase();
    const inputType = typeLower.includes('date') ? 'date' : typeLower.includes('number') ? 'number' : 'text';
    return (
      <td key={def.field} colSpan={colSpan} className={modalTdClass}>
        <input
          type={inputType}
          className={fieldClass}
          value={values[def.field] ?? ''}
          onChange={(e) => onFieldChange(def.field, e.target.value)}
        />
      </td>
    );
  };

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
          <h3 id={titleId} className="text-sm font-semibold text-foreground">{title}</h3>
          {address ? (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={address}>
              {address}
            </span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
          {fieldDefs.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-muted-foreground">편집할 속성 정의가 없습니다.</p>
          ) : (
            <div className="overflow-hidden rounded border border-border">
              <table className={modalTableClass}>
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[24%]" />
                  <col className="w-[26%]" />
                  <col className="w-[24%]" />
                </colgroup>
                <tbody>
                  {rows.map((row) =>
                    row.full ? (
                      <tr key={row.items[0]!.field}>
                        <th className={modalThClass}>{row.items[0]!.label}</th>
                        {renderCell(row.items[0]!, 3)}
                      </tr>
                    ) : (
                      <tr key={`${row.items[0]!.field}-${row.items[1]!.field}`}>
                        <th className={modalThClass}>{row.items[0]!.label}</th>
                        {renderCell(row.items[0]!)}
                        <th className={modalThClass}>{row.items[1]!.label}</th>
                        {renderCell(row.items[1]!)}
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
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
