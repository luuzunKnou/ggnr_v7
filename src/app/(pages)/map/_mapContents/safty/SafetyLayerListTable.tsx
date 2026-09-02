'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDefineFieldDisplayValue } from '@/lib/defineLayerCodeDisplay';
import {
  getDefineFieldDisplayLabel,
  getRowValueByDefineField,
  isNumberColumnField,
  type DefineFieldLike,
} from '../../_mapComponents/standard/defineLayerRowUtils';

type Props<T extends Record<string, unknown>> = {
  columns: DefineFieldLike[];
  items: T[];
  loading: boolean;
  emptyMessage: string;
  selectedId?: number | null;
  getRowId: (row: T) => number;
  onRowClick: (row: T) => void;
  rowDataAttr?: string;
};

export function SafetyLayerListTable<T extends Record<string, unknown>>({
  columns,
  items,
  loading,
  emptyMessage,
  selectedId,
  getRowId,
  onRowClick,
  rowDataAttr,
}: Props<T>) {
  const colCount = Math.max(columns.length, 1);
  const equalColWidth = columns.length > 0 ? `${100 / columns.length}%` : '100%';

  return (
    <table className="standard-list-table min-w-[360px] w-full table-fixed">
      {columns.length > 0 ? (
        <colgroup>
          {columns.map((col, idx) => (
            <col key={String(col.define_field_name ?? idx)} style={{ width: equalColWidth }} />
          ))}
        </colgroup>
      ) : null}
      <thead className="standard-table-thead">
        <tr>
          {columns.length > 0 ? (
            columns.map((col) => {
              const fieldName = String(col.define_field_name ?? '');
              const label = getDefineFieldDisplayLabel(fieldName, col.define_field_kor_name);
              const isNumberCol = isNumberColumnField(fieldName, col.define_field_kor_name);
              return (
                <th
                  key={fieldName}
                  className={cn(
                    'standard-table-th',
                    isNumberCol ? 'standard-table-th-center' : 'standard-table-th-left'
                  )}
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
                    const display = formatDefineFieldDisplayValue(raw, col.define_field_type, undefined);
                    const isNumberCol = isNumberColumnField(fieldName, col.define_field_kor_name);
                    return (
                      <td
                        key={fieldName}
                        className={cn(
                          colIdx === 0 ? 'standard-table-td-text' : 'standard-table-td-text-muted',
                          isNumberCol && 'standard-table-td-date text-center'
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
