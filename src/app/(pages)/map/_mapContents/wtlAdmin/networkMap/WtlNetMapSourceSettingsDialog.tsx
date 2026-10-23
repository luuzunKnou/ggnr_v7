'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronUp, RotateCcw, Settings, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'
import { cn } from '@/lib/utils'
import {
  applyWtlNetMapSourceUiSettings,
  compareWtlNetMapGroupNames,
  getWtlNetMapSource,
  getWtlNetMapSources,
} from './wtlNetworkMapSources'

const STORAGE_KEY = 'wtl-network-map-source-settings'

export type WtlNetMapSourceUiSettings = {
  order: string[]
  visible: string[]
}

export function loadWtlNetMapSourceUiSettings(): WtlNetMapSourceUiSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WtlNetMapSourceUiSettings>
    return {
      order: Array.isArray(parsed.order) ? parsed.order.map(String) : [],
      visible: Array.isArray(parsed.visible) ? parsed.visible.map(String) : [],
    }
  } catch {
    return null
  }
}

export function saveWtlNetMapSourceUiSettings(settings: WtlNetMapSourceUiSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* ignore */
  }
}

export function resolveVisibleWtlNetMapSources(availableIds: readonly string[]): string[] {
  return applyWtlNetMapSourceUiSettings(availableIds, loadWtlNetMapSourceUiSettings())
}

type DraftRow = { id: string; label: string; visible: boolean }

function buildDraft(availableIds: readonly string[]): DraftRow[] {
  const saved = loadWtlNetMapSourceUiSettings()
  const ordered = applyWtlNetMapSourceUiSettings(availableIds, {
    order: saved?.order ?? [],
    visible: availableIds.slice(),
  })
  const visibleSet = new Set(
    saved && Array.isArray(saved.visible) && saved.visible.length > 0
      ? saved.visible
      : availableIds
  )
  const labelById = new Map(getWtlNetMapSources().map((s) => [s.id, s.label]))
  return ordered.map((id) => ({
    id,
    label: labelById.get(id) ?? getWtlNetMapSource(id)?.label ?? id,
    visible: visibleSet.has(id),
  }))
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableIds: readonly string[]
  onSaved: (visibleIds: string[]) => void
}

export function WtlNetMapSourceSettingsDialog({
  open,
  onOpenChange,
  availableIds,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<DraftRow[]>([])

  useEffect(() => {
    if (!open) return
    setDraft(buildDraft(availableIds))
  }, [open, availableIds])

  const move = (index: number, dir: -1 | 1) => {
    setDraft((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      const tmp = next[index]!
      next[index] = next[target]!
      next[target] = tmp
      return next
    })
  }

  const toggleVisible = (id: string) => {
    setDraft((prev) =>
      prev.map((row) => (row.id === id ? { ...row, visible: !row.visible } : row))
    )
  }

  const handleReset = () => {
    const sorted = [...availableIds].sort(compareWtlNetMapGroupNames)
    setDraft(
      sorted.map((id) => ({
        id,
        label: getWtlNetMapSource(id)?.label ?? id,
        visible: true,
      }))
    )
  }

  const handleSave = () => {
    const order = draft.map((r) => r.id)
    let visible = draft.filter((r) => r.visible).map((r) => r.id)
    if (visible.length === 0) visible = order.slice(0, 1)
    const settings: WtlNetMapSourceUiSettings = { order, visible }
    saveWtlNetMapSourceUiSettings(settings)
    onSaved(applyWtlNetMapSourceUiSettings(availableIds, settings))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-0 p-0 sm:max-w-sm" layerZIndex={90}>
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-1.5 text-sm font-semibold">
            <Settings className="h-4 w-4" style={{ color: '#c8c8c8' }} aria-hidden />
            관망도 그룹 설정
          </DialogTitle>
          <p className="text-[11px] font-normal text-muted-foreground">
            표시 여부와 순서를 지정합니다. 저장 값은 이 브라우저에 보관됩니다.
          </p>
        </DialogHeader>

        <ul className="max-h-[50vh] space-y-1 overflow-y-auto px-3 py-2">
          {draft.map((row, index) => (
            <li
              key={row.id}
              className="flex items-center gap-1 rounded border border-border bg-muted/20 px-2 py-1.5"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={row.visible}
                  onChange={() => toggleVisible(row.id)}
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer"
                />
                <span className="truncate" title={row.label}>
                  {row.label}
                </span>
              </label>
              <button
                type="button"
                className={cn(
                  'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted',
                  index === 0 && 'opacity-40'
                )}
                title="위로"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                className={cn(
                  'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted',
                  index >= draft.length - 1 && 'opacity-40'
                )}
                title="아래로"
                disabled={index >= draft.length - 1}
                onClick={() => move(index, 1)}
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
          {draft.length === 0 ? (
            <li className="px-1 py-3 text-center text-[11px] text-muted-foreground">
              표시할 그룹이 없습니다.
            </li>
          ) : null}
        </ul>

        <DialogFooter className="border-t border-border px-3 py-2 sm:justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex cursor-pointer items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            title="초기화"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            초기화
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex cursor-pointer items-center gap-1 rounded-sm border border-foreground bg-foreground px-2 py-1 text-[11px] text-background"
              title="확인"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              확인
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              title="취소"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              취소
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
