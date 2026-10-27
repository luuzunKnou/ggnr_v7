'use client';

import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LayerRowParcelItem } from '../../_mapComponents/layerRowEdit';
import { OccupationLedgerCollapsibleSection } from './OccupationLedgerCollapsibleSection';
import {
  OCCUPATION_PARCEL_LIST_MAX_HEIGHT_CLASS,
  occupationParcelListColumnGridTrack,
  occupationParcelListColumnIsWide,
  occupationParcelListColumnMinPx,
} from './occupationLedgerListWidth';

const actionBtn = 'standard-detail-action-btn inline-flex h-7 items-center gap-1';
const rowIconBtn =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400';

/** 목록 열 — 필드 정의 «목록» 칸 */
export type OccupationLedgerChildColumn = { field: string; label: string };

type Props = {
  title: string;
  isEditing: boolean;
  items: LayerRowParcelItem[];
  /** 필드 정의 «목록» 열. 없으면 주소만 */
  columns: OccupationLedgerChildColumn[];
  selectedIdx: number | null;
  onAdd?: () => void;
  onRemove?: (index: number) => void;
  onClick: (item: LayerRowParcelItem, index: number) => void;
  emptyHintEdit: string;
  emptyHintView: string;
};

/** 필지목록·물건지목록 — 보상편입용지 필지목록과 같은 표. 열은 필드 정의 «목록» 칸 */
export function OccupationLedgerParcelList({
  title,
  isEditing,
  items,
  columns,
  selectedIdx,
  onAdd,
  onRemove,
  onClick,
  emptyHintEdit,
  emptyHintView,
}: Props) {
  const useAddress = columns.length === 0;
  /** 열 최소 폭 = 제목이 다 보이는 폭 (값은 넘치면 «…») */
  const colMins = useAddress
    ? []
    : columns.map((c) => occupationParcelListColumnMinPx(c.label));
  const gridTemplateColumns = [
    '2.25rem',
    ...(useAddress
      ? ['minmax(0,1fr)']
      : columns.map((c) => occupationParcelListColumnGridTrack(c.field, c.label))),
    ...(isEditing ? ['2.5rem'] : []),
  ].join(' ');
  const minWidthPx = 36 + colMins.reduce((sum, px) => sum + px, 0) + (isEditing ? 40 : 0);

  return (
    <OccupationLedgerCollapsibleSection
      title={title}
      count={items.length}
      actions={
        isEditing && onAdd ? (
          <button type="button" className={actionBtn} onClick={onAdd}>
            <Plus className="h-3 w-3" />
            추가
          </button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="rounded border border-dashed border-border bg-muted/40 px-2 py-4 text-center text-[11px] text-muted-foreground">
          {isEditing ? emptyHintEdit : emptyHintView}
        </p>
      ) : (
        <div
          className={cn(
            'w-full overflow-x-auto overflow-y-auto rounded border border-border text-[11px] scrollbar-thin',
            OCCUPATION_PARCEL_LIST_MAX_HEIGHT_CLASS
          )}
        >
          <div style={{ minWidth: useAddress ? undefined : minWidthPx }}>
            <div
              className="grid h-8 items-center border-b border-border bg-muted"
              style={{ gridTemplateColumns }}
            >
              <div className="px-1 text-center font-semibold text-foreground">번호</div>
              {useAddress ? (
                <div className="min-w-0 px-2 text-left font-semibold text-foreground">주소</div>
              ) : (
                columns.map((c) => (
                  <div key={c.field} className="whitespace-nowrap px-2 text-left font-semibold text-foreground">
                    {c.label}
                  </div>
                ))
              )}
              {isEditing ? <div className="px-1 text-center font-semibold text-foreground">관리</div> : null}
            </div>
            {items.map((item, idx) => {
              const selected = selectedIdx === idx;
              const ogcFid = String(item.wmsRowKey?.keyValue ?? '').trim();
              return (
                <div
                  key={`${ogcFid || idx}-${item.address.slice(0, 24)}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onClick(item, idx)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onClick(item, idx);
                    }
                  }}
                  title={isEditing ? '클릭하면 지도에서 위치를 확인합니다' : '클릭하면 상세를 봅니다'}
                  className={cn(
                    'grid min-h-8 cursor-pointer items-center border-b border-border last:border-b-0 hover:bg-muted/50',
                    selected && 'bg-primary/5 text-primary'
                  )}
                  style={{ gridTemplateColumns }}
                >
                  <div className="px-1 text-center tabular-nums text-muted-foreground">{idx + 1}</div>
                  {useAddress ? (
                    <div
                      className="min-w-0 whitespace-normal break-keep px-2 py-1 text-left leading-snug [overflow-wrap:anywhere]"
                      title={item.address}
                    >
                      {item.address || '—'}
                    </div>
                  ) : (
                    columns.map((c) => {
                      const v = String(item.listValues?.[c.field] ?? '').trim();
                      const wide = occupationParcelListColumnIsWide(c.field, c.label);
                      return (
                        <div
                          key={c.field}
                          className={cn(
                            'min-w-0 px-2 py-1 text-left',
                            wide
                              ? 'line-clamp-2 whitespace-normal break-keep leading-snug [overflow-wrap:anywhere]'
                              : 'truncate'
                          )}
                          title={v || undefined}
                        >
                          {v || '—'}
                        </div>
                      );
                    })
                  )}
                  {isEditing ? (
                    <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                      {onRemove ? (
                        <button
                          type="button"
                          onClick={() => onRemove(idx)}
                          className={rowIconBtn}
                          aria-label={`${title} 삭제`}
                          title="삭제"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </OccupationLedgerCollapsibleSection>
  );
}
