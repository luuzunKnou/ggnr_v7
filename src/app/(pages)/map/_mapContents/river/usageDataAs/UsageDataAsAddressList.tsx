'use client'

import { MapPin, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit'
import type { LayerRowParcelItem } from '../../../_mapComponents/layerRowEdit'

/** 카드 7개까지는 높이 증가, 그 이상은 고정 후 내부 스크롤 */
const MAX_VISIBLE_CARDS = 7
const CARD_STACK_REM = 3.1

type Props = {
  title: string
  isEditing: boolean
  items: LayerRowParcelItem[]
  selectedIdx?: number | null
  /** 목록 행 선택 강조 — primary(파랑) / yellow */
  selectionTone?: 'primary' | 'yellow'
  onAdd?: () => void
  onRemove?: (index: number) => void
  onClick?: (item: LayerRowParcelItem, index: number) => void
  emptyHintEdit?: string
  emptyHintView?: string
}

export function UsageDataAsAddressList({
  title,
  isEditing,
  items,
  selectedIdx = null,
  selectionTone = 'primary',
  onAdd,
  onRemove,
  onClick,
  emptyHintEdit = '「추가」로 등록합니다.',
  emptyHintView = '등록된 항목이 없습니다.',
}: Props) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
        <div className="flex shrink-0 items-center gap-1">
          {isEditing && onAdd && (
            <LayerRowPanelButton className="h-6 px-2 text-[10px]" onClick={onAdd}>
              <Plus className="h-3 w-3 shrink-0" aria-hidden />
              추가
            </LayerRowPanelButton>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-muted/50 px-2 py-3 text-muted-foreground">
          {isEditing ? emptyHintEdit : emptyHintView}
        </div>
      ) : (
        <ul
          className={cn(
            'list-none space-y-1.5',
            items.length > MAX_VISIBLE_CARDS && 'overflow-y-auto scrollbar-hide pr-0.5'
          )}
          style={
            items.length > MAX_VISIBLE_CARDS
              ? { maxHeight: `${MAX_VISIBLE_CARDS * CARD_STACK_REM}rem` }
              : undefined
          }
        >
          {items.map((item, i) => {
            const isSelected = selectedIdx === i
            const cardClass = cn(
              'flex min-h-[40px] w-full items-center justify-start gap-1.5 rounded border bg-background px-1.5 py-1.5 text-left text-[11px] font-medium leading-tight transition-colors',
              isSelected
                ? selectionTone === 'yellow'
                  ? 'border-yellow-300 bg-yellow-50 text-yellow-900'
                  : 'border-primary/40 bg-primary/5 text-primary'
                : 'border-border text-foreground hover:bg-muted/50'
            )

            return (
              <li key={`${title}-${item.wmsRowKey?.keyValue ?? i}-${item.address.slice(0, 24)}`}>
                <div className="flex items-stretch gap-1">
                  <button
                    type="button"
                    className={cn(cardClass, 'min-w-0 flex-1')}
                    onClick={() => onClick?.(item, i)}
                    title="클릭 시 위치 이동 및 선택"
                  >
                    <MapPin
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <span className="min-w-0 break-words">{item.address}</span>
                  </button>
                  {isEditing && onRemove ? (
                    <button
                      type="button"
                      className="inline-flex h-[40px] w-8 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onRemove(i)}
                      aria-label="삭제"
                      title="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
