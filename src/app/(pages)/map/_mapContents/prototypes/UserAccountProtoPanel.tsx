'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { signOut, useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { LogOut, Mail, Phone, User, X } from 'lucide-react'
import { call } from '@/lib/api'
import { withBasePathNav } from '@/lib/basePath'
import { cn } from '@/lib/utils'
import {
  dismissAllBizNotifs,
  dismissBizNotif,
  markBizNotifRead,
  PROTO_NOTIF_CHANGED_EVENT,
  refreshBizNotifs,
} from '../bizNotif/bizNotifClient'
import {
  getProtoNotifs,
  hasProtoUnreadNotifications,
  type ProtoNotifItem,
} from '../bizNotif/bizNotifStore'
import { UserAccountProtoNotifTab } from './UserAccountProtoNotifTab'
import { UserAccountMoreTab } from './UserAccountMoreTab'
import {
  MyShootingRequestTab,
  useMyShootingRequestCount,
} from '../shootingRequest/MyShootingRequestTab'
import { useShootingRequestUiEnabled } from '../shootingRequest/useShootingRequestUiEnabled'

/** 프로토 내 정보 패널 — 내용만큼 높이, 공통은 한 줄 */
const PANEL_SHELL_ROUND = 'rounded-[5px]'
const USER_ACCOUNT_PANEL_HEIGHT = 'max-h-[min(520px,calc(100vh-80px))]'
const PANEL_ROUND = 'rounded-sm'
const BUBBLE_ROUND = 'rounded-[2px]'
const TEXT_BODY = 'text-xs'
/** 더보기 — 즐겨찾기·검색·시스템별 기능 */
export const SHOW_USER_ACCOUNT_MORE_TAB = true

type MyProfileView = {
  usrId: string
  name: string
  dept: string
  phone: string
  email: string
}

function profileFromSession(session: ReturnType<typeof useSession>['data']): MyProfileView {
  const usrId = String(session?.user?.id ?? '').trim()
  const name = String(session?.user?.name ?? '').trim() || usrId || '사용자'
  return {
    usrId,
    name,
    dept: usrId === 'su' ? '시스템' : '',
    phone: '',
    email: '',
  }
}

const PROTO_PANEL_TABS_ALL = [
  { id: 'shooting', label: '촬영요청' },
  { id: 'notif', label: '알림' },
] as const
type ProtoPanelTabId = (typeof PROTO_PANEL_TABS_ALL)[number]['id']

const SIDE_MODAL =
  'fixed bottom-[7px] left-[419px] z-[130] flex w-[400px] flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl'

/** 전체 막에서 내 정보 칸만 빼, 알림·촬영요청·바로가기 설정 단추가 눌리게 함 */
function overlayClipExcludingRect(rect: { left: number; top: number; right: number; bottom: number } | null) {
  if (!rect) return undefined
  return `polygon(evenodd, 0px 0px, 100vw 0px, 100vw 100vh, 0px 100vh, 0px 0px, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.bottom}px, ${rect.right}px ${rect.bottom}px, ${rect.right}px ${rect.top}px, ${rect.left}px ${rect.top}px)`
}

type Props = {
  open: boolean
  onClose: () => void
  onOpenLedger: (item: ProtoNotifItem) => void
  onOpenFee: (feeId: string) => void
  /** 내 촬영요청 행 선택 시 (신청서 모달 등) */
  onSelectShootingRequest?: (id: string) => void
}

export function UserAccountProtoPanel({
  open,
  onClose,
  onOpenLedger,
  onOpenFee,
  onSelectShootingRequest,
}: Props) {
  const { data: session, status } = useSession()
  const searchParams = useSearchParams()
  const system = String(searchParams.get('system') ?? '').trim()
  const shootingUiEnabled = useShootingRequestUiEnabled()
  const panelTabs = shootingUiEnabled
    ? PROTO_PANEL_TABS_ALL
    : PROTO_PANEL_TABS_ALL.filter((t) => t.id !== 'shooting')
  const [notifItems, setNotifItemsLocal] = useState(getProtoNotifs)
  const [activeTab, setActiveTab] = useState<ProtoPanelTabId | null>(null)
  const [profile, setProfile] = useState<MyProfileView>(() => profileFromSession(null))
  const [profileLoading, setProfileLoading] = useState(false)
  const shootingCount = useMyShootingRequestCount(shootingUiEnabled && open)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelHeightPx, setPanelHeightPx] = useState<number | null>(null)
  const [panelRect, setPanelRect] = useState<{
    left: number
    top: number
    right: number
    bottom: number
  } | null>(null)
  const overlayClipPath = overlayClipExcludingRect(panelRect)

  useLayoutEffect(() => {
    if (!open) {
      setPanelHeightPx(null)
      setPanelRect(null)
      return
    }
    const el = panelRef.current
    if (!el) return
    const sync = () => {
      const r = el.getBoundingClientRect()
      setPanelHeightPx(Math.round(r.height))
      setPanelRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  useEffect(() => {
    if (!shootingUiEnabled && activeTab === 'shooting') {
      setActiveTab(null)
    }
  }, [activeTab, shootingUiEnabled])

  useEffect(() => {
    if (!open || status === 'loading') return
    void refreshBizNotifs({ system: system || null })
  }, [open, session?.user?.id, status, system])

  useEffect(() => {
    const sync = () => setNotifItemsLocal(getProtoNotifs())
    window.addEventListener(PROTO_NOTIF_CHANGED_EVENT, sync)
    return () => window.removeEventListener(PROTO_NOTIF_CHANGED_EVENT, sync)
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setProfileLoading(true)
    void call('', 'POST', {
      service: 'usrService',
      action: 'getMyProfile',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const payload = (res?.data ?? res) as {
          success?: boolean
          data?: MyProfileView
        }
        if (payload?.success && payload.data) {
          setProfile(payload.data)
          return
        }
        setProfile(profileFromSession(session))
      })
      .catch(() => {
        if (!cancelled) setProfile(profileFromSession(session))
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, session])

  const handleLogout = useCallback(async () => {
    await signOut({ redirect: false })
    window.location.assign(withBasePathNav('/'))
  }, [])

  const handleDismissNotif = useCallback((item: ProtoNotifItem) => {
    void dismissBizNotif(item)
  }, [])

  const handleDismissAllNotifs = useCallback(() => {
    void dismissAllBizNotifs()
  }, [])

  const handleMarkNotifRead = useCallback((item: ProtoNotifItem) => {
    void markBizNotifRead(item)
  }, [])

  useEffect(() => {
    if (!open) setActiveTab(null)
  }, [open])

  useEffect(() => {
    const onOpenNotif = () => setActiveTab('notif')
    window.addEventListener('ggnr-proto-user-account-open-notif', onOpenNotif)
    return () => window.removeEventListener('ggnr-proto-user-account-open-notif', onOpenNotif)
  }, [])

  const unreadNotifCount = notifItems.filter((n) => !n.read).length

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
        ref={panelRef}
        className={cn(
          'fixed bottom-[7px] left-[72px] z-[90] flex w-[340px] flex-col overflow-hidden border border-border bg-background shadow-2xl',
          USER_ACCOUNT_PANEL_HEIGHT,
          PANEL_SHELL_ROUND
        )}
        role="dialog"
        aria-label="내 정보"
      >
        <PanelHeader onClose={onClose} />
        <ProfileSection profile={profile} loading={profileLoading} onLogout={handleLogout} />
        <PanelTabBar
          tabs={panelTabs}
          activeTab={activeTab}
          notifCount={notifItems.length}
          notifUnreadCount={unreadNotifCount}
          shootingCount={shootingCount}
          onToggleTab={(tabId) => setActiveTab((prev) => (prev === tabId ? null : tabId))}
        />
        {SHOW_USER_ACCOUNT_MORE_TAB ? (
          <div className="flex shrink-0 flex-col">
            <UserAccountMoreTab
              onClosePanel={onClose}
              suppressSettings={activeTab != null}
              onOpenSettings={() => setActiveTab(null)}
              matchHeightPx={panelHeightPx}
              overlayClipPath={overlayClipPath}
            />
          </div>
        ) : null}
      </div>
      {activeTab
        ? createPortal(
            <>
              <button
                type="button"
                className="fixed inset-0 z-[120] bg-transparent"
                style={overlayClipPath ? { clipPath: overlayClipPath } : undefined}
                aria-label="닫기"
                onClick={() => setActiveTab(null)}
              />
              <div
                className={SIDE_MODAL}
                style={panelHeightPx ? { height: panelHeightPx } : undefined}
                role="dialog"
                aria-label={activeTab === 'shooting' ? '촬영요청' : '알림'}
              >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-2.5 py-2">
                  <p className="text-xs font-medium text-foreground">
                    {activeTab === 'shooting' ? '촬영요청' : '알림'}
                  </p>
                  <button
                    type="button"
                    className={cn(
                      'shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      PANEL_ROUND
                    )}
                    onClick={() => setActiveTab(null)}
                    aria-label="닫기"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {shootingUiEnabled && activeTab === 'shooting' ? (
                  <MyShootingRequestTab
                    open={open && activeTab === 'shooting'}
                    onSelectRequest={(id) => onSelectShootingRequest?.(id)}
                  />
                ) : null}
                {activeTab === 'notif' ? (
                  <UserAccountProtoNotifTab
                    items={notifItems}
                    onDismiss={handleDismissNotif}
                    onDismissAll={handleDismissAllNotifs}
                    onMarkRead={handleMarkNotifRead}
                    onOpenLedger={onOpenLedger}
                    onOpenFee={onOpenFee}
                  />
                ) : null}
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-2.5 py-2">
      <span className="text-xs font-semibold text-foreground">내 정보</span>
      <button
        type="button"
        className={cn(
          'shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          PANEL_ROUND
        )}
        onClick={onClose}
        aria-label="닫기"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function ProfileSection({
  profile,
  loading,
  onLogout,
}: {
  profile: MyProfileView
  loading: boolean
  onLogout: () => void
}) {
  const phone = profile.phone || '—'
  const email = profile.email || '—'

  return (
    <div className="shrink-0 border-b border-border bg-gradient-to-br from-primary/5 via-background to-muted/30 px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
          aria-hidden
        >
          <User className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-sm font-semibold text-foreground">
            {loading ? '불러오는 중…' : profile.name}
          </p>
          {profile.dept ? (
            <span className="mt-1 inline-flex rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
              {profile.dept}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onLogout}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-sm border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            PANEL_ROUND
          )}
        >
          <LogOut className="h-3.5 w-3.5" />
          로그아웃
        </button>
      </div>
      <div className="mt-3 space-y-1.5 border-t border-border/70 pt-2.5">
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="tabular-nums">{loading ? '…' : phone}</span>
        </p>
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{loading ? '…' : email}</span>
        </p>
      </div>
    </div>
  )
}

function PanelTabBar({
  tabs,
  activeTab,
  notifCount,
  notifUnreadCount,
  shootingCount,
  onToggleTab,
}: {
  tabs: readonly { id: ProtoPanelTabId; label: string }[]
  activeTab: ProtoPanelTabId | null
  notifCount: number
  notifUnreadCount: number
  shootingCount: number
  onToggleTab: (tabId: ProtoPanelTabId) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-background px-3 py-2">
      {tabs.map((tab) => {
        const active = activeTab === tab.id
        const count =
          tab.id === 'notif' ? notifCount : tab.id === 'shooting' ? shootingCount : 0
        const showCount = tab.id === 'notif' || tab.id === 'shooting'
        const emphasizeUnread = tab.id === 'notif' && notifUnreadCount > 0
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onToggleTab(tab.id)}
            aria-expanded={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-foreground text-background'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {tab.label}
            {showCount ? (
              <span
                className={cn(
                  'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-medium tabular-nums',
                  active
                    ? 'bg-background/20 text-background'
                    : emphasizeUnread
                      ? 'bg-red-50 text-red-600'
                      : 'bg-background text-muted-foreground'
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
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
  const unreadImportant = hasProtoUnreadNotifications()

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
export function NotificationProtoModal(props: Omit<Props, never>) {
  return <UserAccountProtoPanel {...props} />
}

export { hasProtoUnreadNotifications }
