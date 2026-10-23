'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WtlOutageCustomer } from './wtlOutageSample'

export type WtlOutageSmsPayload = {
  title: string
  reason: string
  startAt: string
  endAt: string
  body: string
  count: number
  selectedIds: string[]
}

type Props = {
  customers: WtlOutageCustomer[]
  defaultTitle?: string
  defaultReason?: string
  defaultStart?: string
  defaultEnd?: string
  onClose: () => void
  onSaveSettings: (payload: WtlOutageSmsPayload) => void
  onSend: (payload: WtlOutageSmsPayload) => void
}

function buildDefaultBody(title: string, reason: string, startAt: string, endAt: string) {
  const head = title.trim() || '(제목 없음)'
  const why = reason.trim() || '(사유 미입력)'
  const from = startAt.trim() || '(시작)'
  const to = endAt.trim() || '(종료)'
  return `${head}\n${why}로 ${from} ~ ${to} 단수가 예정되어 안내드립니다.`
}

export function WtlOutageSmsModal({
  customers,
  defaultTitle = '[의성군] 단수 안내',
  defaultReason = '',
  defaultStart = '',
  defaultEnd = '',
  onClose,
  onSaveSettings,
  onSend,
}: Props) {
  const [title, setTitle] = useState(defaultTitle)
  const [reason, setReason] = useState(defaultReason)
  const [startAt, setStartAt] = useState(defaultStart)
  const [endAt, setEndAt] = useState(defaultEnd)
  const [body, setBody] = useState(() =>
    buildDefaultBody(defaultTitle, defaultReason, defaultStart, defaultEnd)
  )
  const [bodyTouched, setBodyTouched] = useState(false)

  const withPhone = useMemo(() => customers.filter((c) => c.phone.trim()), [customers])
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(withPhone.map((c) => c.id))
  )

  const syncBodyFromFields = (next: {
    title?: string
    reason?: string
    startAt?: string
    endAt?: string
  }) => {
    if (bodyTouched) return
    setBody(
      buildDefaultBody(
        next.title ?? title,
        next.reason ?? reason,
        next.startAt ?? startAt,
        next.endAt ?? endAt
      )
    )
  }

  const selectedWithPhone = useMemo(
    () => withPhone.filter((c) => selected.has(c.id)),
    [withPhone, selected]
  )

  const allPhoneSelected =
    withPhone.length > 0 && withPhone.every((c) => selected.has(c.id))
  const somePhoneSelected = withPhone.some((c) => selected.has(c.id))

  const toggleAll = () => {
    if (allPhoneSelected) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(withPhone.map((c) => c.id)))
  }

  const toggleOne = (id: string, hasPhone: boolean) => {
    if (!hasPhone) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const timeInvalid = Boolean(startAt && endAt && startAt > endAt)
  const canSave = Boolean(reason.trim() && startAt && endAt && !timeInvalid)
  const canSend = Boolean(title.trim() && body.trim() && canSave && selectedWithPhone.length > 0)

  const payload = (): WtlOutageSmsPayload => ({
    title: title.trim(),
    reason: reason.trim(),
    startAt,
    endAt,
    body: body.trim(),
    count: selectedWithPhone.length,
    selectedIds: selectedWithPhone.map((c) => c.id),
  })

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
      <div className="flex h-[min(90vh,640px)] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-lg">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-foreground">문자발송</span>
          <button type="button" className="standard-panel-close" onClick={onClose} aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          {/* 내용 작성 */}
          <div className="min-h-0 space-y-2.5 overflow-auto border-b border-border px-3 py-3 text-xs md:border-b-0 md:border-r">
            <p className="text-[11px] font-semibold text-foreground">내용 작성</p>
            <label className="block space-y-1">
              <span className="text-muted-foreground">제목</span>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  syncBodyFromFields({ title: e.target.value })
                }}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground">단수사유</span>
              <input
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value)
                  syncBodyFromFields({ reason: e.target.value })
                }}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-muted-foreground">시작</span>
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => {
                    setStartAt(e.target.value)
                    syncBodyFromFields({ startAt: e.target.value })
                  }}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">종료</span>
                <input
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => {
                    setEndAt(e.target.value)
                    syncBodyFromFields({ endAt: e.target.value })
                  }}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none"
                />
              </label>
            </div>
            {timeInvalid && (
              <p className="text-[11px] text-rose-600">시작 시간이 종료보다 늦을 수 없습니다.</p>
            )}
            <label className="block space-y-1">
              <span className="text-muted-foreground">문자 내용</span>
              <textarea
                value={body}
                rows={7}
                onChange={(e) => {
                  setBodyTouched(true)
                  setBody(e.target.value)
                }}
                className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-[11px] leading-relaxed text-foreground outline-none"
              />
            </label>
            <p className="text-[10px] text-muted-foreground">
              {body.length}자 · 제목·사유·시간을 바꾸면 내용이 자동 갱신됩니다(직접 수정 시 유지).
            </p>
          </div>

          {/* 수용가 선택 */}
          <div className="flex min-h-0 flex-col px-3 py-3 text-xs">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-foreground">
                발송 대상{' '}
                <span className="font-normal text-muted-foreground">
                  {selectedWithPhone.length}/{withPhone.length}명
                  {customers.length - withPhone.length > 0
                    ? ` · 연락처 없음 ${customers.length - withPhone.length}`
                    : ''}
                </span>
              </p>
              <button
                type="button"
                disabled={withPhone.length === 0}
                className="rounded border border-border px-2 py-0.5 text-[10px] font-medium disabled:opacity-40 hover:bg-muted"
                onClick={toggleAll}
              >
                {allPhoneSelected ? '전체해제' : '전체선택'}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
              {customers.length === 0 ? (
                <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                  수용가 목록이 없습니다.
                </p>
              ) : (
                <table className="w-full table-fixed border-collapse text-left text-[11px]">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="border-b border-border">
                      <th className="w-8 px-1.5 py-1.5">
                        <input
                          type="checkbox"
                          checked={allPhoneSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = !allPhoneSelected && somePhoneSelected
                          }}
                          disabled={withPhone.length === 0}
                          onChange={toggleAll}
                          aria-label="전체 선택"
                        />
                      </th>
                      <th className="w-[22%] px-1.5 py-1.5 font-medium text-muted-foreground">수용가</th>
                      <th className="px-1.5 py-1.5 font-medium text-muted-foreground">주소</th>
                      <th className="w-[28%] px-1.5 py-1.5 font-medium text-muted-foreground">연락처</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((row) => {
                      const hasPhone = Boolean(row.phone.trim())
                      const checked = selected.has(row.id)
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            'border-b border-border',
                            hasPhone ? 'cursor-pointer hover:bg-primary/5' : 'opacity-50',
                            checked && hasPhone && 'bg-primary/[0.06]'
                          )}
                          onClick={() => toggleOne(row.id, hasPhone)}
                        >
                          <td className="px-1.5 py-1.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={checked && hasPhone}
                              disabled={!hasPhone}
                              onChange={() => toggleOne(row.id, hasPhone)}
                              aria-label={`${row.name} 선택`}
                            />
                          </td>
                          <td className="truncate px-1.5 py-1.5 text-foreground">{row.name}</td>
                          <td className="truncate px-1.5 py-1.5 text-muted-foreground">{row.address}</td>
                          <td className="truncate px-1.5 py-1.5 text-foreground">
                            {row.phone.trim() || '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            선택 {selectedWithPhone.length}명에게 발송합니다.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
              onClick={onClose}
            >
              취소
            </button>
            <button
              type="button"
              disabled={!canSave}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
              onClick={() => onSaveSettings(payload())}
            >
              설정저장
            </button>
            <button
              type="button"
              disabled={!canSend}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              onClick={() => onSend(payload())}
            >
              발송 ({selectedWithPhone.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
