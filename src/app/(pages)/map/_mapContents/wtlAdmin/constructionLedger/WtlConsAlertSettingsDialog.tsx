'use client'

import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { call } from '@/lib/api'
import {
  DEFAULT_CONS_ALERT,
  defaultCycleEnd,
  diffYmd,
  offsetYmd,
  parseYmd,
  type ConsAlertSettings,
} from '@/lib/consAlertSchedule'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'
import { Button } from '@/app/shadcnComponents/ui/button'
import { cn } from '@/lib/utils'

export type WtlConsAlertSettings = ConsAlertSettings
export { DEFAULT_CONS_ALERT }

export const CONS_ALERT_STORAGE_PREFIX = 'wtl-cons-alert-settings'
export const CONS_ALERT_SAVED_EVENT = 'ggnr-cons-alert-saved'

export type StoredConsAlert = WtlConsAlertSettings & { kind?: 'wtl' | 'swl' }

export function loadConsAlertSettings(workId: string): WtlConsAlertSettings {
  try {
    const raw = localStorage.getItem(`${CONS_ALERT_STORAGE_PREFIX}:${workId}`)
    if (!raw) return { ...DEFAULT_CONS_ALERT }
    return { ...DEFAULT_CONS_ALERT, ...(JSON.parse(raw) as Partial<WtlConsAlertSettings>) }
  } catch {
    return { ...DEFAULT_CONS_ALERT }
  }
}

function failMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message
  if (e && typeof e === 'object') {
    const row = e as Record<string, unknown>
    const error = typeof row.error === 'string' ? row.error.trim() : ''
    const message = typeof row.message === 'string' ? row.message.trim() : ''
    const detail = typeof row.detail === 'string' ? row.detail.trim() : ''
    const head = error || message
    if (head && detail && !head.includes(detail)) return `${head} (${detail})`
    if (head) return head
  }
  return fallback
}

function withCycleEndPlaceholder(settings: WtlConsAlertSettings): WtlConsAlertSettings {
  if (parseYmd(settings.cycleEnd)) return settings
  return { ...settings, cycleEnd: defaultCycleEnd() }
}

function asBody(res: unknown): Record<string, unknown> {
  if (res && typeof res === 'object' && 'data' in res && (res as { data?: unknown }).data) {
    return (res as { data: Record<string, unknown> }).data
  }
  return (res ?? {}) as Record<string, unknown>
}

export async function saveConsAlertSettings(
  workId: string,
  settings: WtlConsAlertSettings,
  kind?: 'wtl' | 'swl',
  options?: { notify?: boolean }
) {
  const res = await call('', 'POST', {
    service: 'consAlertService',
    action: 'saveSettings',
    params: { workId, kind, settings },
  })
  const body = asBody(res)
  if (body.ok === false || typeof body.error === 'string') {
    throw new Error(typeof body.error === 'string' ? body.error : '알림설정을 저장하지 못했습니다.')
  }
  try {
    const prev = JSON.parse(
      localStorage.getItem(`${CONS_ALERT_STORAGE_PREFIX}:${workId}`) || '{}'
    ) as StoredConsAlert
    const savedKind = body.kind === 'swl' || body.kind === 'wtl' ? body.kind : kind ?? prev.kind
    const next: StoredConsAlert = { ...settings, kind: savedKind }
    localStorage.setItem(`${CONS_ALERT_STORAGE_PREFIX}:${workId}`, JSON.stringify(next))
  } catch {
    /* 화면 캐시 실패는 서버 저장을 되돌리지 않는다 */
  }
  if (options?.notify !== false) {
    window.dispatchEvent(new CustomEvent(CONS_ALERT_SAVED_EVENT))
  }
}

/** 이 브라우저에 저장된 공사 알림설정 */
export function listStoredConsAlerts(): { workId: string; settings: StoredConsAlert }[] {
  if (typeof localStorage === 'undefined') return []
  const out: { workId: string; settings: StoredConsAlert }[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key?.startsWith(`${CONS_ALERT_STORAGE_PREFIX}:`)) continue
    const workId = key.slice(CONS_ALERT_STORAGE_PREFIX.length + 1).trim()
    if (!workId) continue
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}') as Partial<StoredConsAlert>
      out.push({ workId, settings: { ...DEFAULT_CONS_ALERT, ...parsed } })
    } catch {
      /* skip */
    }
  }
  return out
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  workId: string
  workName: string
  /** 상수도·하수도 구분. 알림 목록이 어느 메뉴로 열지 정한다 */
  kind?: 'wtl' | 'swl'
  startDate?: string
  doneDate?: string
}

export function WtlConsAlertSettingsDialog({
  open,
  onOpenChange,
  workId,
  workName,
  kind,
  startDate,
  doneDate,
}: Props) {
  const [draft, setDraft] = useState<WtlConsAlertSettings>(DEFAULT_CONS_ALERT)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSaveError(null)
    setDraft(withCycleEndPlaceholder(loadConsAlertSettings(workId)))
    void call('', 'POST', {
      service: 'consAlertService',
      action: 'getSettings',
      params: { workId, kind },
    })
      .then((res) => {
        if (cancelled) return
        const body = asBody(res)
        if (body.settings && typeof body.settings === 'object') {
          setDraft(
            withCycleEndPlaceholder({
              ...DEFAULT_CONS_ALERT,
              ...(body.settings as Partial<WtlConsAlertSettings>),
            })
          )
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, workId, kind])

  const setNum = (key: keyof WtlConsAlertSettings, value: string) => {
    const n = Math.max(0, Math.min(9999, Math.floor(Number(value) || 0)))
    setDraft((prev) => ({ ...prev, [key]: n }))
  }

  const setOn = (key: keyof WtlConsAlertSettings, on: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: on }))
  }

  const handleSave = () => {
    const next = { ...draft }
    if (next.cycleOn && next.cycleYears < 1) next.cycleYears = 1
    if (next.cycleOn && !parseYmd(next.cycleEnd)) next.cycleEnd = defaultCycleEnd()
    if (next.cycleOn) {
      const end = parseYmd(next.cycleEnd)
      const done = parseYmd(doneDate)
      if (end && done && diffYmd(done, end) < 0) {
        setSaveError('반복 종료일자는 준공일 이후여야 합니다.')
        return
      }
    }
    setSaving(true)
    setSaveError(null)
    void saveConsAlertSettings(workId, next, kind)
      .then(() => onOpenChange(false))
      .catch((e: unknown) => {
        setSaveError(failMessage(e, '알림설정을 저장하지 못했습니다.'))
      })
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0 sm:max-w-lg" layerZIndex={90}>
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
            <h3 className="text-[11px] font-semibold text-slate-700">알림 반복 주기</h3>
            <label
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-2 text-slate-700',
                !draft.cycleOn && 'opacity-55'
              )}
            >
              <input
                type="checkbox"
                checked={draft.cycleOn}
                aria-label="알림 반복 사용"
                onChange={(e) => {
                  const on = e.target.checked
                  setDraft((prev) => ({
                    ...prev,
                    cycleOn: on,
                    cycleYears: on && prev.cycleYears < 1 ? 1 : prev.cycleYears,
                    cycleEnd: on && !parseYmd(prev.cycleEnd) ? defaultCycleEnd() : prev.cycleEnd,
                  }))
                }}
                className="size-3.5 accent-primary"
              />
              <span className="flex items-center gap-2">
                <NumInput
                  value={draft.cycleYears}
                  onChange={(v) => {
                    const n = Math.max(1, Math.min(9999, Math.floor(Number(v) || 1)))
                    setDraft((prev) => ({ ...prev, cycleYears: n }))
                  }}
                  aria-label="알림 반복 주기(년)"
                />
                <span>년마다 알림</span>
              </span>
              <span className="flex items-center gap-2">
                <span>반복 종료일자</span>
                <input
                  type="date"
                  value={draft.cycleEnd}
                  aria-label="반복 종료일자"
                  onChange={(e) => setDraft((prev) => ({ ...prev, cycleEnd: e.target.value }))}
                  className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[12px] outline-none focus:border-primary disabled:bg-slate-50 disabled:text-slate-400"
                />
              </span>
            </label>
            <p className="text-[10px] text-slate-400">종료일이 없으면 오늘로부터 5년까지 남습니다.</p>
          </section>

          <section className="space-y-2 border-t border-slate-100 pt-3">
            <h3 className="text-[11px] font-semibold text-slate-700">준공일 알림</h3>
            <DayOffsetRow
              label="준공일"
              baseDate={doneDate}
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
            <h3 className="text-[11px] font-semibold text-slate-700">착수일 알림</h3>
            <DayOffsetRow
              label="착수일"
              baseDate={startDate}
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
          {saveError ? <p className="mr-auto text-xs text-red-600">{saveError}</p> : null}
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
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
  baseDate,
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
  baseDate?: string
  beforeOn: boolean
  beforeDays: number
  afterOn: boolean
  afterDays: number
  onBeforeOn: (v: boolean) => void
  onBeforeDays: (v: string) => void
  onAfterOn: (v: boolean) => void
  onAfterDays: (v: string) => void
}) {
  const beforeWhen = offsetYmd(baseDate, -beforeDays)
  const afterWhen = offsetYmd(baseDate, afterDays)
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
        {beforeWhen ? <span className="text-slate-400">({beforeWhen})</span> : null}
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
        {afterWhen ? <span className="text-slate-400">({afterWhen})</span> : null}
      </label>
    </div>
  )
}
