'use client'

import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit'
import type { LayerRowParcelItem } from '../../../_mapComponents/layerRowEdit'

/** 7건까지는 높이 증가, 그 이상은 7행 높이로 고정 후 내부 스크롤 */
const MAX_VISIBLE_ROWS = 7
/** py-2 + text-xs 한 줄 기준 대략 2.5rem/행 */
const ROW_HEIGHT_REM = 2.5

type Props = {
  title: string
  isEditing: boolean
  items: LayerRowParcelItem[]
  selectedIdx?: number | null
  /** 목록 행 선택 강조 — 물건지는 yellow */
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
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
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
        <div className="rounded border border-dashed border-slate-200 bg-slate-50/80 px-2 py-3 text-slate-500">
          {isEditing ? emptyHintEdit : emptyHintView}
        </div>
      ) : (
        <ul
          className={cn(
            'list-none space-y-0 rounded border border-slate-200 bg-white',
            items.length > MAX_VISIBLE_ROWS &&
              'overflow-y-auto scrollbar-hide'
          )}
          style={
            items.length > MAX_VISIBLE_ROWS
              ? { maxHeight: `${MAX_VISIBLE_ROWS * ROW_HEIGHT_REM}rem` }
              : undefined
          }
        >
          {items.map((item, i) => {
            const isSelected = selectedIdx === i
            const rowClass = cn(
              'flex items-start gap-1 border-b border-slate-100 px-2 py-2 text-slate-800 last:border-b-0 transition-colors',
              isSelected &&
                (selectionTone === 'yellow' ? 'bg-yellow-100' : 'bg-primary/10')
            )
            const buttonClass = cn(
              'min-w-0 flex-1 text-left text-xs text-slate-800',
              isSelected
                ? selectionTone === 'yellow'
                  ? 'font-medium text-yellow-800'
                  : 'text-primary font-medium'
                : selectionTone === 'yellow'
                  ? 'hover:text-yellow-700'
                  : 'hover:text-primary',
              'disabled:cursor-default disabled:opacity-70'
            )

            return (
              <li
                key={`${title}-${item.wmsRowKey?.keyValue ?? i}-${item.address.slice(0, 24)}`}
                className={rowClass}
              >
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      className={cn(buttonClass, 'flex items-start gap-1')}
                      onClick={() => onClick?.(item, i)}
                      title="클릭 시 위치 이동 및 선택"
                    >
                      <span className="mr-1 shrink-0 tabular-nums text-slate-400">{i + 1}.</span>
                      <span className="min-w-0 flex-1 break-words">{item.address}</span>
                    </button>
                    {onRemove && (
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => onRemove(i)}
                        aria-label="삭제"
                        title="삭제"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => onClick?.(item, i)}
                    title="클릭 시 위치 이동 및 선택"
                  >
                    <span className="mr-2 tabular-nums text-slate-400">{i + 1}.</span>
                    {item.address}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
