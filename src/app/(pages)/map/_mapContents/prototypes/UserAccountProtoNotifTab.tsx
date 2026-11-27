'use client'

import { useMemo, useState } from 'react'
import { ChevronUp, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BIZ_NOTIF_WITHIN_DAYS } from '../bizNotif/bizNotifClient'
import type { ProtoNotifItem } from '../bizNotif/bizNotifStore'

const NOTIF_ROW =
  'flex items-center gap-2 border-b border-border/80 px-[10px] py-[6px] last:border-b-0 hover:bg-muted/30'
const BTN_CLEAR =
  'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-normal leading-none text-[#8A8A8A] hover:text-[#1A1A1A]'

function parseNotifListFields(item: ProtoNotifItem): { useName: string; key: string } {
  if (item.category === '위치없음') {
    return { useName: item.name, key: item.listKey || '위치 없음' }
  }
  if (item.category === '경보') {
    return { useName: item.title || item.name, key: item.listKey || item.name || '경보' }
  }
  if (item.category === '데이터요청') {
    return {
      useName: `${item.title} · ${item.name}`,
      key: item.listKey || '—',
    }
  }
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
  onOpenFee: (item: ProtoNotifItem) => void
  onOpenMissingGeom?: (item: ProtoNotifItem) => void
  onOpenDataRequest?: (item: ProtoNotifItem) => void
}

export function UserAccountProtoNotifTab({
  items,
  onDismiss,
  onDismissAll,
  onMarkRead,
  onOpenLedger,
  onOpenFee,
  onOpenMissingGeom,
  onOpenDataRequest,
}: Props) {
  const [expiryExpanded, setExpiryExpanded] = useState(true)
  const [feeExpanded, setFeeExpanded] = useState(true)
  const [geomExpanded, setGeomExpanded] = useState(true)
  const [consExpanded, setConsExpanded] = useState(true)
  const [alertExpanded, setAlertExpanded] = useState(true)
  const [dataReqExpanded, setDataReqExpanded] = useState(true)

  const expiryList = useMemo(
    () => items.filter((item) => item.category === '만료임박'),
    [items]
  )
  const feeList = useMemo(
    () => items.filter((item) => item.category === '미납임박'),
    [items]
  )
  const geomList = useMemo(
    () => items.filter((item) => item.category === '위치없음'),
    [items]
  )
  const consList = useMemo(
    () => items.filter((item) => item.category === '공사알림'),
    [items]
  )
  const alertList = useMemo(
    () => items.filter((item) => item.category === '경보'),
    [items]
  )
  const dataReqList = useMemo(
    () => items.filter((item) => item.category === '데이터요청'),
    [items]
  )

  const totalCount =
    expiryList.length +
    feeList.length +
    geomList.length +
    consList.length +
    alertList.length +
    dataReqList.length
  const unreadCount = items.filter((n) => !n.read).length

  const openItem = (item: ProtoNotifItem) => {
    onMarkRead(item)
    if (item.target === 'fee') onOpenFee(item)
    else if (item.target === 'aerial') onOpenMissingGeom?.(item)
    else if (item.target === 'dataRequest' || item.target === 'dataRequestApprove') {
      onOpenDataRequest?.(item)
    } else onOpenLedger(item)
  }

  if (totalCount === 0) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center px-3 py-10 text-center text-[10px] font-normal text-[#8A8A8A]">
        받은 알림이 없습니다.
      </div>
    )
  }

  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-[#FAFAFA] px-[10px] py-[2px]">
        <span className="text-[10px] font-normal text-[#8A8A8A]">
          총 <span className="font-normal tabular-nums text-[#1A1A1A]">{totalCount}</span>건
          {unreadCount > 0 ? (
            <>
              {' '}
              · 미읽음{' '}
              <span className="font-normal tabular-nums text-[#1A1A1A]">{unreadCount}</span>
            </>
          ) : null}
        </span>
        <button type="button" className={BTN_CLEAR} onClick={onDismissAll} title="모두 지우기">
          모두 지우기
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 divide-y divide-border overflow-y-auto overflow-x-hidden bg-background">
        {alertList.length > 0 ? (
          <NotifGroup
            summary={`미인지 경보가 ${alertList.length}건입니다`}
            expanded={alertExpanded}
            onToggle={() => setAlertExpanded((prev) => !prev)}
          >
            {alertList.map((item) => (
              <NotifListRow
                key={item.id}
                item={item}
                onOpen={() => openItem(item)}
                onDelete={() => onDismiss(item)}
              />
            ))}
          </NotifGroup>
        ) : null}

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

        {geomList.length > 0 ? (
          <NotifGroup
            summary={`위치가 없는 사진·동영상이 ${geomList.length}건입니다`}
            expanded={geomExpanded}
            onToggle={() => setGeomExpanded((prev) => !prev)}
          >
            {geomList.map((item) => (
              <NotifListRow
                key={item.id}
                item={item}
                onOpen={() => openItem(item)}
                onDelete={() => onDismiss(item)}
              />
            ))}
          </NotifGroup>
        ) : null}

        {consList.length > 0 ? (
          <NotifGroup
            summary={`공사 알림이 ${consList.length}건입니다`}
            expanded={consExpanded}
            onToggle={() => setConsExpanded((prev) => !prev)}
          >
            {consList.map((item) => (
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

        {dataReqList.length > 0 ? (
          <NotifGroup
            summary={`데이터 요청 알림이 ${dataReqList.length}건입니다`}
            expanded={dataReqExpanded}
            onToggle={() => setDataReqExpanded((prev) => !prev)}
          >
            {dataReqList.map((item) => (
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
        className="flex w-full items-center gap-2 bg-background px-[10px] py-[6px] text-left transition-colors hover:bg-muted/40"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="min-w-0 flex-1 text-left text-[10px] font-normal leading-snug text-[#1A1A1A]">
          {summary}
        </span>
        <ChevronUp
          className={cn(
            'h-4 w-4 shrink-0 text-[#696969] transition-transform',
            !expanded && 'rotate-180'
          )}
          aria-hidden
        />
      </button>
      {expanded ? (
        <ul className="border-t border-border/80 bg-[#FAFAFA]">{children}</ul>
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
    <li className={cn(NOTIF_ROW, item.read ? 'opacity-70' : '')}>
      <button
        type="button"
        className="flex min-w-0 max-w-[calc(100%-2rem)] shrink items-center gap-1.5 text-left"
        onClick={onOpen}
        title={`${useName} | ${key}`}
      >
        <span className="truncate text-[10px] font-normal leading-snug tracking-tight text-[#8A8A8A]">
          {useName}
        </span>
        <span className="shrink-0 text-[#8A8A8A]/50" aria-hidden>
          |
        </span>
        <span className="shrink-0 truncate text-[10px] font-normal tabular-nums leading-snug text-[#8A8A8A]">
          {key}
        </span>
      </button>
      <span className="min-w-2 flex-1" aria-hidden />
      <button
        type="button"
        className="shrink-0 rounded-sm p-1 text-[#8A8A8A] hover:text-[#1A1A1A]"
        onClick={onDelete}
        aria-label="삭제"
        title="삭제"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}
