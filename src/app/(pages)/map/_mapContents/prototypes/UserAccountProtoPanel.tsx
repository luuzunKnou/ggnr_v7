'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Bell, ChevronDown, ChevronRight, ClipboardList, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getProtoNotifs,
  PROTO_NOTIF_CHANGED_EVENT,
  PROTO_PHOTO_REQUESTS,
  PROTO_USER,
  hasProtoUnreadNotifications,
  setProtoNotifs,
  type ProtoNotifItem,
} from './dummyData'

/** 프로토 내 정보 패널 — 통일 spacing·타이포 */
const PANEL_SHELL_ROUND = 'rounded-[5px]'
const PANEL_ROUND = 'rounded-sm'
const BUBBLE_ROUND = 'rounded-[2px]'
const PANEL_PAD = 'px-3 py-3'
const TEXT_BODY = 'text-xs'
const TEXT_MUTED = 'text-xs text-slate-500'
const TEXT_LABEL = 'text-xs font-medium text-slate-600'
const TEXT_NOTIF = 'text-xs leading-snug'
const TEXT_NOTIF_MUTED = 'text-xs leading-snug text-slate-500'
const TEXT_NOTIF_LABEL = 'text-xs font-medium leading-snug text-slate-600'
const BTN_GHOST_12 =
  'shrink-0 rounded-sm px-1 py-0.5 text-xs leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-500'

// /** 패널 드래그 (비활성 — 필요 시 복구) */
// const PANEL_WIDTH = 340
// const PANEL_MAX_HEIGHT = 520
// const PANEL_VIEWPORT_MARGIN = 8
//
// function clampPanelPos(bottom: number, left: number, panelEl: HTMLElement | null) {
//   const width = panelEl?.offsetWidth ?? PANEL_WIDTH
//   const height = panelEl?.offsetHeight ?? PANEL_MAX_HEIGHT
//   const maxBottom = Math.max(PANEL_VIEWPORT_MARGIN, window.innerHeight - height - PANEL_VIEWPORT_MARGIN)
//   const maxLeft = Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - width - PANEL_VIEWPORT_MARGIN)
//   return {
//     bottom: Math.min(Math.max(PANEL_VIEWPORT_MARGIN, bottom), maxBottom),
//     left: Math.min(Math.max(PANEL_VIEWPORT_MARGIN, left), maxLeft),
//   }
// }
//
// function panelRectToPos(rect: DOMRect) {
//   return {
//     bottom: window.innerHeight - rect.bottom,
//     left: rect.left,
//   }
// }

type Props = {
  open: boolean
  onClose: () => void
  onOpenLedger: (ledgerId: string) => void
  onOpenFee: (feeId: string) => void
  /** 배너 등에서 열 때 알림 섹션 펼침 */
  initialExpand?: 'notif' | 'photo' | null
}

export function UserAccountProtoPanel({
  open,
  onClose,
  onOpenLedger,
  onOpenFee,
  initialExpand = null,
}: Props) {
  const [notifItems, setNotifItemsLocal] = useState(getProtoNotifs)
  const [photoItems] = useState(PROTO_PHOTO_REQUESTS)

  useEffect(() => {
    const sync = () => setNotifItemsLocal(getProtoNotifs())
    window.addEventListener(PROTO_NOTIF_CHANGED_EVENT, sync)
    return () => window.removeEventListener(PROTO_NOTIF_CHANGED_EVENT, sync)
  }, [])

  const setNotifItems = useCallback(
    (updater: ProtoNotifItem[] | ((prev: ProtoNotifItem[]) => ProtoNotifItem[])) => {
      setNotifItemsLocal((prev) =>
        typeof updater === 'function' ? updater(prev) : updater
      )
    },
    []
  )

  useEffect(() => {
    setProtoNotifs(notifItems)
  }, [notifItems])
  const [expandedNotifGroups, setExpandedNotifGroups] = useState<Record<string, boolean>>({
    만료임박: true,
    미납임박: false,
  })
  const [sectionOpen, setSectionOpen] = useState({ notif: false, photo: false })

  // /** 패널 드래그 (비활성 — 필요 시 복구) */
  // const [panelPos, setPanelPos] = useState<{ bottom: number; left: number } | null>(null)
  // const panelRef = useRef<HTMLDivElement>(null)
  // const dragRef = useRef({
  //   isDragging: false,
  //   startX: 0,
  //   startY: 0,
  //   startBottom: 0,
  //   startLeft: 0,
  // })
  //
  // useEffect(() => {
  //   if (!open) return
  //   const onResize = () => {
  //     setPanelPos((prev) => {
  //       if (!prev) return prev
  //       return clampPanelPos(prev.bottom, prev.left, panelRef.current)
  //     })
  //   }
  //   window.addEventListener('resize', onResize)
  //   return () => window.removeEventListener('resize', onResize)
  // }, [open])
  //
  // useEffect(() => {
  //   const onMove = (e: PointerEvent) => {
  //     if (!dragRef.current.isDragging) return
  //     const dx = e.clientX - dragRef.current.startX
  //     const dy = e.clientY - dragRef.current.startY
  //     const next = clampPanelPos(
  //       dragRef.current.startBottom - dy,
  //       dragRef.current.startLeft + dx,
  //       panelRef.current
  //     )
  //     setPanelPos(next)
  //   }
  //   const onUp = () => {
  //     if (!dragRef.current.isDragging) return
  //     dragRef.current.isDragging = false
  //     document.body.style.cursor = ''
  //   }
  //   window.addEventListener('pointermove', onMove)
  //   window.addEventListener('pointerup', onUp)
  //   window.addEventListener('pointercancel', onUp)
  //   return () => {
  //     window.removeEventListener('pointermove', onMove)
  //     window.removeEventListener('pointerup', onUp)
  //     window.removeEventListener('pointercancel', onUp)
  //   }
  // }, [])
  //
  // const handleHeaderPointerDown = useCallback(
  //   (e: React.PointerEvent<HTMLDivElement>) => {
  //     if ((e.target as HTMLElement).closest('button')) return
  //     const rect = panelRef.current?.getBoundingClientRect()
  //     if (!rect) return
  //
  //     const fromRect = panelRectToPos(rect)
  //     const startBottom = panelPos?.bottom ?? fromRect.bottom
  //     const startLeft = panelPos?.left ?? fromRect.left
  //
  //     if (!panelPos) {
  //       setPanelPos({ bottom: startBottom, left: startLeft })
  //     }
  //
  //     dragRef.current = {
  //       isDragging: true,
  //       startX: e.clientX,
  //       startY: e.clientY,
  //       startBottom,
  //       startLeft,
  //     }
  //     document.body.style.cursor = 'move'
  //     e.currentTarget.setPointerCapture(e.pointerId)
  //   },
  //   [panelPos]
  // )

  useEffect(() => {
    if (!open) return
    setSectionOpen({
      notif: initialExpand === 'notif' || initialExpand == null,
      photo: initialExpand === 'photo',
    })
  }, [open, initialExpand])

  const notifGroups = useMemo(() => {
    const expire = notifItems.filter((i) => i.category === '만료임박')
    const unpaid = notifItems.filter((i) => i.category === '미납임박')
    return [
      { key: '만료임박' as const, label: '점용 기간 만료 임박', list: expire },
      { key: '미납임박' as const, label: '점사용료 수납 기한 임박 미납', list: unpaid },
    ]
  }, [notifItems])

  const unreadNotifCount = notifItems.filter((n) => !n.read).length
  const hasUnreadNotif = unreadNotifCount > 0

  if (!open) return null

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[80] cursor-default bg-transparent"
        aria-label="내 정보 닫기"
        onClick={onClose}
      />
      <div
        className={cn(
          'fixed bottom-3 left-[72px] z-[90] flex max-h-[min(520px,calc(100vh-80px))] w-[340px] flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl',
          PANEL_SHELL_ROUND
        )}
        role="dialog"
        aria-label="내 정보"
      >
        <div
          className={cn(
            'flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/80',
            PANEL_PAD
          )}
        >
          <span className={TEXT_LABEL}>내 정보</span>
          <button
            type="button"
            className={cn('rounded-sm p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600', PANEL_ROUND)}
            onClick={onClose}
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className={cn('shrink-0 border-b border-slate-100', PANEL_PAD)}>
          <div className="flex items-center justify-between gap-2">
            <p className={cn('min-w-0 truncate', TEXT_BODY, 'text-slate-700')}>
              <span className="text-slate-600">{PROTO_USER.dept}</span>
              <span className="text-slate-400"> | </span>
              <span className="font-medium text-slate-800">{PROTO_USER.name}</span>
            </p>
            <button
              type="button"
              className={cn(
                'shrink-0 border border-slate-200 bg-white px-2 py-1.5 hover:bg-slate-50',
                PANEL_ROUND,
                TEXT_MUTED
              )}
            >
              로그아웃
            </button>
          </div>
          <p className={cn('mt-2 truncate', TEXT_MUTED)}>
            <span className="tabular-nums">{PROTO_USER.phone}</span>
            <span className="text-slate-400"> | </span>
            <span>{PROTO_USER.email}</span>
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AccountSectionToggle
            icon={<Bell className="h-3.5 w-3.5 text-slate-500" />}
            label="알림"
            count={hasUnreadNotif ? unreadNotifCount : notifItems.length || undefined}
            countTone={hasUnreadNotif ? 'danger' : 'neutral'}
            showUnreadDot={hasUnreadNotif}
            open={sectionOpen.notif}
            onToggle={() => setSectionOpen((prev) => ({ ...prev, notif: !prev.notif }))}
            clearLabel={sectionOpen.notif && notifItems.length > 0 ? '지우기' : undefined}
            onClear={() => setNotifItems([])}
          />
          {sectionOpen.notif && (
            <div
              className={cn(
                'scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-b border-slate-100',
                PANEL_PAD
              )}
            >
              {notifItems.length === 0 ? (
                <div className={cn('py-2 text-center', TEXT_NOTIF_MUTED)}>받은 알림이 없습니다.</div>
              ) : (
                <div className="space-y-2">
                  {notifGroups.map((g) =>
                    g.list.length === 0 ? null : (
                      <div
                        key={g.key}
                        className={cn('bg-slate-50/60', PANEL_ROUND)}
                      >
                        <button
                          type="button"
                          className={cn(
                            'flex w-full items-center gap-1.5 px-2 py-2 text-left',
                            TEXT_NOTIF_LABEL
                          )}
                          onClick={() =>
                            setExpandedNotifGroups((prev) => ({ ...prev, [g.key]: !prev[g.key] }))
                          }
                        >
                          {g.list.some((i) => !i.read) ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                          ) : (
                            <span className="h-1.5 w-1.5 shrink-0" />
                          )}
                          <span className="min-w-0 flex-1 leading-snug">
                            {g.label} 건이 {g.list.length}건 있습니다
                          </span>
                          {expandedNotifGroups[g.key] ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          )}
                        </button>
                        {expandedNotifGroups[g.key] && (
                          <ul className="space-y-0.5 border-t border-slate-200/70 px-2 pb-2">
                          {g.list.map((item) => (
                            <NotifRow
                              key={item.id}
                              item={item}
                              onOpen={() => {
                                setNotifItems((prev) =>
                                  prev.map((x) => (x.id === item.id ? { ...x, read: true } : x))
                                )
                                if (item.target === 'ledger') onOpenLedger(item.targetId)
                                else onOpenFee(item.targetId)
                                onClose()
                              }}
                              onDelete={() =>
                                setNotifItems((prev) => prev.filter((x) => x.id !== item.id))
                              }
                            />
                          ))}
                        </ul>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          <AccountSectionToggle
            icon={<ClipboardList className="h-3.5 w-3.5 text-blue-500" />}
            label="내 촬영요청"
            count={photoItems.length}
            countTone="neutral"
            open={sectionOpen.photo}
            onToggle={() => setSectionOpen((prev) => ({ ...prev, photo: !prev.photo }))}
          />
          {sectionOpen.photo && (
            <div
              className={cn(
                'scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden',
                PANEL_PAD
              )}
            >
              {photoItems.length === 0 ? (
                <div className={cn('py-2 text-center', TEXT_MUTED)}>촬영요청 내역이 없습니다.</div>
              ) : (
                <ul className="space-y-1">
                  {photoItems.map((item) => (
                    <li
                      key={item.id}
                      className={cn('truncate px-0.5 py-1', TEXT_BODY, 'text-slate-600')}
                    >
                      · {item.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function AccountSectionToggle({
  icon,
  label,
  count,
  countTone = 'neutral',
  showUnreadDot = false,
  open,
  onToggle,
  clearLabel,
  onClear,
}: {
  icon: ReactNode
  label: string
  count?: number
  countTone?: 'danger' | 'neutral'
  showUnreadDot?: boolean
  open: boolean
  onToggle: () => void
  clearLabel?: string
  onClear?: () => void
}) {
  return (
    <div
      className={cn(
        'flex w-full shrink-0 items-center gap-1.5 border-b border-slate-100',
        PANEL_PAD
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-80"
        onClick={onToggle}
      >
        {icon}
        <span className={TEXT_LABEL}>{label}</span>
        {showUnreadDot && !count ? (
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        ) : null}
        {count != null && count > 0 ? <CountBadge count={count} tone={countTone} /> : null}
      </button>
      {open && clearLabel && onClear ? (
        <button type="button" className={BTN_GHOST_12} onClick={onClear}>
          {clearLabel}
        </button>
      ) : null}
      <button
        type="button"
        className="shrink-0 p-0.5 text-slate-400 hover:text-slate-600"
        onClick={onToggle}
        aria-label={open ? '접기' : '펼치기'}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  )
}

function CountBadge({ count, tone }: { count: number; tone: 'danger' | 'neutral' }) {
  const multiDigit = count >= 10
  return (
    <span
      className={cn(
        'inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full tabular-nums text-[10px] font-medium leading-none',
        multiDigit ? 'px-1' : 'w-[18px]',
        tone === 'danger'
          ? 'bg-red-50 text-red-600 ring-1 ring-red-100'
          : 'bg-slate-100 text-slate-500'
      )}
    >
      {count}
    </span>
  )
}

function NotifRow({
  item,
  onOpen,
  onDelete,
}: {
  item: ProtoNotifItem
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <li className={cn('flex items-center gap-1 px-0.5 py-0.5 hover:bg-white/80', PANEL_ROUND)}>
      <button
        type="button"
        className={cn(
          'min-w-0 flex-1 truncate text-left',
          TEXT_NOTIF,
          item.read ? 'text-slate-400' : 'text-slate-600'
        )}
        onClick={onOpen}
      >
        · {item.name}
      </button>
      <button
        type="button"
        className={cn(
          'shrink-0 px-1 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-500',
          PANEL_ROUND,
          TEXT_NOTIF
        )}
        onClick={onDelete}
      >
        삭제
      </button>
    </li>
  )
}

export function ImportantNotifSidebarBubble({
  anchorRef,
}: {
  anchorRef: RefObject<HTMLElement | null>
}) {
  const [mounted, setMounted] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [hasUnread, setHasUnread] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const sync = () => setHasUnread(hasProtoUnreadNotifications())
    sync()
    window.addEventListener(PROTO_NOTIF_CHANGED_EVENT, sync)
    return () => window.removeEventListener(PROTO_NOTIF_CHANGED_EVENT, sync)
  }, [])

  useEffect(() => {
    const dismiss = () => setDismissed(true)
    window.addEventListener('ggnr-proto-user-account-toggle', dismiss)
    window.addEventListener('ggnr-proto-user-account-open-notif', dismiss)
    return () => {
      window.removeEventListener('ggnr-proto-user-account-toggle', dismiss)
      window.removeEventListener('ggnr-proto-user-account-open-notif', dismiss)
    }
  }, [])

  useEffect(() => {
    if (!hasUnread) {
      setDismissed(false)
    }
  }, [hasUnread])

  useEffect(() => {
    if (!mounted || !hasUnread || dismissed) return
    const hideTimer = window.setTimeout(() => setDismissed(true), 3000)
    return () => window.clearTimeout(hideTimer)
  }, [dismissed, hasUnread, mounted])

  useEffect(() => {
    if (!hasUnread || dismissed) {
      setPos(null)
      return
    }

    const update = () => {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos({
        top: rect.top + rect.height / 2,
        left: rect.right + 18,
      })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const timerId = window.setInterval(update, 400)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.clearInterval(timerId)
    }
  }, [anchorRef, dismissed, hasUnread])

  if (!mounted || !hasUnread || dismissed || !pos) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[250] w-max max-w-[calc(100vw-96px)] -translate-y-1/2"
      style={{ top: pos.top, left: pos.left }}
    >
      <div
        className={cn(
          'pointer-events-auto relative inline-flex max-w-full items-center gap-1.5 border border-rose-200/80 bg-rose-100/95 px-3 py-2 text-rose-800 shadow-lg backdrop-blur-sm',
          BUBBLE_ROUND,
          TEXT_BODY
        )}
      >
        <span
          className={cn(
            'absolute -left-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-rose-200/80 bg-rose-100/95',
            BUBBLE_ROUND
          )}
          aria-hidden
        />
        <button
          type="button"
          className="whitespace-nowrap text-left font-medium"
          onClick={() => {
            setDismissed(true)
            window.dispatchEvent(new CustomEvent('ggnr-proto-user-account-open-notif'))
          }}
        >
          읽지 않은 알림이 있습니다
        </button>
        <button
          type="button"
          className={cn('shrink-0 p-0.5 text-rose-600/80 hover:bg-rose-200/70 hover:text-rose-800', BUBBLE_ROUND)}
          onClick={() => setDismissed(true)}
          aria-label="닫기"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>,
    document.body
  )
}

/** @deprecated 상단 중앙 배너 — ImportantNotifSidebarBubble 사용 */
export function ImportantNotifBannerProto({
  onOpenNotif,
}: {
  onOpenNotif: () => void
}) {
  const [show, setShow] = useState(true)
  const unreadImportant = PROTO_NOTIFS.some((n) => n.important && !n.read)

  useEffect(() => {
    if (!unreadImportant) return
    setShow(true)
    const t = window.setTimeout(() => setShow(false), 5000)
    return () => window.clearTimeout(t)
  }, [unreadImportant])

  if (!show || !unreadImportant) return null

  return (
    <div className="fixed left-1/2 top-3 z-[100] flex min-w-[420px] max-w-[min(560px,calc(100vw-48px))] -translate-x-1/2 items-center gap-3 rounded-full border border-rose-200/80 bg-rose-100/95 px-6 py-2.5 text-sm text-rose-800 shadow-md backdrop-blur-sm">
      <button type="button" className="min-w-0 flex-1 text-left font-medium" onClick={onOpenNotif}>
        읽지 않은 알림이 있습니다
      </button>
      <button
        type="button"
        className="shrink-0 rounded-full p-0.5 text-rose-600/80 hover:bg-rose-200/70 hover:text-rose-800"
        onClick={() => setShow(false)}
        aria-label="닫기"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/** @deprecated NotificationProtoModal → UserAccountProtoPanel */
export function NotificationProtoModal(props: Omit<Props, 'initialExpand'>) {
  return <UserAccountProtoPanel {...props} initialExpand="notif" />
}

export { hasProtoUnreadNotifications }
