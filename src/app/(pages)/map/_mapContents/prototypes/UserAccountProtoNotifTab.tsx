'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BIZ_NOTIF_WITHIN_DAYS } from '../bizNotif/bizNotifClient'
import type { ProtoNotifItem } from '../bizNotif/bizNotifStore'

const NOTIF_ROW =
  'flex items-center gap-2 border-b border-border/80 py-2 pl-4 pr-3 last:border-b-0 hover:bg-muted/50'
const BTN_CLEAR =
  'shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground hover:text-black'

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

type Props = {
  items: ProtoNotifItem[]
  onDismiss: (item: ProtoNotifItem) => void
  onDismissAll: () => void
  onMarkRead: (item: ProtoNotifItem) => void
  onOpenLedger: (item: ProtoNotifItem) => void
  onOpenFee: (feeId: string) => void
  onClosePanel: () => void
}

export function UserAccountProtoNotifTab({
  items,
  onDismiss,
  onDismissAll,
  onMarkRead,
  onOpenLedger,
  onOpenFee,
  onClosePanel,
}: Props) {
  const [expiryExpanded, setExpiryExpanded] = useState(true)
  const [feeExpanded, setFeeExpanded] = useState(true)

  const expiryList = useMemo(
    () => items.filter((item) => item.category === '만료임박'),
    [items]
  )
  const feeList = useMemo(
    () => items.filter((item) => item.category === '미납임박'),
    [items]
  )

  const totalCount = expiryList.length + feeList.length
  const unreadCount = items.filter((n) => !n.read).length

  const openItem = (item: ProtoNotifItem) => {
    onMarkRead(item)
    if (item.target === 'fee') onOpenFee(item.targetId)
    else onOpenLedger(item)
    onClosePanel()
  }

  if (totalCount === 0) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center px-3 py-10 text-center text-xs text-muted-foreground">
        받은 알림이 없습니다.
      </div>
    )
  }

  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/50 px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          총 <span className="font-medium tabular-nums text-foreground">{totalCount}</span>건
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

      <div className="scrollbar-thin min-h-0 flex-1 divide-y divide-border overflow-y-auto overflow-x-hidden bg-background">
        {expiryList.length > 0 ? (
          <NotifGroup
            summary={`점용종료일이 ${BIZ_NOTIF_WITHIN_DAYS}일 이내인 건이 ${expiryList.length}건입니다`}
            expanded={expiryExpanded}
            onToggle={() => setExpiryExpanded((prev) => !prev)}
          >
            {expiryList.map((item) => (
              <NotifListRow
                key={item.id}
                item={item}
                onOpen={() => openItem(item)}
                onDelete={() => onDismiss(item)}
              />
            ))}
          </NotifGroup>
        ) : null}

        {feeList.length > 0 ? (
          <NotifGroup
            summary={`납기일이 ${BIZ_NOTIF_WITHIN_DAYS}일 이내인 미납이 ${feeList.length}건입니다`}
            expanded={feeExpanded}
            onToggle={() => setFeeExpanded((prev) => !prev)}
          >
            {feeList.map((item) => (
              <NotifListRow
                key={item.id}
                item={item}
                onOpen={() => openItem(item)}
                onDelete={() => onDismiss(item)}
              />
            ))}
          </NotifGroup>
        ) : null}
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
    <section className="border-b border-border last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 bg-background px-3 py-2 text-left transition-colors hover:bg-muted/50"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="min-w-0 flex-1 text-left text-xs font-medium leading-snug text-foreground">
          {summary}
        </span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>
      {expanded ? (
        <ul className="border-t border-border/80 bg-background pb-1">{children}</ul>
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
    <li className={cn(NOTIF_ROW, item.read ? 'bg-sky-50/30' : 'bg-background')}>
      <span
        className={cn(
          'shrink-0 select-none text-base leading-none',
          item.read ? 'text-muted-foreground/40/70' : 'text-muted-foreground'
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
            item.read ? 'text-muted-foreground/80' : 'text-muted-foreground'
          )}
        >
          {useName}
        </span>
        <span className="shrink-0 text-muted-foreground/40" aria-hidden>
          |
        </span>
        <span
          className={cn(
            'shrink-0 truncate text-[11px] tabular-nums leading-snug',
            item.read ? 'text-muted-foreground/80' : 'text-muted-foreground'
          )}
        >
          {key}
        </span>
      </button>
      <span className="min-w-2 flex-1" aria-hidden />
      <button
        type="button"
        className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-black"
        onClick={onDelete}
        aria-label="삭제"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}
