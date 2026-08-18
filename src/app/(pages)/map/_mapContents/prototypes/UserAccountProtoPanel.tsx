'use client'

import { useCallback, useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { signOut, useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { LogOut, Mail, Phone, X } from 'lucide-react'
import { call } from '@/lib/api'
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
import {
  MyShootingRequestTab,
  useMyShootingRequestCount,
} from '../shootingRequest/MyShootingRequestTab'
import { SHOOTING_REQUEST_UI_ENABLED } from '../shootingRequest/shootingRequestUiFlag'

/** 프로토 내 정보 패널 */
const PANEL_SHELL_ROUND = 'rounded-[5px]'
const PANEL_ROUND = 'rounded-sm'
const BUBBLE_ROUND = 'rounded-[2px]'
const PANEL_PAD = 'px-3 py-3'
const TEXT_BODY = 'text-xs'

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

/** 프로필 배지 — 성 제외한 이름 두 글자(예: 김배근 → 배근) */
function profileInitials(name: string): string {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return '?'
  return trimmed.length <= 2 ? trimmed : trimmed.slice(-2)
}

/** 패널 하단 탭 — 추후 탭 추가 시 이 배열에만 항목 추가 */
const PROTO_PANEL_TABS_ALL = [
  { id: 'shooting', label: '촬영요청' },
  { id: 'notif', label: '알림' },
] as const
type ProtoPanelTabId = (typeof PROTO_PANEL_TABS_ALL)[number]['id']
const PROTO_PANEL_TABS = SHOOTING_REQUEST_UI_ENABLED
  ? PROTO_PANEL_TABS_ALL
  : PROTO_PANEL_TABS_ALL.filter((t) => t.id !== 'shooting')

type Props = {
  open: boolean
  onClose: () => void
  onOpenLedger: (ledgerId: string) => void
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
  const [notifItems, setNotifItemsLocal] = useState(getProtoNotifs)
  const [activeTab, setActiveTab] = useState<ProtoPanelTabId | null>(null)
  const [profile, setProfile] = useState<MyProfileView>(() => profileFromSession(null))
  const [profileLoading, setProfileLoading] = useState(false)
  const shootingCount = useMyShootingRequestCount(SHOOTING_REQUEST_UI_ENABLED && open)

  useEffect(() => {
    if (!SHOOTING_REQUEST_UI_ENABLED && activeTab === 'shooting') {
      setActiveTab(null)
    }
  }, [activeTab])

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
    window.location.assign('/')
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
    if (!open) return
    setActiveTab(null)
  }, [open])

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
        className={cn(
          'fixed bottom-3 left-[72px] z-[90] flex max-h-[min(520px,calc(100vh-80px))] w-[340px] flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl',
          PANEL_SHELL_ROUND
        )}
        role="dialog"
        aria-label="내 정보"
      >
        <PanelHeader onClose={onClose} />
        <ProfileSection profile={profile} loading={profileLoading} onLogout={handleLogout} />

        <div className={cn('flex flex-col overflow-hidden', activeTab != null && 'min-h-0 flex-1')}>
          <PanelTabBar
            tabs={PROTO_PANEL_TABS}
            activeTab={activeTab}
            notifUnreadCount={unreadNotifCount}
            shootingCount={shootingCount}
            onToggleTab={(tabId) => setActiveTab((prev) => (prev === tabId ? null : tabId))}
          />

          {SHOOTING_REQUEST_UI_ENABLED && activeTab === 'shooting' ? (
            <MyShootingRequestTab
              open={open && activeTab === 'shooting'}
              onSelectRequest={(id) => {
                onClose()
                onSelectShootingRequest?.(id)
              }}
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
              onClosePanel={onClose}
            />
          ) : null}
        </div>
      </div>
    </>
  )
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/80',
        PANEL_PAD
      )}
    >
      <span className="text-xs font-medium text-slate-600">내 정보</span>
      <button
        type="button"
        className={cn('rounded-sm p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600', PANEL_ROUND)}
        onClick={onClose}
        aria-label="닫기"
      >
        <X className="h-3.5 w-3.5" />
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
  const userInitials = profileInitials(profile.name)
  const phone = profile.phone || '—'
  const email = profile.email || '—'

  return (
    <div className="shrink-0 border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-slate-50/80 px-3 py-3">
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold tracking-tight text-white shadow-sm"
          aria-hidden
        >
          {userInitials}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-sm font-semibold text-slate-900">
            {loading ? '불러오는 중…' : profile.name}
          </p>
          {profile.dept ? (
            <span className="mt-1 inline-flex rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
              {profile.dept}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onLogout}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-sm border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-500 hover:bg-slate-50 hover:text-slate-700',
            PANEL_ROUND
          )}
        >
          <LogOut className="h-3 w-3" />
          로그아웃
        </button>
      </div>
      <div className="mt-3 space-y-1.5 border-t border-slate-200/70 pt-2.5">
        <p className="flex items-center gap-2 text-[11px] text-slate-600">
          <Phone className="h-3 w-3 shrink-0 text-slate-400" />
          <span className="tabular-nums">{loading ? '…' : phone}</span>
        </p>
        <p className="flex items-center gap-2 text-[11px] text-slate-600">
          <Mail className="h-3 w-3 shrink-0 text-slate-400" />
          <span className="truncate">{loading ? '…' : email}</span>
        </p>
      </div>
    </div>
  )
}

function PanelTabBar({
  tabs,
  activeTab,
  notifUnreadCount,
  shootingCount,
  onToggleTab,
}: {
  tabs: typeof PROTO_PANEL_TABS
  activeTab: ProtoPanelTabId | null
  notifUnreadCount: number
  shootingCount: number
  onToggleTab: (tabId: ProtoPanelTabId) => void
}) {
  return (
    <div className="flex shrink-0 items-end gap-0 border-b border-slate-200 bg-white px-3">
      {tabs.map((tab) => {
        const active = activeTab === tab.id
        const count =
          tab.id === 'notif' ? notifUnreadCount : tab.id === 'shooting' ? shootingCount : 0
        const showCount = tab.id === 'notif' ? count > 0 : tab.id === 'shooting'
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onToggleTab(tab.id)}
            aria-expanded={active}
            className={cn(
              'relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-xs font-medium transition-colors',
              active
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            {tab.label}
            {showCount ? (
              <span
                className={cn(
                  'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums ring-1',
                  tab.id === 'notif'
                    ? 'bg-red-50 text-red-600 ring-red-100'
                    : 'bg-slate-100 text-slate-600 ring-slate-200'
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
