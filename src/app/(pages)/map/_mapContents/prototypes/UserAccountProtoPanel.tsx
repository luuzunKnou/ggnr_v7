'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { signOut, useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { LogOut, Mail, Phone, X } from 'lucide-react'
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
import { UserAccountApproveTab } from './UserAccountApproveTab'

/** 프로토 내 정보 패널 — 헤더·프로필·탭바 아래 본문 공통 높이 */
const PANEL_SHELL_ROUND = 'rounded-[5px]'
const USER_ACCOUNT_PANEL_HEIGHT = ''
/** 3탭 본문 공통 높이(px) — 모달 높이 조절은 이 값 */
const TAB_BODY_HEIGHT_PX = 240
const PANEL_ROUND = 'rounded-sm'
const BUBBLE_ROUND = 'rounded-[2px]'
const TEXT_BODY = 'text-xs'
const BORDER_PANEL = 'border-[#E3E3E3]'
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

const PROTO_PANEL_TABS = [
  { id: 'menu', label: '내 메뉴' },
  { id: 'approve', label: '승인요청' },
  { id: 'notif', label: '알림' },
] as const
type ProtoPanelTabId = (typeof PROTO_PANEL_TABS)[number]['id']

/** 전체 막에서 내 정보 칸만 빼, 바로가기 설정 단추가 눌리게 함 */
function overlayClipExcludingRect(rect: { left: number; top: number; right: number; bottom: number } | null) {
  if (!rect) return undefined
  return `polygon(evenodd, 0px 0px, 100vw 0px, 100vw 100vh, 0px 100vh, 0px 0px, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.bottom}px, ${rect.right}px ${rect.bottom}px, ${rect.right}px ${rect.top}px, ${rect.left}px ${rect.top}px)`
}

type Props = {
  open: boolean
  onClose: () => void
  onOpenLedger: (item: ProtoNotifItem) => void
  onOpenFee: (item: ProtoNotifItem) => void
  onOpenMissingGeom?: (item: ProtoNotifItem) => void
  /** 데이터 요청·승인 화면으로 이동 */
  onOpenDataRequest?: (item: ProtoNotifItem) => void
  /** 내 촬영요청·승인요청 카드 → 신청서 모달 */
  onSelectShootingRequest?: (id: string) => void
  /** 신청서 «상세보기» → shootingApproval 메뉴 */
  onOpenShootingApproval?: (id: string) => void
  /** 시스템 불편신고 플로팅 모달 */
  onOpenSystemFeedback?: () => void
  /** 패널 위치·크기 클래스 (기본: 지도 좌측 사이드바 옆) */
  panelClassName?: string
  /** @deprecated 옆 칸 제거됨 — 호환용 */
  sideModalClassName?: string
}

export function UserAccountProtoPanel({
  open,
  onClose,
  onOpenLedger,
  onOpenFee,
  onOpenMissingGeom,
  onOpenDataRequest,
  onSelectShootingRequest,
  onOpenShootingApproval: _onOpenShootingApproval,
  onOpenSystemFeedback,
  panelClassName,
}: Props) {
  const { data: session, status } = useSession()
  const searchParams = useSearchParams()
  const system = String(searchParams.get('system') ?? '').trim()
  const [notifItems, setNotifItemsLocal] = useState(getProtoNotifs)
  const [activeTab, setActiveTab] = useState<ProtoPanelTabId>('menu')
  const [profile, setProfile] = useState<MyProfileView>(() => profileFromSession(null))
  const [profileLoading, setProfileLoading] = useState(false)
  const [approveCount, setApproveCount] = useState(0)
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
  }, [open, activeTab])

  useEffect(() => {
    if (!open || status === 'loading') return
    let cancelled = false
    void call('', 'POST', { service: 'configService', action: 'getSystemList', params: {} })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        const systems = Array.isArray(data?.systems) ? data.systems : []
        const serviceList =
          systems.find((s: { sys_key?: string }) => String(s?.sys_key ?? '').trim() === system)
            ?.serviceList ?? null
        void refreshBizNotifs({
          system: system || null,
          serviceList: system && Array.isArray(serviceList) ? serviceList : null,
        })
      })
      .catch(() => {
        if (!cancelled) void refreshBizNotifs({ system: system || null })
      })
    return () => {
      cancelled = true
    }
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
    if (!open) setActiveTab('menu')
  }, [open])

  useEffect(() => {
    const onOpenNotif = () => setActiveTab('notif')
    window.addEventListener('ggnr-proto-user-account-open-notif', onOpenNotif)
    return () => window.removeEventListener('ggnr-proto-user-account-open-notif', onOpenNotif)
  }, [])

  const unreadNotifCount = notifItems.filter((n) => !n.read).length
  const notifBadgeCount = notifItems.length

  if (!open) return null

  return createPortal(
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
          'fixed bottom-[7px] z-[90] flex w-[400px] flex-col overflow-hidden border bg-background shadow-2xl',
          BORDER_PANEL,
          USER_ACCOUNT_PANEL_HEIGHT,
          PANEL_SHELL_ROUND,
          panelClassName ?? 'left-[72px]'
        )}
        role="dialog"
        aria-label="내 정보"
      >
        <PanelHeader onClose={onClose} />
        <ProfileSection profile={profile} loading={profileLoading} onLogout={handleLogout} />
        <PanelTabBar
          activeTab={activeTab}
          notifCount={notifBadgeCount}
          notifUnreadCount={unreadNotifCount}
          approveCount={approveCount}
          onSelectTab={setActiveTab}
        />
        <div
          className="relative min-h-0 w-full shrink-0 overflow-hidden"
          style={{ height: TAB_BODY_HEIGHT_PX, maxHeight: TAB_BODY_HEIGHT_PX }}
        >
          {SHOW_USER_ACCOUNT_MORE_TAB ? (
            <div
              className={cn(
                'absolute inset-0 flex min-h-0 flex-col overflow-hidden',
                activeTab === 'menu' ? '' : 'hidden'
              )}
              aria-hidden={activeTab !== 'menu'}
            >
              <UserAccountMoreTab
                onClosePanel={onClose}
                matchHeightPx={panelHeightPx}
                overlayClipPath={overlayClipPath}
                onOpenSystemFeedback={onOpenSystemFeedback}
                pendingApproveCount={approveCount}
                onOpenApproveTab={() => setActiveTab('approve')}
              />
            </div>
          ) : null}
          {/* 탭 전환 시 언마운트하지 않음 — 건수 뱃지·라벨 깜빡임 방지 */}
          <div
            className={cn(
              'absolute inset-0 flex min-h-0 flex-col overflow-hidden',
              activeTab === 'approve' ? '' : 'hidden'
            )}
            aria-hidden={activeTab !== 'approve'}
          >
            <UserAccountApproveTab
              open={open}
              onSelectShooting={(id) => onSelectShootingRequest?.(id)}
              onCountChange={setApproveCount}
            />
          </div>
          <div
            className={cn(
              'absolute inset-0 flex min-h-0 flex-col overflow-hidden',
              activeTab === 'notif' ? '' : 'hidden'
            )}
            aria-hidden={activeTab !== 'notif'}
          >
            <UserAccountProtoNotifTab
              items={notifItems}
              onDismiss={handleDismissNotif}
              onDismissAll={handleDismissAllNotifs}
              onMarkRead={handleMarkNotifRead}
              onOpenLedger={onOpenLedger}
              onOpenFee={onOpenFee}
              onOpenMissingGeom={onOpenMissingGeom}
              onOpenDataRequest={onOpenDataRequest}
            />
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-2 border-b bg-background px-[10px] py-1.5',
        BORDER_PANEL
      )}
    >
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

/** 하이픈 없으면 표시용 서식 — 010→000-0000-0000, 그 외→000-000-0000 */
function formatDisplayPhone(raw: string): string {
  const s = String(raw ?? '').trim()
  if (!s) return '—'
  if (s.includes('-')) return s
  const digits = s.replace(/\D/g, '')
  if (!digits) return s
  if (digits.startsWith('010')) {
    if (digits.length <= 3) return digits
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`
  }
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`
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
  const phone = formatDisplayPhone(profile.phone)
  const email = profile.email || '—'

  return (
    <div className={cn('shrink-0 border-b bg-background px-[10px] py-2', BORDER_PANEL)}>
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[#0F91B2] text-white"
          aria-hidden
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
            aria-hidden
          >
            <circle cx="12" cy="10" r="4" />
            <path d="M18 20a6 6 0 0 0-12 0" />
          </svg>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-1.5">
            {loading ? (
              <span
                className="inline-block h-3 w-[34.56px] shrink-0 animate-pulse rounded bg-muted"
                aria-hidden
              />
            ) : (
              <p className="truncate text-[12px] font-normal text-foreground">{profile.name}</p>
            )}
            {loading ? (
              <span
                className="inline-block h-[18px] w-[48px] shrink-0 animate-pulse rounded bg-[#C7E9F2]/62"
                aria-hidden
              />
            ) : profile.dept ? (
              <span className="inline-flex shrink-0 rounded px-[6px] py-1 text-[10px] font-medium text-[#0F91B2] bg-[#C7E9F2]/62">
                {profile.dept}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden text-[8px] text-[#B3B3B3]">
            <Phone className="h-2.5 w-2.5 shrink-0" aria-hidden />
            {loading ? (
              <span
                className="inline-block h-2 w-[72px] shrink-0 animate-pulse rounded bg-muted"
                aria-hidden
              />
            ) : (
              <span className="shrink-0 whitespace-nowrap tabular-nums">{phone}</span>
            )}
            <span className="shrink-0" aria-hidden>
              |
            </span>
            <Mail className="h-2.5 w-2.5 shrink-0" aria-hidden />
            {loading ? (
              <span
                className="inline-block h-2 w-[140px] shrink-0 animate-pulse rounded bg-muted"
                aria-hidden
              />
            ) : (
              <span className="whitespace-nowrap">{email}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          title="로그아웃"
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-sm border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            PANEL_ROUND
          )}
        >
          <LogOut className="h-3.5 w-3.5" />
          로그아웃
        </button>
      </div>
    </div>
  )
}

function PanelTabBar({
  activeTab,
  notifCount,
  notifUnreadCount,
  approveCount,
  onSelectTab,
}: {
  activeTab: ProtoPanelTabId
  notifCount: number
  notifUnreadCount: number
  approveCount: number
  onSelectTab: (tabId: ProtoPanelTabId) => void
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-stretch justify-center border-b bg-background px-[10px]',
        BORDER_PANEL
      )}
    >
      {PROTO_PANEL_TABS.map((tab) => {
        const active = activeTab === tab.id
        const count = tab.id === 'notif' ? notifCount : tab.id === 'approve' ? approveCount : 0
        const showCount = (tab.id === 'notif' || tab.id === 'approve') && count > 0
        const underline =
          active && tab.id === 'notif'
            ? 'border-b-2 border-[#C70036]'
            : active
              ? 'border-b-2 border-[#0F91B2]'
              : 'border-b-2 border-transparent'
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectTab(tab.id)}
            aria-selected={active}
            className={cn(
              'inline-flex w-[100px] items-center justify-center gap-1 px-[10px] py-2 text-[11px] font-medium transition-colors',
              underline,
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
            {showCount ? (
              <span
                className={cn(
                  'inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-medium tabular-nums',
                  tab.id === 'approve'
                    ? 'bg-[#C7E9F2]/62 text-[#0F91B2]'
                    : notifUnreadCount > 0
                      ? 'bg-[#FFCCD3]/62 text-[#C70036]'
                      : 'bg-[#FFCCD3]/62 text-[#C70036]'
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
