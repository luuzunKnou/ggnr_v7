'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatDefineFieldDisplayValue } from '@/lib/defineLayerCodeDisplay';
import {
  getDefineFieldDisplayLabel,
  getRowValueByDefineField,
  isNumberColumnField,
  type DefineFieldLike,
} from '../../_mapComponents/standard/defineLayerRowUtils';

export type SafetyListSortDir = 'asc' | 'desc';

export type SafetyListSortSpec = {
  key: string;
  dir: SafetyListSortDir;
};

type Props<T extends Record<string, unknown>> = {
  columns: DefineFieldLike[];
  items: T[];
  loading: boolean;
  emptyMessage: string;
  selectedId?: number | null;
  getRowId: (row: T) => number;
  onRowClick: (row: T) => void;
  rowDataAttr?: string;
  sorts?: SafetyListSortSpec[];
  onToggleSort?: (fieldKey: string) => void;
  initialSortDir?: (fieldKey: string) => SafetyListSortDir;
  /** 필드명별 열 너비 가중치(미지정 열은 1). 합계 대비 %로 계산 */
  columnWidthWeights?: Record<string, number>;
  /** 필드별 목록 셀 표시 포맷 */
  cellDisplayFormatters?: Record<string, (raw: unknown, display: string) => string>;
  /** 필드별 텍스트 정렬(미지정 숫자열은 가운데, 그 외 좌측) */
  columnTextAlign?: Record<string, 'left' | 'center' | 'right'>;
};

function resolveColumnTextAlign(
  fieldName: string,
  isNumberCol: boolean,
  columnTextAlign?: Record<string, 'left' | 'center' | 'right'>
): 'left' | 'center' | 'right' {
  const custom =
    columnTextAlign?.[fieldName] ?? columnTextAlign?.[fieldName.toLowerCase()];
  if (custom) return custom;
  if (isNumberCol) return 'center';
  return 'left';
}

function thAlignClass(align: 'left' | 'center' | 'right'): string {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'standard-table-th-center';
  return 'standard-table-th-left';
}

function sortButtonAlignClass(align: 'left' | 'center' | 'right'): string {
  if (align === 'right') return 'standard-sort-button-left w-full justify-end whitespace-nowrap';
  if (align === 'center') return 'standard-sort-button-center whitespace-nowrap';
  return 'standard-sort-button-left';
}

function tdAlignClass(align: 'left' | 'center' | 'right'): string {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return '';
}

function isNumberDefineField(col: DefineFieldLike, fieldName: string): boolean {
  return (
    String(col.define_field_type ?? '').trim().toUpperCase() === 'NUMBER' ||
    isNumberColumnField(fieldName, col.define_field_kor_name)
  );
}

export function SafetyLayerListTable<T extends Record<string, unknown>>({
  columns,
  items,
  loading,
  emptyMessage,
  selectedId,
  getRowId,
  onRowClick,
  rowDataAttr,
  sorts,
  onToggleSort,
  initialSortDir,
  columnWidthWeights,
  cellDisplayFormatters,
  columnTextAlign,
}: Props<T>) {
  const colCount = Math.max(columns.length, 1);
  const colWidths = useMemo(() => {
    if (columns.length === 0) return ['100%'];
    if (!columnWidthWeights || Object.keys(columnWidthWeights).length === 0) {
      const equal = `${100 / columns.length}%`;
      return columns.map(() => equal);
    }
    const weights = columns.map((col) => {
      const fieldName = String(col.define_field_name ?? '').toLowerCase();
      const w = columnWidthWeights[fieldName] ?? columnWidthWeights[String(col.define_field_name ?? '')];
      return typeof w === 'number' && w > 0 ? w : 1;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    return weights.map((w) => `${(w / total) * 100}%`);
  }, [columnWidthWeights, columns]);
  const sortEnabled = Boolean(onToggleSort && initialSortDir);

  return (
    <table className="standard-list-table">
      {columns.length > 0 ? (
        <colgroup>
          {columns.map((col, idx) => (
            <col key={String(col.define_field_name ?? idx)} style={{ width: colWidths[idx] }} />
          ))}
        </colgroup>
      ) : null}
      <thead className="standard-table-thead">
        <tr>
          {columns.length > 0 ? (
            columns.map((col) => {
              const fieldName = String(col.define_field_name ?? '');
              const label = getDefineFieldDisplayLabel(fieldName, col.define_field_kor_name);
              const isNumberCol = isNumberDefineField(col, fieldName);
              const textAlign = resolveColumnTextAlign(fieldName, isNumberCol, columnTextAlign);
              const sortIdx = sorts?.findIndex((s) => s.key.toLowerCase() === fieldName.toLowerCase()) ?? -1;
              const active = sortIdx >= 0;
              const sortDir: SafetyListSortDir | null =
                active && sorts ? sorts[sortIdx].dir : null;
              const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
              const initial = initialSortDir?.(fieldName) ?? 'asc';

              if (sortEnabled) {
                return (
                  <th
                    key={fieldName}
                    className={cn('standard-table-th', thAlignClass(textAlign))}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleSort?.(fieldName)}
                      className={cn(
                        'standard-sort-button',
                        sortButtonAlignClass(textAlign),
                        active && 'standard-sort-button-active'
                      )}
                      title={
                        !active
                          ? `${label} 정렬 추가`
                          : sortDir === initial
                            ? `${label} 방향 바꾸기`
                            : `${label} 정렬 해제`
                      }
                    >
                      <span className={cn(isNumberCol ? 'whitespace-nowrap' : 'truncate')}>{label}</span>
                      <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                    </button>
                  </th>
                );
              }

              return (
                <th
                  key={fieldName}
                  className={cn('standard-table-th', thAlignClass(textAlign))}
                  title={label}
                >
                  {label}
                </th>
              );
            })
          ) : (
            <th className="standard-table-th standard-table-th-left">—</th>
          )}
        </tr>
      </thead>
      <tbody>
        {loading && items.length === 0 ? (
          <tr>
            <td colSpan={colCount} className="standard-table-empty">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                불러오는 중…
              </span>
            </td>
          </tr>
        ) : items.length === 0 ? (
          <tr>
            <td colSpan={colCount} className="standard-table-empty">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          items.map((row) => {
            const rowId = getRowId(row);
            const active = selectedId === rowId;
            return (
              <tr
                key={rowId}
                {...(rowDataAttr ? { [rowDataAttr]: rowId } : {})}
                tabIndex={0}
                onClick={() => onRowClick(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick(row);
                  }
                }}
                className={cn('standard-list-row', active && 'standard-list-row-selected')}
              >
                {columns.length > 0 ? (
                  columns.map((col, colIdx) => {
                    const fieldName = String(col.define_field_name ?? '');
                    const raw = getRowValueByDefineField(row, fieldName);
                    let display = formatDefineFieldDisplayValue(raw, col.define_field_type, undefined);
                    const formatter =
                      cellDisplayFormatters?.[fieldName] ??
                      cellDisplayFormatters?.[fieldName.toLowerCase()];
                    if (formatter) {
                      display = formatter(raw, display);
                    }
                    const isNumberCol = isNumberDefineField(col, fieldName);
                    const textAlign = resolveColumnTextAlign(fieldName, isNumberCol, columnTextAlign);
                    return (
                      <td
                        key={fieldName}
                        className={cn(
                          colIdx === 0 ? 'standard-table-td-text' : 'standard-table-td-text-muted',
                          isNumberCol && 'standard-table-td-date',
                          tdAlignClass(textAlign)
                        )}
                        title={display}
                      >
                        {display}
                      </td>
                    );
                  })
                ) : (
                  <td className="standard-table-td-text">—</td>
                )}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
