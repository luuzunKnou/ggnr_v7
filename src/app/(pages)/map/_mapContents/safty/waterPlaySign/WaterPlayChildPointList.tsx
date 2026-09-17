'use client';

import { MapPin, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit';
import type { WaterPlayChildPoint } from '@/service/waterPlaySignService';

type Props = {
  title: string;
  items: WaterPlayChildPoint[];
  isEditing: boolean;
  adding: boolean;
  movingIdx: number | null;
  onAdd: () => void;
  onRemove: (item: WaterPlayChildPoint) => void;
  onItemClick: (item: WaterPlayChildPoint, idx: number) => void;
};

/** 점용대장 필지목록과 같은 위치 카드 목록 — 구조함·표지판 */
export function WaterPlayChildPointList({
  title,
  items,
  isEditing,
  adding,
  movingIdx,
  onAdd,
  onRemove,
  onItemClick,
}: Props) {
  return (
    <div className="px-3 pb-3 pt-4">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-muted-foreground">
          {title}
          {items.length > 0 ? (
            <span className="ml-1 font-normal">({items.length})</span>
          ) : null}
        </div>
        {isEditing ? (
          <LayerRowPanelButton className="h-6 px-2 text-[10px]" onClick={onAdd}>
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            {adding ? '찍는 중' : '추가'}
          </LayerRowPanelButton>
        ) : null}
      </div>
      {items.length === 0 ? (
        <div className="shrink-0 rounded border border-border bg-muted/30 px-3 py-4 text-center">
          <MapPin
            className="mx-auto mb-1.5 h-4 w-4 text-muted-foreground/60"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {isEditing
              ? adding
                ? '지도를 클릭해 위치를 지정하세요.'
                : '「추가」로 지도에 점을 찍을 수 있습니다.'
              : '등록된 위치가 없습니다.'}
          </p>
        </div>
      ) : (
        <ul className="list-none space-y-1.5">
          {items.map((item, i) => {
            const isSelected = movingIdx === i;
            return (
              <li key={item.fid}>
                <div className="flex items-stretch gap-1">
                  <button
                    type="button"
                    className={cn(
                      'flex min-h-[40px] min-w-0 flex-1 items-center justify-start gap-1.5 rounded border px-1.5 py-1.5 text-left text-[11px] font-medium leading-tight transition-colors',
                      isSelected
                        ? 'border-primary/40 bg-primary/5 text-primary'
                        : 'border-border bg-background text-foreground hover:bg-muted/50'
                    )}
                    onClick={() => onItemClick(item, i)}
                    title="클릭 시 위치 이동"
                  >
                    <MapPin
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <span className="min-w-0 break-words">
                      {item.addr && item.addr !== '-' ? item.addr : '위치'}
                    </span>
                  </button>
                  {isEditing ? (
                    <button
                      type="button"
                      className="inline-flex h-[40px] w-8 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onRemove(item)}
                      aria-label="삭제"
                      title="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
