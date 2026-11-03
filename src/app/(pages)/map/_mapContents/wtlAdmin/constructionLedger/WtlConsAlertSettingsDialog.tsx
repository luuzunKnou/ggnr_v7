'use client'

import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'
import { Button } from '@/app/shadcnComponents/ui/button'
import { cn } from '@/lib/utils'

export type WtlConsAlertSettings = {
  /** 알림 주기(년). 0이면 미사용 */
  cycleYears: number
  doneBeforeDays: number
  doneBeforeOn: boolean
  doneAfterDays: number
  doneAfterOn: boolean
  startBeforeDays: number
  startBeforeOn: boolean
  startAfterDays: number
  startAfterOn: boolean
}

export const DEFAULT_CONS_ALERT: WtlConsAlertSettings = {
  cycleYears: 1,
  doneBeforeDays: 30,
  doneBeforeOn: true,
  doneAfterDays: 7,
  doneAfterOn: false,
  startBeforeDays: 14,
  startBeforeOn: true,
  startAfterDays: 7,
  startAfterOn: false,
}

const STORAGE_KEY = 'wtl-cons-alert-settings'

export function loadConsAlertSettings(workId: string): WtlConsAlertSettings {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${workId}`)
    if (!raw) return { ...DEFAULT_CONS_ALERT }
    return { ...DEFAULT_CONS_ALERT, ...(JSON.parse(raw) as Partial<WtlConsAlertSettings>) }
  } catch {
    return { ...DEFAULT_CONS_ALERT }
  }
}

export function saveConsAlertSettings(workId: string, settings: WtlConsAlertSettings) {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${workId}`, JSON.stringify(settings))
  } catch {
    /* ignore */
  }
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  workId: string
  workName: string
  startDate?: string
  doneDate?: string
}

export function WtlConsAlertSettingsDialog({
  open,
  onOpenChange,
  workId,
  workName,
  startDate,
  doneDate,
}: Props) {
  const [draft, setDraft] = useState<WtlConsAlertSettings>(DEFAULT_CONS_ALERT)

  useEffect(() => {
    if (!open) return
    setDraft(loadConsAlertSettings(workId))
  }, [open, workId])

  const setNum = (key: keyof WtlConsAlertSettings, value: string) => {
    const n = Math.max(0, Math.min(9999, Math.floor(Number(value) || 0)))
    setDraft((prev) => ({ ...prev, [key]: n }))
  }

  const setOn = (key: keyof WtlConsAlertSettings, on: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: on }))
  }

  const handleSave = () => {
    saveConsAlertSettings(workId, draft)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0 sm:max-w-md" layerZIndex={90}>
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-1.5 text-sm font-semibold">
            <Bell className="h-4 w-4 text-primary" aria-hidden />
            알림설정
          </DialogTitle>
          <p className="truncate text-[11px] font-normal text-muted-foreground" title={workName}>
            {workName}
          </p>
        </DialogHeader>

        <div className="space-y-4 px-4 py-3 text-[12px]">
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold text-slate-700">알림 주기</h3>
            <label className="flex items-center gap-2 text-slate-700">
              <NumInput
                value={draft.cycleYears}
                onChange={(v) => setNum('cycleYears', v)}
                aria-label="알림 주기(년)"
              />
              <span>년마다 알림</span>
            </label>
            <p className="text-[10px] text-slate-400">0년이면 주기 알림을 사용하지 않습니다.</p>
          </section>

          <section className="space-y-2 border-t border-slate-100 pt-3">
            <h3 className="text-[11px] font-semibold text-slate-700">
              준공일 알림
              {doneDate ? (
                <span className="ml-1 font-normal text-slate-400">({doneDate || '—'})</span>
              ) : null}
            </h3>
            <DayOffsetRow
              label="준공일"
              beforeOn={draft.doneBeforeOn}
              beforeDays={draft.doneBeforeDays}
              afterOn={draft.doneAfterOn}
              afterDays={draft.doneAfterDays}
              onBeforeOn={(v) => setOn('doneBeforeOn', v)}
              onBeforeDays={(v) => setNum('doneBeforeDays', v)}
              onAfterOn={(v) => setOn('doneAfterOn', v)}
              onAfterDays={(v) => setNum('doneAfterDays', v)}
            />
          </section>

          <section className="space-y-2 border-t border-slate-100 pt-3">
            <h3 className="text-[11px] font-semibold text-slate-700">
              착수일 알림
              {startDate ? (
                <span className="ml-1 font-normal text-slate-400">({startDate || '—'})</span>
              ) : null}
            </h3>
            <DayOffsetRow
              label="착수일"
              beforeOn={draft.startBeforeOn}
              beforeDays={draft.startBeforeDays}
              afterOn={draft.startAfterOn}
              afterDays={draft.startAfterDays}
              onBeforeOn={(v) => setOn('startBeforeOn', v)}
              onBeforeDays={(v) => setNum('startBeforeDays', v)}
              onAfterOn={(v) => setOn('startAfterOn', v)}
              onAfterDays={(v) => setNum('startAfterDays', v)}
            />
          </section>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-4 py-3 sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NumInput({
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  value: number
  onChange: (v: string) => void
  'aria-label'?: string
}) {
  return (
    <input
      type="number"
      min={0}
      max={9999}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-14 rounded border border-slate-200 bg-white px-1.5 text-center text-[12px] tabular-nums outline-none focus:border-primary"
    />
  )
}

function DayOffsetRow({
  label,
  beforeOn,
  beforeDays,
  afterOn,
  afterDays,
  onBeforeOn,
  onBeforeDays,
  onAfterOn,
  onAfterDays,
}: {
  label: string
  beforeOn: boolean
  beforeDays: number
  afterOn: boolean
  afterDays: number
  onBeforeOn: (v: boolean) => void
  onBeforeDays: (v: string) => void
  onAfterOn: (v: boolean) => void
  onAfterDays: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <label className={cn('flex flex-wrap items-center gap-1.5', !beforeOn && 'opacity-55')}>
        <input
          type="checkbox"
          checked={beforeOn}
          onChange={(e) => onBeforeOn(e.target.checked)}
          className="size-3.5 accent-primary"
        />
        <span>{label}</span>
        <NumInput value={beforeDays} onChange={onBeforeDays} aria-label={`${label} n일 전`} />
        <span>일 전 알림</span>
      </label>
      <label className={cn('flex flex-wrap items-center gap-1.5', !afterOn && 'opacity-55')}>
        <input
          type="checkbox"
          checked={afterOn}
          onChange={(e) => onAfterOn(e.target.checked)}
          className="size-3.5 accent-primary"
        />
        <span>{label}</span>
        <NumInput value={afterDays} onChange={onAfterDays} aria-label={`${label} n일 후`} />
        <span>일 후 알림</span>
      </label>
    </div>
  )
}
