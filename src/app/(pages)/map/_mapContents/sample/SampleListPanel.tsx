'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Layers, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  OCCUPATION_PERIOD_STATE_ENDED,
  OCCUPATION_PERIOD_STATE_IN_PROGRESS,
} from '@/lib/occupationLedgerPeriodState';
import {
  initialOccupationLedgerSortDir,
  sortOccupationLedgerListRows,
  type OccupationLedgerListSortKey,
  type OccupationLedgerListSortSpec,
} from '@/lib/occupationLedgerListSort';
import { LayerRowAddButton, LayerRowPanelButton } from '../../_mapComponents/layerRowEdit';
import { occupationLayerToggleActiveStyle } from '@/lib/occupationLayerStyle';
import { SAMPLE_MOCK_ROWS, type SampleListRow } from './sampleMockData';

const STATUS_FILTER_OPTIONS = [
  { value: '', label: '전체' },
  { value: OCCUPATION_PERIOD_STATE_IN_PROGRESS, label: OCCUPATION_PERIOD_STATE_IN_PROGRESS },
  { value: OCCUPATION_PERIOD_STATE_ENDED, label: OCCUPATION_PERIOD_STATE_ENDED },
] as const;

type SortKey = OccupationLedgerListSortKey;
type SortSpec = OccupationLedgerListSortSpec;

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'status', label: '상태' },
  { key: 'name', label: '점용명' },
  { key: 'place', label: '점용장소' },
  { key: 'startDate', label: '점용시작일' },
  { key: 'endDate', label: '점용종료일' },
];

const HEADER_ALIGN_LEFT = new Set<SortKey>(['name', 'place']);

type Props = {
  onClose: () => void;
};

export function SampleListPanel({ onClose }: Props) {
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sorts, setSorts] = useState<SortSpec[]>([]);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [useFeeLayerOn, setUseFeeLayerOn] = useState(false);

  const items = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return SAMPLE_MOCK_ROWS;
    return SAMPLE_MOCK_ROWS.filter((row) => {
      const haystack = [row.name, row.place, row.startDate, row.endDate, row.status]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [keyword]);

  const filteredItems = useMemo(() => {
    const byStatus = statusFilter ? items.filter((row) => row.status === statusFilter) : items;
    return sortOccupationLedgerListRows(byStatus, sorts);
  }, [items, statusFilter, sorts]);

  const toggleSort = (key: SortKey) => {
    const initial = initialOccupationLedgerSortDir(key);
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (idx < 0) return [...prev, { key, dir: initial }];
      const cur = prev[idx];
      if (cur.dir === initial) {
        const next = [...prev];
        next[idx] = { key, dir: initial === 'asc' ? 'desc' : 'asc' };
        return next;
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  useEffect(() => {
    if (!selectedRowKey) return;
    const scroller = listScrollRef.current;
    if (!scroller) return;
    const el = scroller.querySelector(
      `[data-sample-row="${CSS.escape(selectedRowKey)}"]`
    );
    if (!(el instanceof HTMLElement)) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta =
      elRect.top + elRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
    if (Math.abs(delta) < 4) return;
    scroller.scrollBy({ top: delta, behavior: 'smooth' });
  }, [selectedRowKey, filteredItems]);

  const handleRowClick = (rowKey: string) => {
    if (!rowKey) return;
    setSelectedRowKey(rowKey);
  };

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">도로점용</span>
        <div className="flex items-center gap-1">
          <LayerRowPanelButton
            type="button"
            title={useFeeLayerOn ? '점사용료 레이어 끄기' : '점사용료 레이어 켜기'}
            aria-label={useFeeLayerOn ? '점사용료 레이어 끄기' : '점사용료 레이어 켜기'}
            aria-pressed={useFeeLayerOn}
            onClick={() => setUseFeeLayerOn((v) => !v)}
            style={useFeeLayerOn ? occupationLayerToggleActiveStyle('useFee') : undefined}
            className={useFeeLayerOn ? 'hover:opacity-90' : undefined}
          >
            <Layers className="h-3 w-3 shrink-0" aria-hidden />
            점사용료
          </LayerRowPanelButton>
          <LayerRowAddButton onClick={() => undefined} disabled />
          <button
            type="button"
            onClick={onClose}
            className="standard-panel-close"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="standard-filter-section">
        <div className="standard-search-wrap">
          <Search className="standard-search-icon" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (점용명, 장소, 기간 등)"
            className="standard-search-input"
          />
        </div>
        <div className="standard-filter-chips">
          {STATUS_FILTER_OPTIONS.map((opt) => {
            const active = statusFilter === opt.value;
            return (
              <button
                key={opt.value || '__all__'}
                type="button"
                onClick={() => setStatusFilter(opt.value)}
                className={cn(
                  'standard-filter-chip',
                  active &&
                    (opt.value === OCCUPATION_PERIOD_STATE_ENDED
                      ? 'standard-filter-chip-active-[#e63946]'
                      : 'standard-filter-chip-active')
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="standard-list-body">
        <div ref={listScrollRef} className="standard-list-scroll">
          <table className="standard-list-table min-w-[596px]">
            <colgroup>
              <col className="w-[60px]" />
              <col className="w-[180px]" />
              <col className="w-[180px]" />
              <col className="w-[88px]" />
              <col className="w-[88px]" />
            </colgroup>
            <thead className="standard-table-thead">
              <tr>
                {SORT_COLUMNS.map((col) => {
                  const sortIdx = sorts.findIndex((s) => s.key === col.key);
                  const active = sortIdx >= 0;
                  const sortDir = active ? sorts[sortIdx].dir : null;
                  const Icon = !active
                    ? ArrowUpDown
                    : sortDir === 'asc'
                      ? ArrowUp
                      : ArrowDown;
                  const initial = initialOccupationLedgerSortDir(col.key);
                  const alignLeft = HEADER_ALIGN_LEFT.has(col.key);
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        'standard-table-th',
                        alignLeft ? 'standard-table-th-left' : 'standard-table-th-center'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'standard-sort-button',
                          alignLeft ? 'standard-sort-button-left' : 'standard-sort-button-center',
                          active && 'standard-sort-button-active'
                        )}
                        title={
                          !active
                            ? `${col.label} 정렬 추가`
                            : sortDir === initial
                              ? `${col.label} 방향 바꾸기`
                              : `${col.label} 정렬 해제`
                        }
                      >
                        <span className="truncate">{col.label}</span>
                        <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={SORT_COLUMNS.length} className="standard-table-empty">
                    {items.length === 0
                      ? '목록이 비어 있습니다. 데이터 적재 후 새로고침하세요.'
                      : '선택한 상태에 해당하는 목록이 없습니다.'}
                  </td>
                </tr>
              ) : (
                filteredItems.map((row: SampleListRow) => {
                  const isSelected = selectedRowKey === row.rowKey;
                  return (
                    <tr
                      key={row.rowKey}
                      data-sample-row={row.rowKey}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRowClick(row.rowKey)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleRowClick(row.rowKey);
                        }
                      }}
                      className={cn('standard-list-row', isSelected && 'standard-list-row-selected')}
                    >
                      <td className="standard-table-td-compact">
                        <span
                          className={cn(
                            'standard-status-badge',
                            row.status === OCCUPATION_PERIOD_STATE_ENDED
                              ? 'standard-status-badge-ended'
                              : 'standard-status-badge-primary'
                          )}
                        >
                          {row.status || OCCUPATION_PERIOD_STATE_IN_PROGRESS}
                        </span>
                      </td>
                      <td className="standard-table-td-text" title={row.name}>
                        {row.name || '-'}
                      </td>
                      <td className="standard-table-td-text-muted" title={row.place}>
                        {row.place || '-'}
                      </td>
                      <td className="standard-table-td-date" title={row.startDate}>
                        {row.startDate || '-'}
                      </td>
                      <td className="standard-table-td-date" title={row.endDate}>
                        {row.endDate || '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer">
          {filteredItems.length.toLocaleString()}건
          {statusFilter ? ` / 전체 ${items.length.toLocaleString()}건` : ''}
        </div>
      </div>
    </div>
  );
}
