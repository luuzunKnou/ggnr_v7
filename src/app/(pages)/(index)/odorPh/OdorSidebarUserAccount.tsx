'use client'

import { useEffect, useRef, useState } from 'react'
import { Ellipsis, User } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  hasProtoUnreadNotifications,
  PROTO_NOTIF_CHANGED_EVENT,
  type ProtoNotifItem,
} from '@/app/(pages)/map/_mapContents/bizNotif/bizNotifStore'
import {
  ImportantNotifSidebarBubble,
  UserAccountProtoPanel,
} from '@/app/(pages)/map/_mapContents/prototypes/UserAccountProtoPanel'
import { isOdorAlertNotif } from '@/app/(pages)/(index)/odorPh/odorIndexAlertNotifSeed'

type Props = {
  collapsed: boolean
  /** 경보 알림 클릭 시 (경보 목록 메뉴 이동) */
  onOpenAlertNotif?: (item: ProtoNotifItem) => void
}

/**
 * 지도 좌측 사이드바 하단 «내 정보»와 동일 — 로그인 상태·패널·알림 버블
 * 접힘(w-12): 아바타 h-8 + px-2 로 48px 안에 들어가 잘림 방지
 */
export function OdorSidebarUserAccount({ collapsed, onOpenAlertNotif }: Props) {
  const { data: session, status } = useSession()
  const [open, setOpen] = useState(false)
  const [protoNotifUnread, setProtoNotifUnread] = useState(false)
  const myInfoAnchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sync = () => setProtoNotifUnread(hasProtoUnreadNotifications())
    sync()
    window.addEventListener(PROTO_NOTIF_CHANGED_EVENT, sync)
    return () => window.removeEventListener(PROTO_NOTIF_CHANGED_EVENT, sync)
  }, [])

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v)
    const onOpenNotif = () => setOpen(true)
    window.addEventListener('ggnr-proto-user-account-toggle', onToggle)
    window.addEventListener('ggnr-proto-user-account-open-notif', onOpenNotif)
    return () => {
      window.removeEventListener('ggnr-proto-user-account-toggle', onToggle)
      window.removeEventListener('ggnr-proto-user-account-open-notif', onOpenNotif)
    }
  }, [])

  const displayName =
    status === 'loading'
      ? '…'
      : session?.user?.id === 'su'
        ? '슈퍼관리자'
        : String(session?.user?.name ?? session?.user?.id ?? '').trim() || '게스트'

  const panelClassName = collapsed ? 'left-14' : 'left-[16.5rem]'
  const sideModalClassName = cn(
    'fixed bottom-[7px] z-130 flex w-[400px] flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl',
    collapsed ? 'left-[calc(3.5rem+340px+8px)]' : 'left-[calc(16.5rem+340px+8px)]'
  )

  return (
    <>
      <div className="relative w-full px-2 py-2">
        <div ref={myInfoAnchorRef} className="w-full">
          <button
            type="button"
            title="내 정보"
            aria-label="내 정보"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('ggnr-proto-user-account-toggle'))
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md text-left transition-colors hover:bg-muted/70"
          >
            <span
              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
              aria-hidden
            >
              <User className="h-3.5 w-3.5" strokeWidth={2} />
              <span
                className="absolute bottom-0 right-0 flex h-3 w-3 items-center justify-center rounded-full border border-background bg-primary text-primary-foreground"
                aria-hidden
              >
                <Ellipsis className="h-1.5 w-1.5" strokeWidth={2.5} />
              </span>
              {protoNotifUnread ? (
                <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-red-500" />
              ) : null}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-300 ease-in-out',
                collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
              )}
              aria-hidden={collapsed}
            >
              <span className="block truncate text-[12px] font-medium text-foreground">
                {displayName}
              </span>
              <span className="block text-[10px] text-muted-foreground">내 정보</span>
            </span>
          </button>
        </div>
        <ImportantNotifSidebarBubble anchorRef={myInfoAnchorRef} />
      </div>

      <UserAccountProtoPanel
        open={open}
        onClose={() => setOpen(false)}
        onOpenLedger={(item) => {
          if (isOdorAlertNotif(item)) {
            onOpenAlertNotif?.(item)
            setOpen(false)
          }
        }}
        onOpenFee={() => undefined}
        panelClassName={panelClassName}
        sideModalClassName={sideModalClassName}
      />
    </>
  )
}
