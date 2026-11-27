'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Inbox } from 'lucide-react'
import { call } from '@/lib/api'
import { withBasePathNav } from '@/lib/basePath'
import { cn } from '@/lib/utils'
import {
  getShootingRequests,
  refreshShootingRequests,
  subscribeShootingRequests,
} from '../shootingRequest/shootingRequestMockStore'
import { useShootingRequestUiEnabled } from '../shootingRequest/useShootingRequestUiEnabled'

export type ApproveFilter = 'all' | 'shooting' | 'data' | 'system'

export type ApproveCardItem = {
  id: string
  kind: 'shooting' | 'data' | 'system'
  date: string
  categoryLabel: string
  statusLabel: string
  title: string
  subLine: string
}

type DataNotifRow = {
  notifKey?: string
  kind?: string
  fileGroupKey?: number
  title?: string
  name?: string
  listKey?: string
  target?: string
}

type AccessRow = {
  uarKey?: number
  usrId?: string
  targetType?: string
  serEng?: string | null
  sysKey?: string | null
  state?: string
  createdAt?: string
  requestReason?: string | null
}

type Props = {
  open: boolean
  onSelectShooting: (id: string) => void
  /** 외부에서 건수 동기화 */
  onCountChange?: (count: number) => void
}

function sliceDate(v: string | null | undefined): string {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  return s.slice(0, 10)
}

function accessTitle(row: AccessRow): string {
  const reason = String(row.requestReason ?? '').trim()
  if (reason) return reason
  if (String(row.targetType ?? '') === 'sys') {
    return `시스템 권한 신청 · ${String(row.sysKey ?? '').trim() || '—'}`
  }
  return `기능 권한 신청 · ${String(row.serEng ?? '').trim() || '—'}`
}

export function UserAccountApproveTab({ open, onSelectShooting, onCountChange }: Props) {
  const shootingUiEnabled = useShootingRequestUiEnabled()
  const [filter, setFilter] = useState<ApproveFilter>('all')
  const [shootingItems, setShootingItems] = useState<ApproveCardItem[]>([])
  const [dataItems, setDataItems] = useState<ApproveCardItem[]>([])
  const [systemItems, setSystemItems] = useState<ApproveCardItem[]>([])
  const [loading, setLoading] = useState(false)
  const [countReady, setCountReady] = useState(false)
  const lastCountRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const nextShooting: ApproveCardItem[] = []
      if (shootingUiEnabled) {
        try {
          await refreshShootingRequests('approval', { status: 'pending' })
          const rows = getShootingRequests().filter((r) => r.status === 'pending')
          for (const r of rows) {
            nextShooting.push({
              id: r.id,
              kind: 'shooting',
              date: sliceDate(r.submittedAt),
              categoryLabel: '촬영요청',
              statusLabel: '대기',
              title: String(r.purpose ?? '').trim() || '무인비행장치 촬영신청서',
              subLine: [r.department, r.applicantRankName].filter(Boolean).join('·') || '—',
            })
          }
        } catch {
          /* empty */
        }
      }
      setShootingItems(nextShooting)

      let nextData: ApproveCardItem[] = []
      try {
        const res = await call('', 'POST', {
          service: 'dataRequestService',
          action: 'listDataRequestNotifications',
          params: { withinDays: 15 },
        })
        const payload = (res?.data ?? res) as { items?: DataNotifRow[] }
        const list = Array.isArray(payload?.items) ? payload.items : []
        nextData = list
          .filter(
            (r) =>
              String(r.kind ?? '').trim() === 'pending' ||
              String(r.target ?? '').trim() === 'dataRequestApprove'
          )
          .map((r) => ({
            id: String(r.fileGroupKey ?? r.notifKey ?? ''),
            kind: 'data' as const,
            date: sliceDate(r.listKey),
            categoryLabel: '데이터승인',
            statusLabel: '대기',
            title: String(r.title ?? '').trim() || '데이터 승인 대기',
            subLine: String(r.name ?? '').trim() || '—',
          }))
          .filter((r) => r.id)
      } catch {
        nextData = []
      }
      setDataItems(nextData)

      let nextSystem: ApproveCardItem[] = []
      try {
        const res = await call('', 'POST', {
          service: 'permissionService',
          action: 'listPendingAccessRequests',
          params: {},
        })
        const rows = (res?.data ?? res) as AccessRow[] | { items?: AccessRow[] }
        const list = Array.isArray(rows)
          ? rows
          : Array.isArray((rows as { items?: AccessRow[] })?.items)
            ? (rows as { items: AccessRow[] }).items
            : []
        nextSystem = list
          .filter((r) => String(r.state ?? '').trim() === 'pending')
          .map((r) => ({
            id: String(r.uarKey ?? ''),
            kind: 'system' as const,
            date: sliceDate(r.createdAt),
            categoryLabel: '시스템승인',
            statusLabel: '대기',
            title: accessTitle(r),
            subLine: String(r.usrId ?? '').trim() || '—',
          }))
          .filter((r) => r.id)
      } catch {
        nextSystem = []
      }
      setSystemItems(nextSystem)
      setCountReady(true)
    } finally {
      setLoading(false)
    }
  }, [shootingUiEnabled])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  useEffect(() => {
    if (!open || !shootingUiEnabled) return
    const sync = () => {
      const rows = getShootingRequests().filter((r) => r.status === 'pending')
      setShootingItems(
        rows.map((r) => ({
          id: r.id,
          kind: 'shooting' as const,
          date: sliceDate(r.submittedAt),
          categoryLabel: '촬영요청',
          statusLabel: '대기',
          title: String(r.purpose ?? '').trim() || '무인비행장치 촬영신청서',
          subLine: [r.department, r.applicantRankName].filter(Boolean).join('·') || '—',
        }))
      )
    }
    return subscribeShootingRequests(sync)
  }, [open, shootingUiEnabled])

  const allItems = useMemo(
    () =>
      [...shootingItems, ...dataItems, ...systemItems].sort((a, b) =>
        b.date.localeCompare(a.date)
      ),
    [shootingItems, dataItems, systemItems]
  )

  const visible = useMemo(() => {
    if (filter === 'shooting') return shootingItems
    if (filter === 'data') return dataItems
    if (filter === 'system') return systemItems
    return allItems
  }, [filter, shootingItems, dataItems, systemItems, allItems])

  useEffect(() => {
    if (!countReady) return
    if (lastCountRef.current === allItems.length) return
    lastCountRef.current = allItems.length
    onCountChange?.(allItems.length)
  }, [allItems.length, countReady, onCountChange])

  const chips: { id: ApproveFilter; label: string; count: number; show: boolean }[] = [
    { id: 'all', label: '전체', count: allItems.length, show: allItems.length > 0 },
    {
      id: 'shooting',
      label: '촬영 요청',
      count: shootingItems.length,
      show: shootingUiEnabled && shootingItems.length > 0,
    },
    {
      id: 'data',
      label: '데이터 승인',
      count: dataItems.length,
      show: dataItems.length > 0,
    },
    {
      id: 'system',
      label: '시스템 승인',
      count: systemItems.length,
      show: systemItems.length > 0,
    },
  ]

  const visibleChips = chips.filter((c) => c.show)

  useEffect(() => {
    if (visibleChips.some((c) => c.id === filter)) return
    setFilter('all')
  }, [
    filter,
    allItems.length,
    shootingItems.length,
    dataItems.length,
    systemItems.length,
    shootingUiEnabled,
  ])

  const openItem = (item: ApproveCardItem) => {
    if (item.kind === 'shooting') {
      onSelectShooting(item.id)
      return
    }
    if (item.kind === 'data') {
      window.location.assign(withBasePathNav('/data-request-approve'))
      return
    }
    try {
      window.localStorage.setItem('sysManagerConsoleMenu:selectedMenu', 'accessRequestQueue')
    } catch {
      /* ignore */
    }
    window.location.assign(withBasePathNav('/sysManager'))
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {visibleChips.length > 0 ? (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border bg-[#FAFAFA] px-2.5 py-2">
          {visibleChips.map((c) => {
            const active = filter === c.id
            return (
              <button
                key={c.id}
                type="button"
                title={`${c.label} ${c.count}`}
                onClick={() => setFilter(c.id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-[4px] border p-[4px] text-[11px] font-medium transition-colors',
                  active
                    ? 'border-black bg-black text-white'
                    : 'border-border bg-background text-[#8A8A8A] hover:bg-muted/50'
                )}
              >
                {c.label}
                <span className="tabular-nums">{c.count}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-[10px]">
        {loading && visible.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-center text-xs text-muted-foreground">
            불러오는 중…
          </p>
        ) : visible.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <Inbox className="h-8 w-8 text-[#B3B3B3]" strokeWidth={1} aria-hidden />
            <p className="text-[10px] font-normal text-[#8A8A8A]">승인요청이 없습니다.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <button
                  type="button"
                  title={item.title}
                  onClick={() => openItem(item)}
                  className="flex w-full flex-col gap-[6px] rounded border border-[#E3E3E3] bg-background p-2.5 text-left hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 text-[12px] text-[#B3B3B3]">{item.date}</span>
                      <span className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium text-[#0F91B2] bg-[#C7E9F2]/62">
                        {item.categoryLabel}
                      </span>
                    </div>
                    <span className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium text-[#973C00] bg-[#FEE685]/46">
                      {item.statusLabel}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[12px] text-black">{item.title}</span>
                    <span className="truncate text-[10px] text-[#B3B3B3]">{item.subLine}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
