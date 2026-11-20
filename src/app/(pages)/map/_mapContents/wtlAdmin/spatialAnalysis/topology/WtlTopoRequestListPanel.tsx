'use client'

import { useMemo, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WtlTopoChangeRequest } from './wtlTopologySample'

const STATUS_FILTERS = ['전체', '요청', '즉시반영', '실패'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

type Props = {
  requests: WtlTopoChangeRequest[]
  /** 항목을 누르면 해당 오류를 선택한다 (지도 편집으로 남긴 항목은 오류가 없음) */
  onSelectIssue: (issueId: string) => void
  /** 지금 검증 결과에 있는 오류인지 — 없으면 이동 버튼을 숨긴다 */
  hasIssue: (issueId: string) => boolean
  onClose: () => void
}

/**
 * 위상검증 수정·요청 목록 — 다른 메뉴의 상세처럼 공간분석 패널 오른쪽에 붙는 패널의 내용.
 * (패널 틀·너비 조절은 WtlSpatialAnalysisShell의 MapSideListPanel)
 */
export function WtlTopoRequestListPanel({ requests, onSelectIssue, hasIssue, onClose }: Props) {
  const [filter, setFilter] = useState<StatusFilter>('전체')
  const [openId, setOpenId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { 전체: requests.length, 요청: 0, 즉시반영: 0, 실패: 0 }
    for (const r of requests) c[r.status] += 1
    return c
  }, [requests])

  const rows = useMemo(
    () => (filter === '전체' ? requests : requests.filter((r) => r.status === filter)),
    [requests, filter]
  )

  return (
    <div className="standard-panel-root">
      {/* 다른 메뉴 상세 패널과 같은 머리글 */}
      <div className="standard-panel-header">
        <span className="standard-panel-title">요청 목록</span>
        <button type="button" className="standard-panel-close" onClick={onClose} aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex shrink-0 gap-1 border-b border-border px-3 py-2" role="tablist" aria-label="상태">
        {STATUS_FILTERS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={filter === name}
            onClick={() => setFilter(name)}
            className={cn(
              'h-7 min-w-0 flex-1 truncate rounded-md px-1 text-[11px] font-medium transition-colors',
              filter === name
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {name} {counts[name]}
          </button>
        ))}
      </div>

      <div className="standard-list-scroll min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            {requests.length === 0 ? '아직 수정·요청 이력이 없습니다.' : '이 상태의 항목이 없습니다.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const open = openId === r.id
              const linked = hasIssue(r.issueId)
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : r.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-primary/5',
                      open && 'bg-primary/5'
                    )}
                  >
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                        r.status === '요청'
                          ? 'bg-amber-100 text-amber-800'
                          : r.status === '즉시반영'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                      )}
                    >
                      {r.status}
                    </span>
                    <span className="shrink-0 font-medium text-foreground">{r.actionLabel}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground" title={r.issueTarget}>
                      {r.issueTarget}
                    </span>
                    {r.files.length > 0 && (
                      <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground" title={`첨부 ${r.files.length}개`}>
                        <Paperclip className="h-3 w-3" aria-hidden />
                        {r.files.length}
                      </span>
                    )}
                    <span className="shrink-0 tabular-nums text-muted-foreground">{r.at.slice(5)}</span>
                  </button>
                  {open && (
                    <div className="space-y-1.5 bg-muted/30 px-3 pb-2.5 pt-1 text-[11px]">
                      <p className="whitespace-pre-wrap text-foreground">{r.memo || '(메모 없음)'}</p>
                      {r.message && <p className="text-muted-foreground">{r.message}</p>}
                      {r.files.length > 0 && (
                        <ul className="space-y-0.5">
                          {r.files.map((f, i) => (
                            <li key={`${f.name}-${i}`} className="truncate text-muted-foreground">
                              {f.dataUrl ? (
                                <a href={f.dataUrl} download={f.name} className="underline hover:text-foreground">
                                  {f.name}
                                </a>
                              ) : (
                                f.name
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <span className="text-muted-foreground">
                          {r.at} · {r.applyMode === 'immediate' ? '즉시수정' : '반영요청'}
                        </span>
                        {linked && (
                          <button
                            type="button"
                            onClick={() => onSelectIssue(r.issueId)}
                            className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
                          >
                            오류 보기
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <p className="shrink-0 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        지금은 이 화면에서만 보관됩니다 · 새로고침하면 사라집니다
      </p>
    </div>
  )
}
