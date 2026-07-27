'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { USAGE_EXPIRY_NOTIF_WITHIN_DAYS } from '../river/usageDataAs/usageDataAsExpiryNotifClient'
import type { ProtoNotifItem } from './dummyData'

const NOTIF_ROW =
  'flex items-center gap-2 border-b border-slate-100/80 py-2 pl-4 pr-3 last:border-b-0 hover:bg-slate-50/50'
const BTN_CLEAR =
  'shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] leading-none text-slate-400 hover:text-black'

const NOTIF_CATEGORY = '만료임박' as const

function parseNotifListFields(item: ProtoNotifItem): { useName: string; key: string } {
  if (item.listKey) {
    const matched = item.name.match(/^(\S+)\s+(\S+)\s+(.+)$/)
    if (matched) return { useName: matched[3], key: item.listKey }
    return { useName: item.name, key: item.listKey }
  }

  const matched = item.name.match(/^(\S+)\s+(\S+)\s+(.+)$/)
  if (matched) return { useName: matched[3], key: matched[2] }
  return { useName: item.name, key: '—' }
}

function groupSummary(count: number): string {
  return `점용종료일이 ${USAGE_EXPIRY_NOTIF_WITHIN_DAYS}일 이내인 건이 ${count}건입니다`
}

type Props = {
  items: ProtoNotifItem[]
  onDismiss: (item: ProtoNotifItem) => void
  onDismissAll: () => void
  onMarkRead: (item: ProtoNotifItem) => void
  onOpenLedger: (ledgerId: string) => void
  onClosePanel: () => void
}

export function UserAccountProtoNotifTab({
  items,
  onDismiss,
  onDismissAll,
  onMarkRead,
  onOpenLedger,
  onClosePanel,
}: Props) {
  const [expanded, setExpanded] = useState(true)

  const list = useMemo(
    () => items.filter((item) => item.category === NOTIF_CATEGORY),
    [items]
  )

  const unreadCount = list.filter((n) => !n.read).length

  const openItem = (item: ProtoNotifItem) => {
    onMarkRead(item)
    onOpenLedger(item.targetId)
    onClosePanel()
  }

  if (list.length === 0) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center px-3 py-10 text-center text-xs text-slate-500">
        받은 알림이 없습니다.
      </div>
    )
  }

  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/50 px-3 py-2">
        <span className="text-[11px] text-slate-500">
          총 <span className="font-medium tabular-nums text-slate-700">{list.length}</span>건
          {unreadCount > 0 ? (
            <>
              {' '}
              · 미읽음{' '}
              <span className="font-medium tabular-nums text-red-600">{unreadCount}</span>
            </>
          ) : null}
        </span>
        <button type="button" className={BTN_CLEAR} onClick={onDismissAll}>
          모두 지우기
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto overflow-x-hidden bg-white">
        <NotifGroup
          summary={groupSummary(list.length)}
          expanded={expanded}
          onToggle={() => setExpanded((prev) => !prev)}
        >
          {list.map((item) => (
            <NotifListRow
              key={item.id}
              item={item}
              onOpen={() => openItem(item)}
              onDelete={() => onDismiss(item)}
            />
          ))}
        </NotifGroup>
      </div>
    </>
  )
}

function NotifGroup({
  summary,
  expanded,
  onToggle,
  children,
}: {
  summary: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 bg-white px-3 py-2 text-left transition-colors hover:bg-slate-50/50"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="min-w-0 flex-1 text-left text-xs font-medium leading-snug text-slate-800">
          {summary}
        </span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        )}
      </button>
      {expanded ? (
        <ul className="border-t border-slate-100/80 bg-white pb-1">{children}</ul>
      ) : null}
    </section>
  )
}

function NotifListRow({
  item,
  onOpen,
  onDelete,
}: {
  item: ProtoNotifItem
  onOpen: () => void
  onDelete: () => void
}) {
  const { useName, key } = parseNotifListFields(item)

  return (
    <li className={cn(NOTIF_ROW, item.read ? 'bg-sky-50/30' : 'bg-white')}>
      <span
        className={cn(
          'shrink-0 select-none text-base leading-none',
          item.read ? 'text-slate-300/70' : 'text-slate-400'
        )}
        aria-hidden
      >
        ·
      </span>
      <button
        type="button"
        className="flex min-w-0 max-w-[calc(100%-2rem)] shrink items-center gap-1.5 text-left"
        onClick={onOpen}
        title={`${useName} | ${key}`}
      >
        <span
          className={cn(
            'truncate text-[11px] font-medium leading-snug tracking-tight',
            item.read ? 'text-slate-500/80' : 'text-slate-600'
          )}
        >
          {useName}
        </span>
        <span className="shrink-0 text-slate-300" aria-hidden>
          |
        </span>
        <span
          className={cn(
            'shrink-0 truncate text-[11px] tabular-nums leading-snug',
            item.read ? 'text-slate-400/80' : 'text-slate-500'
          )}
        >
          {key}
        </span>
      </button>
      <span className="min-w-2 flex-1" aria-hidden />
      <button
        type="button"
        className="shrink-0 rounded-sm p-1 text-slate-400 hover:text-black"
        onClick={onDelete}
        aria-label="삭제"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}
